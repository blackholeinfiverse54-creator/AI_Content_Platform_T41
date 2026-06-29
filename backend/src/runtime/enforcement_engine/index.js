/**
 * ARTHA Runtime Service Interceptor — v1.0
 *
 * Service-level interceptor that ensures all MongoDB operations pass through
 * authority checks. This is a "defense in depth" layer that works alongside
 * the HTTP middleware enforcement in authorityBoundary.js.
 *
 * The interceptor wraps service instances with ES6 Proxy to intercept method
 * calls and verify the calling capability owns the collections being accessed.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────
// DUAL-PATH RESOLUTION
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the project root directory using dual-path resolution.
 * @returns {string} Absolute path to the project root
 */
function resolveProjectRoot() {
  const fromFile = join(__dirname, '..', '..', '..');
  if (existsSync(join(fromFile, 'contracts', 'capability_contracts'))) return fromFile;

  const cwd = process.cwd();
  if (existsSync(join(cwd, 'contracts', 'capability_contracts'))) return cwd;
  if (existsSync(join(cwd, '..', 'contracts', 'capability_contracts'))) return join(cwd, '..');

  return fromFile;
}

const PROJECT_ROOT = resolveProjectRoot();
const CONTRACT_DIR = join(PROJECT_ROOT, 'contracts', 'capability_contracts');
const BACKEND_ROOT = join(PROJECT_ROOT, 'backend');

// ─────────────────────────────────────────────────────────────
// COLLECTION MAPPING
// ─────────────────────────────────────────────────────────────

const COLLECTION_MAP = {
  'JournalEntry': 'journalentries',
  'LedgerEntry': 'ledgerentries',
  'AccountBalance': 'accountbalances',
  'ChartOfAccounts': 'chartofaccounts',
  'Invoice': 'invoices',
  'Expense': 'expenses',
  'TDSEntry': 'tdsentries',
  'TDSChallan': 'tdschallans',
  'GSTReturn': 'gstreturns',
  'AuditEvent': 'auditevents',
  'AuditLog': 'auditlogs',
  'ComplianceSignal': 'compliancesignals',
  'ComplianceFiling': 'compliancefilings',
  'SetuDispatch': 'setudispatches',
  'UnifiedTrace': 'unifiedtraces',
  'RuntimeProof': 'runtimeproofs',
  'Company': 'companies',
  'CostCentre': 'costcentres',
  'TallyExport': 'tallyexports',
  'TallyImport': 'tallyimports',
  'User': 'users',
  'Payment': 'payments',
  'BankStatement': 'bankstatements',
};

/**
 * Reverse mapping: collection name -> model name
 */
const COLLECTION_TO_MODEL = {};
for (const [model, coll] of Object.entries(COLLECTION_MAP)) {
  COLLECTION_TO_MODEL[coll] = model;
}

// ─────────────────────────────────────────────────────────────
// MUTATION METHOD DETECTION
// ─────────────────────────────────────────────────────────────

/**
 * Methods that perform write operations on collections.
 */
const WRITE_METHODS = new Set([
  'create', 'insertOne', 'insertMany', 'insert',
  'updateOne', 'updateMany', 'update',
  'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete',
  'deleteOne', 'deleteMany', 'delete', 'remove',
  'replaceOne', 'bulkWrite', 'save',
  'aggregate', 'countDocuments', 'distinct',
  'findOneAndRemove', 'findByIdAndUpdate', 'findByIdAndDelete',
]);

/**
 * Read-only methods (always allowed).
 */
const READ_METHODS = new Set([
  'find', 'findOne', 'findById', 'count', 'countDocuments',
  'distinct', 'estimatedDocumentCount',
]);

// ─────────────────────────────────────────────────────────────
// CACHED STATE
// ─────────────────────────────────────────────────────────────

/** @type {Map<string, string[]>} capability_id -> [collection names] */
let _capabilityCollections = null;

/** @type {Set<string>} service names that have been wrapped */
const _wrappedServices = new Set();

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Load capability-to-collection mappings from contract files.
 */
function ensureCapabilityCollections() {
  if (_capabilityCollections) return;

  _capabilityCollections = new Map();

  try {
    if (!existsSync(CONTRACT_DIR)) return;

    const files = readdirSync(CONTRACT_DIR).filter((f) => f.endsWith('.json') && !f.includes('route_map'));

    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(CONTRACT_DIR, file), 'utf-8'));
        if (!raw.capability_id) continue;

        const collections = [];
        const models = raw.provider_model || raw.provider_models || [];

        for (const modelPath of models) {
          const fileName = modelPath.split('/').pop().replace('.js', '');
          const coll = COLLECTION_MAP[fileName];
          if (coll) collections.push(coll);
        }

        _capabilityCollections.set(raw.capability_id, collections);
      } catch {
        // Skip unparseable files
      }
    }
  } catch (err) {
    console.error(`[ServiceInterceptor] Failed to load capability collections: ${err.message}`);
  }
}

/**
 * Log an intercepted violation.
 * @param {string} serviceName
 * @param {string} capabilityId
 * @param {string} collectionName
 * @param {string} operation
 * @param {string} reason
 */
function logViolation(serviceName, capabilityId, collectionName, operation, reason) {
  const entry = {
    timestamp: new Date().toISOString(),
    layer: 'service-interceptor',
    service: serviceName,
    capability_id: capabilityId,
    collection: collectionName,
    operation,
    reason,
    severity: 'CRITICAL',
  };

  console.error(`[ServiceInterceptor] VIOLATION: ${JSON.stringify(entry)}`);
}

// ─────────────────────────────────────────────────────────────
// SERVICE PROXY CREATION
// ─────────────────────────────────────────────────────────────

/**
 * Wraps a service instance with an ES6 Proxy that intercepts method calls
 * and verifies the calling capability owns the collections being accessed.
 *
 * The proxy examines method names to determine if they touch collections,
 * then checks authority ownership before allowing execution.
 *
 * @param {object} serviceInstance - The service instance to wrap
 * @param {string} serviceName - Name of the service (for logging)
 * @param {string} capabilityId - The capability ID that owns this service
 * @returns {object} Proxied service instance
 */
export function createServiceProxy(serviceInstance, serviceName, capabilityId) {
  ensureCapabilityCollections();

  if (!serviceInstance || typeof serviceInstance !== 'object') {
    console.error(`[ServiceInterceptor] Invalid service instance for ${serviceName}`);
    return serviceInstance;
  }

  const ownedCollections = _capabilityCollections.get(capabilityId) || [];

  return new Proxy(serviceInstance, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Only intercept function calls
      if (typeof value !== 'function') {
        return value;
      }

      // Return a wrapped function
      return function (...args) {
        // Determine if this method touches a collection
        // Heuristic: check if the method name suggests a collection operation
        const methodName = String(prop);

        // Skip non-mongo methods (utility, config, etc.)
        if (methodName.startsWith('_') || methodName === 'constructor') {
          return value.apply(target, args);
        }

        // Check if any of the arguments reference a collection
        // or if the method name maps to a known collection
        const suspectedCollections = new Set();

        // Method name → collection inference
        const methodNameLower = methodName.toLowerCase();
        for (const [model, coll] of Object.entries(COLLECTION_MAP)) {
          const modelLower = model.toLowerCase();
          if (methodNameLower.includes(modelLower) || methodNameLower.includes(coll)) {
            suspectedCollections.add(coll);
          }
        }

        // Check string arguments for collection references
        for (const arg of args) {
          if (typeof arg === 'string') {
            for (const coll of Object.values(COLLECTION_MAP)) {
              if (arg.toLowerCase().includes(coll)) {
                suspectedCollections.add(coll);
              }
            }
            // Also check model names
            const fileName = arg.split('/').pop()?.replace('.js', '');
            if (fileName && COLLECTION_MAP[fileName]) {
              suspectedCollections.add(COLLECTION_MAP[fileName]);
            }
          }
        }

        // If we suspect collection access, verify authority
        if (suspectedCollections.size > 0) {
          for (const coll of suspectedCollections) {
            if (!ownedCollections.includes(coll)) {
              logViolation(
                serviceName,
                capabilityId,
                coll,
                methodName,
                `Capability "${capabilityId}" does not own collection "${coll}" — intercepted by service proxy`
              );
              // In production, throw; in development, warn
              if (process.env.NODE_ENV === 'production') {
                throw new Error(
                  `[ServiceInterceptor] Authority violation: ${capabilityId} cannot access ${coll} via ${serviceName}.${methodName}()`
                );
              }
              console.error(
                `[ServiceInterceptor] WARNING: ${capabilityId} would be blocked from ${coll} via ${serviceName}.${methodName}() (dev mode — allowed)`
              );
            }
          }
        }

        return value.apply(target, args);
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────
// BATCH SERVICE WRAPPING
// ─────────────────────────────────────────────────────────────

/**
 * Reads capability contracts and wraps each service listed in provider_service
 * with its authority-checking proxy. This should be called once at startup
 * after services are instantiated.
 *
 * Returns a map of serviceName -> wrapped service for reference.
 *
 * @param {object} servicesMap - Map of service name to service instance, e.g., { "ledger": ledgerService }
 * @returns {Map<string, object>} Map of service names to their wrapped instances
 */
export function wrapAllServices(servicesMap) {
  ensureCapabilityCollections();

  const wrappedMap = new Map();

  if (!servicesMap || typeof servicesMap !== 'object') {
    console.error('[ServiceInterceptor] No services map provided');
    return wrappedMap;
  }

  // Load contracts to find service-to-capability mapping
  try {
    if (!existsSync(CONTRACT_DIR)) {
      console.error('[ServiceInterceptor] Contract directory not found');
      return wrappedMap;
    }

    const files = readdirSync(CONTRACT_DIR).filter((f) => f.endsWith('.json') && !f.includes('route_map'));
    const serviceToCapability = new Map();

    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(CONTRACT_DIR, file), 'utf-8'));
        if (!raw.capability_id || !raw.provider_service) continue;

        // Extract service name from path: "backend/src/services/ledger.service.js" -> "ledger"
        const serviceFile = raw.provider_service.split('/').pop();
        const serviceName = serviceFile.replace('.service.js', '').replace('.js', '');
        serviceToCapability.set(serviceName, raw.capability_id);
      } catch {
        // Skip
      }
    }

    // Wrap each service that has a capability mapping
    for (const [name, instance] of Object.entries(servicesMap)) {
      if (_wrappedServices.has(name)) {
        wrappedMap.set(name, instance);
        continue;
      }

      const capId = serviceToCapability.get(name);
      if (capId && instance && typeof instance === 'object') {
        const wrapped = createServiceProxy(instance, name, capId);
        wrappedMap.set(name, wrapped);
        _wrappedServices.add(name);
        console.error(`[ServiceInterceptor] Wrapped service "${name}" with capability "${capId}"`);
      } else {
        wrappedMap.set(name, instance);
      }
    }
  } catch (err) {
    console.error(`[ServiceInterceptor] Failed to wrap services: ${err.message}`);
  }

  return wrappedMap;
}

// ─────────────────────────────────────────────────────────────
// MONGOOSE MODEL MIDDLEWARE
// ─────────────────────────────────────────────────────────────

/**
 * Mongoose model middleware that checks authority before query execution.
 * Attach this as a pre-hook on Mongoose model operations.
 *
 * @param {object} Model - Mongoose model constructor
 * @param {string} capabilityId - The capability ID that should own this model's collection
 * @param {string} operation - The operation type ('read' or 'write')
 * @returns {function} Mongoose middleware function for use with schema.pre()
 */
export function interceptCollectionAccess(Model, capabilityId, operation) {
  ensureCapabilityCollections();

  const modelName = Model?.modelName || 'Unknown';
  const collectionName = COLLECTION_MAP[modelName] || modelName.toLowerCase() + 's';

  const ownedCollections = _capabilityCollections.get(capabilityId) || [];

  return function authorityCheck(next) {
    if (operation === 'read') {
      // Read operations are generally allowed if the capability has any access
      // But we still verify the collection is known
      if (!ownedCollections.includes(collectionName)) {
        console.error(
          `[ServiceInterceptor] READ access: capability "${capabilityId}" does not own "${collectionName}" — allowed in non-strict mode`
        );
      }
      return next();
    }

    // Write operations require strict ownership
    if (!ownedCollections.includes(collectionName)) {
      const msg = `Authority violation: capability "${capabilityId}" cannot write to "${collectionName}" (model: ${modelName})`;

      if (process.env.NODE_ENV === 'production') {
        console.error(`[ServiceInterceptor] BLOCKED: ${msg}`);
        return next(new Error(`[ServiceInterceptor] ${msg}`));
      }

      console.error(`[ServiceInterceptor] WARNING: ${msg} (dev mode — allowed)`);
    }

    return next();
  };
}
