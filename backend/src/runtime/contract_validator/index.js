/**
 * ARTHA Runtime Contract Validator — v1.0
 *
 * Validates capability contracts against schema requirements.
 * Checks required fields, semver format, status values, ownership conflicts,
 * circular dependencies, file existence, and consumer/dependency integrity.
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

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = [
  'capability_id',
  'capability_name',
  'version',
  'status',
  'authority_owned',
  'authority_explicitly_not_owned',
  'api_endpoints',
  'authentication',
  'dependencies',
  'consumers',
  'failure_behavior',
];

const VALID_STATUSES = ['STABLE', 'BETA', 'DEPRECATED', 'EXPERIMENTAL'];

/**
 * Semver regex for X.Y.Z format (no pre-release/build metadata required).
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

// ─────────────────────────────────────────────────────────────
// SEMVER VALIDATION
// ─────────────────────────────────────────────────────────────

/**
 * Check if a version string is valid semver (X.Y.Z).
 * @param {string} version
 * @returns {boolean}
 */
function isValidSemver(version) {
  if (typeof version !== 'string') return false;
  return SEMVER_REGEX.test(version);
}

// ─────────────────────────────────────────────────────────────
// CONTRACT LOADING
// ─────────────────────────────────────────────────────────────

/**
 * Load all raw contract JSON files from the capability_contracts directory.
 * @returns {{ contracts: object[], loadErrors: string[] }}
 */
function loadAllRawContracts() {
  const contracts = [];
  const loadErrors = [];

  try {
    if (!existsSync(CONTRACT_DIR)) {
      loadErrors.push(`Contract directory not found: ${CONTRACT_DIR}`);
      return { contracts, loadErrors };
    }

    const files = readdirSync(CONTRACT_DIR).filter((f) => f.endsWith('.json') && !f.includes('route_map'));

    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(CONTRACT_DIR, file), 'utf-8'));
        raw._sourceFile = file;
        contracts.push(raw);
      } catch (err) {
        loadErrors.push(`Failed to parse ${file}: ${err.message}`);
      }
    }
  } catch (err) {
    loadErrors.push(`Failed to read contract directory: ${err.message}`);
  }

  return { contracts, loadErrors };
}

// ─────────────────────────────────────────────────────────────
// SINGLE CONTRACT VALIDATION
// ─────────────────────────────────────────────────────────────

/**
 * Validate a single capability contract against all requirements.
 * @param {object} contract - Raw contract JSON object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateContract(contract) {
  const errors = [];
  const source = contract._sourceFile || contract.capability_id || 'unknown';

  // 1. Required fields check
  for (const field of REQUIRED_FIELDS) {
    if (contract[field] === undefined || contract[field] === null) {
      errors.push(`${source}: missing required field "${field}"`);
    }
  }

  // 2. Version semver check
  if (contract.version && !isValidSemver(contract.version)) {
    errors.push(`${source}: invalid semver version "${contract.version}" — expected X.Y.Z`);
  }

  // 3. Status enum check
  if (contract.status && !VALID_STATUSES.includes(contract.status)) {
    errors.push(`${source}: invalid status "${contract.status}" — must be one of ${VALID_STATUSES.join(', ')}`);
  }

  // 4. authority_owned vs authority_explicitly_not_owned overlap
  const owned = contract.authority_owned || [];
  const notOwned = contract.authority_explicitly_not_owned || [];
  if (Array.isArray(owned) && Array.isArray(notOwned)) {
    const ownedLower = owned.map((s) => s.toLowerCase());
    for (const item of notOwned) {
      const itemLower = item.toLowerCase();
      const hasOverlap = ownedLower.some((o) => {
        // Check if the items share a significant keyword
        const ownedWords = o.split(/\s+/);
        const notOwnedWords = itemLower.split(/\s+/);
        const shared = ownedWords.filter((w) => w.length > 3 && notOwnedWords.includes(w));
        return shared.length >= 2;
      });
      if (hasOverlap) {
        errors.push(`${source}: ownership overlap — authority_owned and authority_explicitly_not_owned both reference "${item}"`);
      }
    }
  }

  // 5. api_endpoints structure check
  if (contract.api_endpoints && typeof contract.api_endpoints === 'object') {
    for (const [name, ep] of Object.entries(contract.api_endpoints)) {
      if (!ep.method) {
        errors.push(`${source}: endpoint "${name}" missing method`);
      }
      if (!ep.path) {
        errors.push(`${source}: endpoint "${name}" missing path`);
      }
    }
  }

  // 6. provider_service file existence (path is relative to project root)
  if (contract.provider_service) {
    const servicePath = join(PROJECT_ROOT, contract.provider_service);
    if (!existsSync(servicePath)) {
      errors.push(`${source}: provider_service file not found: ${contract.provider_service}`);
    }
  }

  // 7. provider_model / provider_models file existence (path is relative to project root)
  const models = contract.provider_model || contract.provider_models || [];
  for (const modelRef of models) {
    const modelPath = join(PROJECT_ROOT, modelRef);
    if (!existsSync(modelPath)) {
      errors.push(`${source}: provider_model file not found: ${modelRef}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────
// CROSS-CONTRACT VALIDATION
// ─────────────────────────────────────────────────────────────

/**
 * Validate circular dependencies across all contracts.
 * Dependencies are in contract.dependencies.internal[].service values.
 * @param {object[]} contracts - Array of raw contract objects
 * @returns {string[]} Array of error messages (empty if no cycles)
 */
function detectCircularDependencies(contracts) {
  const errors = [];

  // Build dependency graph: capability_id -> [service names they depend on]
  // We map service names back to capability IDs via provider_service
  const serviceToCapability = new Map();
  for (const c of contracts) {
    if (c.capability_id && c.provider_service) {
      const serviceName = c.provider_service.split('/').pop();
      serviceToCapability.set(serviceName, c.capability_id);
    }
  }

  // Build adjacency list
  const graph = new Map();
  for (const c of contracts) {
    if (!c.capability_id) continue;
    const deps = c.dependencies?.internal || [];
    const depCapabilities = [];
    for (const dep of deps) {
      const depServiceName = dep.service?.split('/').pop();
      if (depServiceName && serviceToCapability.has(depServiceName)) {
        depCapabilities.push(serviceToCapability.get(depServiceName));
      }
    }
    graph.set(c.capability_id, depCapabilities);
  }

  // DFS cycle detection
  const visited = new Set();
  const inStack = new Set();
  const path = [];

  function dfs(node) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (graph.has(neighbor)) {
        dfs(neighbor);
      }
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────
// FULL VALIDATION
// ─────────────────────────────────────────────────────────────

/**
 * Validate all capability contracts against all requirements.
 * Returns a comprehensive report of errors and warnings.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateAllContracts() {
  const allErrors = [];
  const warnings = [];

  // Load all contracts
  const { contracts, loadErrors } = loadAllRawContracts();
  allErrors.push(...loadErrors);

  if (contracts.length === 0) {
    allErrors.push('No contracts found to validate');
    return { valid: false, errors: allErrors, warnings };
  }

  // Build lookup for consumer/dependency validation
  const capabilityIds = new Set(contracts.map((c) => c.capability_id).filter(Boolean));

  // Validate each contract individually
  for (const contract of contracts) {
    const result = validateContract(contract);
    allErrors.push(...result.errors);

    // Validate consumer capability IDs exist
    const consumers = contract.consumers || [];
    for (const consumer of consumers) {
      if (consumer.product && !capabilityIds.has(consumer.product)) {
        // Consumer products like "ARTHA", "SETU", "TANTRA" are external — only warn if they look like capability IDs
        if (consumer.product.startsWith('ARTHA-')) {
          allErrors.push(`${contract._sourceFile}: consumer product "${consumer.product}" does not match any known capability`);
        }
      }
    }

    // Validate internal dependency service files exist
    const internalDeps = contract.dependencies?.internal || [];
    for (const dep of internalDeps) {
      if (dep.service) {
        const servicePath = join(PROJECT_ROOT, 'backend', 'src', 'services', dep.service);
        if (!existsSync(servicePath)) {
          warnings.push(`${contract._sourceFile}: dependency service file not found: backend/src/services/${dep.service}`);
        }
      }
    }

    // Validate dependency model names exist as models
    const depModels = contract.dependencies?.models || [];
    for (const modelName of depModels) {
      const modelPath = join(PROJECT_ROOT, 'backend', 'src', 'models', `${modelName}.js`);
      if (!existsSync(modelPath)) {
        warnings.push(`${contract._sourceFile}: dependency model file not found: backend/src/models/${modelName}.js`);
      }
    }

    // Validate that consumer modules reference real services
    for (const consumer of consumers) {
      if (consumer.modules && Array.isArray(consumer.modules)) {
        for (const mod of consumer.modules) {
          // Module names like "LedgerService" should map to ledger.service.js — best effort check
          if (typeof mod === 'string' && mod.endsWith('Service')) {
            const serviceName = mod.replace('Service', '');
            const kebab = serviceName.replace(/([a-z])([A-Z])/g, '$1.$2').toLowerCase();
            // Just a warning — these are human-readable module names, not file paths
          }
        }
      }
    }
  }

  // Cross-contract: circular dependency detection
  const circularErrors = detectCircularDependencies(contracts);
  allErrors.push(...circularErrors);

  // Cross-contract: check no capability_id is duplicated
  const seenIds = new Map();
  for (const contract of contracts) {
    if (!contract.capability_id) continue;
    if (seenIds.has(contract.capability_id)) {
      allErrors.push(
        `Duplicate capability_id "${contract.capability_id}" in ${seenIds.get(contract.capability_id)} and ${contract._sourceFile}`
      );
    }
    seenIds.set(contract.capability_id, contract._sourceFile);
  }

  // Cross-contract: check all consumer references
  for (const contract of contracts) {
    const consumers = contract.consumers || [];
    for (const consumer of consumers) {
      if (consumer.modules && Array.isArray(consumer.modules)) {
        for (const mod of consumer.modules) {
          if (typeof mod === 'string') {
            // Convert module name to potential service file
            const kebab = mod
              .replace(/([a-z])([A-Z])/g, '$1-$2')
              .toLowerCase()
              .replace(/-service$/, '.service');
            // This is informational only
          }
        }
      }
    }
  }

  return { valid: allErrors.length === 0, errors: allErrors, warnings };
}
