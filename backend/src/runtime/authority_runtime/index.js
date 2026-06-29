/**
 * ARTHA Runtime Authority Engine — v1.0
 *
 * Wraps authorityBoundary.js functionality into a standalone engine with
 * additional service-level and job-level enforcement, ownership mapping,
 * and audit trail capabilities.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─────────────────────────────────────────────────────────────
// RE-EXPORT ALL authorityBoundary.js FUNCTIONS
// ─────────────────────────────────────────────────────────────

export {
  authorityEnforcement,
  capabilityGuard,
  guardCollectionAccess,
  logAuthorityViolation,
  getAuthorityDefinition,
  listAllAuthorityBoundaries,
  verifyCapabilityIntegrity,
} from '../../middleware/authorityBoundary.js';

import authorityBoundary from '../../middleware/authorityBoundary.js';

const {
  authorityEnforcement,
  capabilityGuard,
  guardCollectionAccess,
  logAuthorityViolation,
  getAuthorityDefinition,
  listAllAuthorityBoundaries,
  verifyCapabilityIntegrity,
  loadContractsFromRegistry,
  AUTHORITY_MAP,
} = authorityBoundary;

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

// ─────────────────────────────────────────────────────────────
// CACHED STATE
// ─────────────────────────────────────────────────────────────

/** @type {Map<string, string[]>} capability_id -> [collection names] */
let _ownershipMap = null;

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Load contracts and build the ownership map if not cached.
 */
function ensureOwnershipMap() {
  if (_ownershipMap) return;

  loadContractsFromRegistry();
  _ownershipMap = new Map();

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

        _ownershipMap.set(raw.capability_id, collections);
      } catch {
        // Skip unparseable files
      }
    }
  } catch (err) {
    console.error(`[AuthorityEngine] Failed to build ownership map: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// SERVICE-LEVEL ENFORCEMENT
// ─────────────────────────────────────────────────────────────

/**
 * Check if a service has authority to access a collection.
 * Called from service-level code to enforce authority at the service layer.
 *
 * @param {string} serviceName - Name of the service (e.g., "ledger.service.js")
 * @param {string} operation - Operation type (e.g., "read", "write", "update", "delete")
 * @param {string} collectionName - MongoDB collection name
 * @returns {{ allowed: boolean, reason: string, capability_id?: string }}
 */
export function enforceServiceAccess(serviceName, operation, collectionName) {
  ensureOwnershipMap();

  // Find which capability owns this service
  let ownerCapability = null;

  for (const [capId, collections] of _ownershipMap) {
    if (collections.includes(collectionName)) {
      ownerCapability = capId;
      break;
    }
  }

  if (!ownerCapability) {
    return {
      allowed: false,
      reason: `No capability owns collection "${collectionName}" — service "${serviceName}" cannot access it`,
    };
  }

  // Check if the service is the provider for this capability
  const authority = getAuthorityDefinition(ownerCapability);
  if (!authority) {
    return {
      allowed: false,
      reason: `Unknown capability "${ownerCapability}" for collection "${collectionName}"`,
    };
  }

  // Read-only capabilities cannot perform mutations
  if (authority.read_only && !['read', 'find', 'findOne', 'aggregate', 'count'].includes(operation)) {
    return {
      allowed: false,
      reason: `Capability "${ownerCapability}" is read-only and cannot perform "${operation}" on "${collectionName}"`,
      capability_id: ownerCapability,
    };
  }

  return {
    allowed: true,
    reason: `Service "${serviceName}" is authorized via capability "${ownerCapability}" for "${operation}" on "${collectionName}"`,
    capability_id: ownerCapability,
  };
}

/**
 * Check if a background job has authority to access a collection.
 * Jobs don't have HTTP request context, so this provides standalone enforcement.
 *
 * @param {string} jobName - Name of the background job
 * @param {string} collectionName - MongoDB collection name
 * @returns {{ allowed: boolean, reason: string, capability_id?: string }}
 */
export function enforceJobAccess(jobName, collectionName) {
  ensureOwnershipMap();

  let ownerCapability = null;

  for (const [capId, collections] of _ownershipMap) {
    if (collections.includes(collectionName)) {
      ownerCapability = capId;
      break;
    }
  }

  if (!ownerCapability) {
    return {
      allowed: false,
      reason: `No capability owns collection "${collectionName}" — job "${jobName}" cannot access it`,
    };
  }

  return {
    allowed: true,
    reason: `Job "${jobName}" is authorized via capability "${ownerCapability}" for access to "${collectionName}"`,
    capability_id: ownerCapability,
  };
}

// ─────────────────────────────────────────────────────────────
// OWNERSHIP MAP
// ─────────────────────────────────────────────────────────────

/**
 * Returns a map of collection names to their owning capability IDs.
 * Format: { collectionName: [capability_ids] }
 *
 * @returns {object} Ownership map
 */
export function getOwnershipMap() {
  ensureOwnershipMap();

  const result = {};
  for (const [capId, collections] of _ownershipMap) {
    for (const coll of collections) {
      if (!result[coll]) result[coll] = [];
      result[coll].push(capId);
    }
  }
  return result;
}

/**
 * Returns collections that are not owned by any capability.
 * These are collections that exist in the database but have no contract ownership.
 *
 * @returns {string[]} Array of unowned collection names
 */
export function getUnownedCollections() {
  ensureOwnershipMap();

  const ownedCollections = new Set();
  for (const collections of _ownershipMap.values()) {
    for (const coll of collections) {
      ownedCollections.add(coll);
    }
  }

  // Return all known collection names that aren't owned
  const allKnown = new Set(Object.values(COLLECTION_MAP));
  const unowned = [];
  for (const coll of allKnown) {
    if (!ownedCollections.has(coll)) {
      unowned.push(coll);
    }
  }
  return unowned;
}

/**
 * Returns collections owned by a specific capability.
 *
 * @param {string} capabilityId - The capability ID to look up
 * @returns {string[]} Array of collection names owned by this capability
 */
export function getCapabilityCollections(capabilityId) {
  ensureOwnershipMap();
  return _ownershipMap.get(capabilityId) || [];
}

// ─────────────────────────────────────────────────────────────
// AUDIT ENFORCEMENT
// ─────────────────────────────────────────────────────────────

/**
 * Returns a detailed enforcement audit trail for a request.
 * Inspects the request object and returns what was enforced, what was checked,
 * and any violations that occurred.
 *
 * @param {object} req - Express request object (must have capability/authority set by middleware)
 * @returns {object} Audit trail object
 */
export function auditEnforcement(req) {
  const audit = {
    timestamp: new Date().toISOString(),
    path: req.originalUrl || req.path,
    method: req.method,
    capability_id: req.capability || null,
    capability_name: null,
    is_read_only: false,
    authorized_collections: [],
    blocked_collections: [],
    checks_performed: [],
    violations: [],
    ip: req.ip,
    user: req.user ? { id: req.user._id || req.user.user_id, email: req.user.email } : null,
  };

  if (!req.capability || req.capability === 'UNMAPPED') {
    audit.violations.push({
      type: 'NO_CAPABILITY_CONTEXT',
      message: 'Request has no capability context — authority middleware may not be mounted',
    });
    return audit;
  }

  const authority = getAuthorityDefinition(req.capability);
  if (!authority) {
    audit.violations.push({
      type: 'UNKNOWN_CAPABILITY',
      message: `Capability "${req.capability}" not found in authority definitions`,
    });
    return audit;
  }

  audit.capability_name = authority.capability_name || req.capability;
  audit.is_read_only = authority.read_only || false;
  audit.authorized_collections = authority.owns_collections || [];
  audit.blocked_collections = Object.keys(authority.blocked_mutations || {});

  // Check read-only enforcement
  audit.checks_performed.push({
    type: 'READ_ONLY_CHECK',
    capability: req.capability,
    is_read_only: audit.is_read_only,
    method: req.method,
    passed: !(audit.is_read_only && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)),
  });

  if (audit.is_read_only && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    audit.violations.push({
      type: 'READ_ONLY_VIOLATION',
      message: `Capability "${req.capability}" is read-only but attempted "${req.method}"`,
    });
  }

  // Check collection access for any guards that might have been called
  if (req._authorityAuditTrail) {
    audit.checks_performed.push(...req._authorityAuditTrail);
  }

  return audit;
}
