/**
 * ARTHA Runtime Capability Loader — v1.0
 *
 * Dynamic capability loader that reads ALL contracts from
 * contracts/capability_contracts/ at startup.
 * Builds a runtime registry Map keyed by capability_id.
 *
 * SINGLE SOURCE OF TRUTH: All capability definitions come from contract JSON files.
 * This module caches loaded data for the lifetime of the process.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────
// DUAL-PATH RESOLUTION
// Scripts may run from backend/ or project root.
// We try both locations and use whichever contains contracts/capability_contracts.
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the project root directory using dual-path resolution.
 * Tries file-based (always correct for ESM imports) then cwd-based fallback.
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
const ROUTE_MAP_FILE = join(PROJECT_ROOT, 'contracts', 'capability_contracts', 'capability_route_map.json');

// ─────────────────────────────────────────────────────────────
// CACHED STATE
// ─────────────────────────────────────────────────────────────

/** @type {Map<string, object>} */
let _registry = null;

/** @type {object[]} */
let _routeMap = null;

/** @type {boolean} */
let _initialized = false;

// ─────────────────────────────────────────────────────────────
// COLLECTION MAPPING (mirrors authorityBoundary.js)
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
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Determine if a capability is read-only from its contract.
 * A capability is read-only if ALL its endpoints use only safe methods (GET, HEAD, OPTIONS).
 * @param {object} contract - Raw contract JSON
 * @returns {boolean}
 */
function isReadOnlyCapability(contract) {
  const endpoints = contract.api_endpoints || {};
  const mutatingEndpoints = Object.values(endpoints).filter(
    (ep) => ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method)
  );
  return mutatingEndpoints.length === 0;
}

/**
 * Extract owned collection names from a contract by inspecting provider_model references.
 * Handles both provider_model (singular) and provider_models (plural) fields.
 * @param {object} contract - Raw contract JSON
 * @returns {string[]} Array of collection names
 */
function extractCollectionsFromContract(contract) {
  const collections = [];
  const models = contract.provider_model || contract.provider_models || [];
  for (const modelPath of models) {
    const fileName = modelPath.split('/').pop().replace('.js', '');
    const coll = COLLECTION_MAP[fileName];
    if (coll) collections.push(coll);
  }
  return collections;
}

/**
 * Extract API prefixes from contract endpoint definitions.
 * @param {object} contract - Raw contract JSON
 * @returns {string[]} Array of unique route prefixes
 */
function extractPrefixesFromContract(contract) {
  const prefixes = new Set();
  const endpoints = contract.api_endpoints || {};
  for (const ep of Object.values(endpoints)) {
    if (ep.path) {
      const parts = ep.path.split('/');
      const prefix = parts.slice(0, 4).join('/');
      prefixes.add(prefix);
    }
  }
  return [...prefixes];
}

/**
 * Build blocked mutations map from contract's authority_explicitly_not_owned.
 * @param {object} contract - Raw contract JSON
 * @returns {object} Map of collection name to not-owned description
 */
function buildBlockedMutations(contract) {
  const blocked = {};
  const notOwned = contract.authority_explicitly_not_owned || [];
  for (const item of notOwned) {
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
 * Transform a raw contract JSON into a normalized capability entry for the registry.
 * @param {object} raw - Raw contract JSON
 * @returns {object} Normalized capability entry
 */
function normalizeContract(raw) {
  const endpoints = raw.api_endpoints || {};
  const collections = extractCollectionsFromContract(raw);
  const prefixes = extractPrefixesFromContract(raw);

  return {
    capability_id: raw.capability_id,
    capability_name: raw.capability_name,
    version: raw.version,
    status: raw.status,
    authority_owned: raw.authority_owned || [],
    authority_explicitly_not_owned: raw.authority_explicitly_not_owned || [],
    provider_service: raw.provider_service || null,
    provider_model: raw.provider_model || raw.provider_models || [],
    api_endpoints: endpoints,
    authentication: raw.authentication || {},
    dependencies: raw.dependencies || { internal: [], models: [] },
    consumers: raw.consumers || [],
    failure_behavior: raw.failure_behavior || {},
    read_only: isReadOnlyCapability(raw),
    owns_collections: collections,
    owns_api_prefixes: prefixes,
    blocked_mutations: buildBlockedMutations(raw),
    _raw: raw,
  };
}

// ─────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────

/**
 * Load all capability contracts from disk and build the runtime registry.
 * Lazy-initialized and cached — safe to call multiple times.
 */
function initialize() {
  if (_initialized) return;
  _initialized = true;

  _registry = new Map();
  _routeMap = [];

  // Load contracts
  try {
    if (!existsSync(CONTRACT_DIR)) {
      console.error(`[CapabilityLoader] Contract directory not found: ${CONTRACT_DIR}`);
      return;
    }

    const contractFiles = readdirSync(CONTRACT_DIR).filter((f) => f.endsWith('.json') && !f.includes('route_map'));

    for (const file of contractFiles) {
      try {
        const raw = JSON.parse(readFileSync(join(CONTRACT_DIR, file), 'utf-8'));
        if (!raw.capability_id) {
          console.error(`[CapabilityLoader] Contract ${file} missing capability_id, skipping`);
          continue;
        }

        const entry = normalizeContract(raw);
        _registry.set(entry.capability_id, entry);
      } catch (parseErr) {
        console.error(`[CapabilityLoader] Failed to parse ${file}: ${parseErr.message}`);
      }
    }
  } catch (err) {
    console.error(`[CapabilityLoader] Failed to load contracts: ${err.message}`);
  }

  // Load route map
  try {
    if (existsSync(ROUTE_MAP_FILE)) {
      const raw = JSON.parse(readFileSync(ROUTE_MAP_FILE, 'utf-8'));
      _routeMap = raw.routes || [];
      // Sort by longest prefix first for most-specific matching
      _routeMap.sort((a, b) => b.prefix.length - a.prefix.length);
    }
  } catch (err) {
    console.error(`[CapabilityLoader] Failed to load route map: ${err.message}`);
    _routeMap = [];
  }

  console.error(`[CapabilityLoader] Loaded ${_registry.size} capabilities, ${_routeMap.length} route mappings`);
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

/**
 * Returns the full runtime registry Map keyed by capability_id.
 * Each entry is a normalized capability object.
 * @returns {Map<string, object>} Registry Map
 */
export function getCapabilityRegistry() {
  initialize();
  return _registry;
}

/**
 * Returns a single capability by its ID.
 * @param {string} id - Capability ID (e.g., "ARTHA-LEDGER-001")
 * @returns {object|null} Capability entry or null if not found
 */
export function getCapability(id) {
  initialize();
  return _registry.get(id) || null;
}

/**
 * Returns an array of all loaded capabilities.
 * @returns {object[]} Array of normalized capability entries
 */
export function getAllCapabilities() {
  initialize();
  return Array.from(_registry.values());
}

/**
 * Finds the capability that owns a given route (method + path).
 * Uses longest-prefix matching against the route map.
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - Request path (e.g., "/api/v1/ledger/entries")
 * @returns {object|null} Capability entry or null if no match
 */
export function getCapabilityForRoute(method, path) {
  initialize();

  const cleanPath = path.split('?')[0];
  const matched = _routeMap.find((r) => cleanPath.startsWith(r.prefix));

  if (!matched) return null;

  const capability = _registry.get(matched.capability);
  if (!capability) {
    console.error(`[CapabilityLoader] Route mapped to unknown capability: ${matched.capability}`);
    return null;
  }

  return capability;
}

/**
 * Validates that all contracts loaded successfully and logs any issues.
 * @returns {{ loaded: number, errors: string[], warnings: string[] }}
 */
export function validateStartup() {
  initialize();

  const errors = [];
  const warnings = [];

  // Check that we loaded anything
  if (_registry.size === 0) {
    warnings.push('No capability contracts were loaded from the registry');
  }

  // Check each contract has minimum required structure
  for (const [id, entry] of _registry) {
    if (!entry.capability_name) {
      errors.push(`${id}: missing capability_name`);
    }
    if (!entry.version) {
      errors.push(`${id}: missing version`);
    }
    if (!entry.status) {
      warnings.push(`${id}: missing status`);
    }
    if (!entry.api_endpoints || Object.keys(entry.api_endpoints).length === 0) {
      warnings.push(`${id}: no API endpoints defined`);
    }
    if (!entry.authentication || !entry.authentication.type) {
      warnings.push(`${id}: missing or incomplete authentication config`);
    }
  }

  // Check route map integrity
  if (_routeMap.length === 0) {
    warnings.push('Route map is empty — all routes will be unmapped');
  }

  for (const route of _routeMap) {
    if (!_registry.has(route.capability)) {
      errors.push(`Route ${route.prefix} maps to unknown capability: ${route.capability}`);
    }
  }

  if (errors.length > 0) {
    console.error(`[CapabilityLoader] Validation found ${errors.length} errors:`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
  }

  if (warnings.length > 0) {
    console.error(`[CapabilityLoader] Validation found ${warnings.length} warnings:`);
    for (const warn of warnings) {
      console.error(`  - ${warn}`);
    }
  }

  return { loaded: _registry.size, errors, warnings };
}

/**
 * Force re-initialization of the registry (useful for testing).
 */
export function resetLoader() {
  _initialized = false;
  _registry = null;
  _routeMap = null;
}
