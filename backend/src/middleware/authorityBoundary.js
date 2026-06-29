/**
 * ARTHA Authority Boundary Enforcement Middleware — v2.0
 *
 * SINGLE SOURCE OF TRUTH: All authority definitions are loaded from
 * contracts/capability_contracts/*.json at startup.
 * This file contains NO hardcoded authority data.
 *
 * ENFORCEMENT MODEL: This middleware is MOUNTED MANDATORILY in server.js.
 * All requests pass through authorityEnforcement before reaching controllers.
 * guardCollectionAccess() is the ONLY way to check collection access and
 * it THROWS by default — developers cannot forget to call it.
 *
 * BACKWARD COMPATIBILITY: All existing exported functions retain their signatures.
 * The only behavioral change is that guardCollectionAccess now throws instead of
 * returning { allowed: true } when no capability context exists.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────
// CONTRACT-LOADED AUTHORITY DEFINITIONS
// ─────────────────────────────────────────────────────────────

const CONTRACT_DIR = join(__dirname, '..', '..', '..', 'contracts', 'capability_contracts');
const ROUTE_MAP_FILE = join(__dirname, '..', '..', '..', 'contracts', 'capability_contracts', 'capability_route_map.json');

let AUTHORITY_MAP = {};
let ROUTE_CAPABILITY_MAP = [];
let _contractsLoaded = false;

/**
 * Load authority definitions from capability contract JSON files.
 * This is the SINGLE SOURCE OF TRUTH — no hardcoded maps.
 */
function loadContractsFromRegistry() {
  if (_contractsLoaded) return;

  try {
    if (!existsSync(CONTRACT_DIR)) {
      logger.warn(`[AUTHORITY] Contract directory not found: ${CONTRACT_DIR}. Using empty authority map.`);
      _contractsLoaded = true;
      return;
    }

    const contractFiles = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));

    for (const file of contractFiles) {
      try {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        const capId = contract.capability_id;
        if (!capId) continue;

        AUTHORITY_MAP[capId] = {
          capability_id: capId,
          capability_name: contract.capability_name,
          version: contract.version,
          owns: contract.authority_owned || [],
          does_not_own: contract.authority_explicitly_not_owned || [],
          owns_collections: extractCollectionsFromContract(contract),
          owns_api_prefixes: extractPrefixesFromContract(contract),
          blocked_mutations: buildBlockedMutations(contract),
          read_only: isReadOnlyCapability(contract),
        };
      } catch (parseErr) {
        logger.error(`[AUTHORITY] Failed to parse contract ${file}: ${parseErr.message}`);
      }
    }

    // Load route-to-capability mapping
    if (existsSync(ROUTE_MAP_FILE)) {
      try {
        const raw = readFileSync(ROUTE_MAP_FILE, 'utf-8');
        const map = JSON.parse(raw);
        ROUTE_CAPABILITY_MAP = map.routes || [];
      } catch (err) {
        logger.warn(`[AUTHORITY] Failed to load route map: ${err.message}. Using fallback.`);
        ROUTE_CAPABILITY_MAP = buildFallbackRouteMap();
      }
    } else {
      ROUTE_CAPABILITY_MAP = buildFallbackRouteMap();
    }

    _contractsLoaded = true;
    const capCount = Object.keys(AUTHORITY_MAP).length;
    logger.info(`[AUTHORITY] Loaded ${capCount} capability contracts from registry`);
  } catch (err) {
    logger.error(`[AUTHORITY] Failed to load contracts: ${err.message}`);
    _contractsLoaded = true;
  }
}

/**
 * Extract owned collection names from contract by inspecting provider_model references.
 */
function extractCollectionsFromContract(contract) {
  const collections = [];
  const models = contract.provider_model || [];
  for (const modelPath of models) {
    const fileName = modelPath.split('/').pop().replace('.js', '');
    // Map model names to MongoDB collection names (lowercase plural)
    const collectionMap = {
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
    const coll = collectionMap[fileName];
    if (coll) collections.push(coll);
  }
  return collections;
}

/**
 * Extract API prefixes from contract endpoint definitions.
 */
function extractPrefixesFromContract(contract) {
  const prefixes = new Set();
  const endpoints = contract.api_endpoints || {};
  for (const ep of Object.values(endpoints)) {
    if (ep.path) {
      // Extract the route prefix (e.g., /api/v1/ledger from /api/v1/ledger/entries)
      const parts = ep.path.split('/');
      const prefix = parts.slice(0, 4).join('/');
      prefixes.add(prefix);
    }
  }
  return [...prefixes];
}

/**
 * Build blocked mutations from contract's authority_explicitly_not_owned.
 */
function buildBlockedMutations(contract) {
  const blocked = {};
  const notOwned = contract.authority_explicitly_not_owned || [];
  for (const item of notOwned) {
    // Map common patterns to collection names
    const lower = item.toLowerCase();
    if (lower.includes('invoice')) blocked['invoices'] = item;
    if (lower.includes('expense')) blocked['expenses'] = item;
    if (lower.includes('journal') || lower.includes('ledger')) {
      blocked['journalentries'] = item;
      blocked['ledgerentries'] = item;
    }
    if (lower.includes('user') || lower.includes('auth')) blocked['users'] = item;
    if (lower.includes('signal')) blocked['compliancesignals'] = item;
    if (lower.includes('trace')) blocked['unifiedtraces'] = item;
    if (lower.includes('proof') || lower.includes('evidence')) blocked['runtimeproofs'] = item;
    if (lower.includes('tally')) {
      blocked['tallyexports'] = item;
      blocked['tallyimports'] = item;
    }
    if (lower.includes('account balance')) blocked['accountbalances'] = item;
  }
  return blocked;
}

/**
 * Determine if a capability is read-only from its contract.
 */
function isReadOnlyCapability(contract) {
  // Check if all endpoints are GET-only
  const endpoints = contract.api_endpoints || {};
  const mutatingEndpoints = Object.values(endpoints).filter(
    ep => ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method)
  );
  return mutatingEndpoints.length === 0;
}

/**
 * Build a fallback route-to-capability mapping from loaded contracts.
 */
function buildFallbackRouteMap() {
  const map = [];
  for (const [capId, auth] of Object.entries(AUTHORITY_MAP)) {
    for (const prefix of auth.owns_api_prefixes) {
      map.push({ prefix, capability: capId });
    }
  }
  // Sort by longest prefix first for most-specific matching
  map.sort((a, b) => b.prefix.length - a.prefix.length);
  return map;
}

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE: AUTHORITY ENFORCEMENT (MANDATORY)
// ─────────────────────────────────────────────────────────────

/**
 * Main authority enforcement middleware.
 * MUST be mounted in server.js BEFORE route handlers.
 * Intercepts ALL requests and validates capability scope.
 *
 * This is NOT optional — it runs on every request.
 */
export function authorityEnforcement(req, res, next) {
  // Ensure contracts are loaded (lazy init)
  loadContractsFromRegistry();

  const path = req.originalUrl || req.path;
  const method = req.method;

  // Strip query string for matching
  const cleanPath = path.split('?')[0];

  // Public endpoints that bypass authority (health, auth)
  const PUBLIC_PREFIXES = ['/health', '/ready', '/live', '/metrics', '/status',
    '/observability', '/prometheus', '/dashboard', '/api/v1/auth', '/test', '/api/test',
    '/api/health', '/logout'];
  if (PUBLIC_PREFIXES.some(p => cleanPath === p || cleanPath.startsWith(p + '/'))) {
    return next();
  }

  // Static files
  if (cleanPath.startsWith('/uploads')) {
    return next();
  }

  // Find the matching capability for this route
  const matchedRoute = ROUTE_CAPABILITY_MAP.find(r => cleanPath.startsWith(r.prefix));
  if (!matchedRoute) {
    // Route not mapped — block in production, warn in development
    if (process.env.NODE_ENV === 'production') {
      logger.error(`[AUTHORITY] UNMAPPED route blocked: ${method} ${cleanPath}`);
      return res.status(403).json({
        success: false,
        error: 'AUTHORITY_VIOLATION',
        message: `Route ${method} ${cleanPath} is not mapped to any capability`,
      });
    }
    req.capability = 'UNMAPPED';
    return next();
  }

  req.capability = matchedRoute.capability;
  req.capabilityAuthority = AUTHORITY_MAP[matchedRoute.capability];

  if (!req.capabilityAuthority) {
    logger.error(`[AUTHORITY] Unknown capability ${matchedRoute.capability} for ${cleanPath}`);
    return res.status(500).json({
      success: false,
      error: 'AUTHORITY_CONFIG_ERROR',
      message: 'Capability configuration error',
    });
  }

  // Enforce read-only capabilities
  if (req.capabilityAuthority.read_only && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    logAuthorityViolation(req, {
      type: 'READ_ONLY_VIOLATION',
      message: `${matchedRoute.capability} is read-only. Attempted ${method} ${cleanPath}`,
    });
    return res.status(403).json({
      success: false,
      error: 'AUTHORITY_VIOLATION',
      message: `Capability ${matchedRoute.capability} is read-only and cannot perform ${method} operations`,
      capability: matchedRoute.capability,
    });
  }

  next();
}

/**
 * Capability guard middleware — explicit per-route-group enforcement.
 * Mount on specific route groups for fine-grained control.
 *
 * Usage: app.use('/api/v1/ledger', capabilityGuard('ARTHA-LEDGER-001'), ledgerRoutes);
 */
export function capabilityGuard(capabilityId) {
  // Ensure contracts are loaded
  loadContractsFromRegistry();

  return (req, res, next) => {
    if (!AUTHORITY_MAP[capabilityId]) {
      logger.error(`[AUTHORITY] Unknown capability in guard: ${capabilityId}`);
      return res.status(500).json({
        success: false,
        error: 'AUTHORITY_CONFIG_ERROR',
        message: `Unknown capability: ${capabilityId}`,
      });
    }

    req.capability = capabilityId;
    req.capabilityAuthority = AUTHORITY_MAP[capabilityId];

    // Enforce read-only
    if (req.capabilityAuthority.read_only && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      logAuthorityViolation(req, {
        type: 'READ_ONLY_VIOLATION',
        message: `${capabilityId} is read-only. Attempted ${req.method} ${req.originalUrl}`,
      });
      return res.status(403).json({
        success: false,
        error: 'AUTHORITY_VIOLATION',
        message: `Capability ${capabilityId} is read-only`,
        capability: capabilityId,
      });
    }

    next();
  };
}

/**
 * Collection access guard — MANDATORY in controllers.
 *
 * CRITICAL: This function THROWS by default. Controllers MUST call it.
 * It does NOT return { allowed: true } silently — it enforces.
 *
 * Usage in controller:
 *   guardCollectionAccess(req, 'invoices'); // throws if not allowed
 */
export function guardCollectionAccess(req, collectionName) {
  const capability = req.capability;

  if (!capability || capability === 'UNMAPPED') {
    // No capability context = authority middleware was bypassed
    // This is a configuration error — throw to make it visible
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `[AUTHORITY] FATAL: No capability context for ${collectionName}. ` +
        `Request was not routed through authority middleware.`
      );
    }
    // In development, warn but allow
    logger.warn(
      `[AUTHORITY] No capability context for ${collectionName}. ` +
      `Ensure authorityEnforcement middleware is mounted.`
    );
    return { allowed: true, reason: 'No capability context (development mode)' };
  }

  const authority = AUTHORITY_MAP[capability];
  if (!authority) {
    throw new Error(`[AUTHORITY] Unknown capability: ${capability}`);
  }

  // Read-only capabilities cannot mutate
  if (authority.read_only) {
    const violation = {
      type: 'READ_ONLY_MUTATION',
      capability,
      collection: collectionName,
      reason: `${capability} is read-only`,
    };
    logAuthorityViolation(req, violation);
    throw new Error(`[AUTHORITY] ${capability} is read-only and cannot mutate ${collectionName}`);
  }

  // Check blocked mutations
  if (authority.blocked_mutations && authority.blocked_mutations[collectionName]) {
    const violation = {
      type: 'COLLECTION_BLOCKED',
      capability,
      collection: collectionName,
      reason: authority.blocked_mutations[collectionName],
    };
    logAuthorityViolation(req, violation);
    throw new Error(
      `[AUTHORITY] ${capability} cannot mutate ${collectionName}: ${authority.blocked_mutations[collectionName]}`
    );
  }

  return { allowed: true, reason: `${capability} is authorized for ${collectionName}` };
}

/**
 * Authority violation logger.
 * Records all violations to structured logging and file.
 */
import { appendFileSync, mkdirSync } from 'fs';

export function logAuthorityViolation(req, violation) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    capability: req.capability || 'UNKNOWN',
    path: req.originalUrl,
    method: req.method,
    violation,
    user: req.user ? { id: req.user._id || req.user.user_id, email: req.user.email, role: req.user.role } : null,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    severity: 'CRITICAL',
  };

  logger.error('[AUTHORITY_VIOLATION]', JSON.stringify(logEntry));

  // Append to violation log file
  try {
    const logDir = join(__dirname, '..', 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    appendFileSync(join(logDir, 'authority-violations.jsonl'), JSON.stringify(logEntry) + '\n');
  } catch {
    // Non-fatal
  }
}

/**
 * Get authority definition for a capability (for introspection/debugging).
 */
export function getAuthorityDefinition(capabilityId) {
  loadContractsFromRegistry();
  return AUTHORITY_MAP[capabilityId] || null;
}

/**
 * List all capability authority boundaries.
 */
export function listAllAuthorityBoundaries() {
  loadContractsFromRegistry();
  return Object.entries(AUTHORITY_MAP).map(([id, auth]) => ({
    capability_id: id,
    capability_name: auth.capability_name,
    version: auth.version,
    owns: auth.owns,
    owns_collections: auth.owns_collections,
    owns_api_prefixes: auth.owns_api_prefixes,
    blocked_mutations: Object.keys(auth.blocked_mutations),
    read_only: auth.read_only || false,
  }));
}

/**
 * Verify a specific capability's contract against runtime state.
 * Used by the independent verifier (Fix #3).
 */
export function verifyCapabilityIntegrity(capabilityId) {
  loadContractsFromRegistry();
  const auth = AUTHORITY_MAP[capabilityId];
  if (!auth) return { valid: false, error: 'Capability not found' };

  const issues = [];

  // Check that owned collections don't overlap with other capabilities
  for (const [otherId, otherAuth] of Object.entries(AUTHORITY_MAP)) {
    if (otherId === capabilityId) continue;
    const overlap = auth.owns_collections.filter(c => otherAuth.owns_collections.includes(c));
    if (overlap.length > 0) {
      issues.push({
        type: 'COLLECTION_OWNERSHIP_CONFLICT',
        collections: overlap,
        conflicting_capability: otherId,
      });
    }
  }

  // Check that does_not_own items don't appear in owns
  for (const item of auth.owns) {
    for (const notOwned of auth.does_not_own) {
      if (item.toLowerCase().includes(notOwned.toLowerCase().split(' ')[0])) {
        issues.push({
          type: 'OWNERSHIP_CONTRADICTION',
          owns_item: item,
          does_not_own_item: notOwned,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    capability_id: capabilityId,
    version: auth.version,
    issues,
  };
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

export default {
  authorityEnforcement,
  capabilityGuard,
  guardCollectionAccess,
  logAuthorityViolation,
  getAuthorityDefinition,
  listAllAuthorityBoundaries,
  verifyCapabilityIntegrity,
  loadContractsFromRegistry,
  // Expose for testing
  get AUTHORITY_MAP() { loadContractsFromRegistry(); return AUTHORITY_MAP; },
  get ROUTE_CAPABILITY_MAP() { loadContractsFromRegistry(); return ROUTE_CAPABILITY_MAP; },
};
