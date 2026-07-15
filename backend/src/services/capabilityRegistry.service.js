/**
 * capabilityRegistry.service.js
 *
 * Canonical runtime capability registry — SINGLE SOURCE OF TRUTH.
 * Loads capability contracts from contracts/capability_contracts/*.json,
 * validates them, and provides runtime enforcement queries.
 *
 * This replaces the ad-hoc loading in authorityBoundary.js with a
 * deterministic, observable registry that can be queried by any middleware.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import logger from '../config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACT_DIR = join(__dirname, '..', '..', '..', 'contracts', 'capability_contracts');
const ROUTE_MAP_FILE = join(CONTRACT_DIR, 'capability_route_map.json');

// Fallback paths for when primary path doesn't work (e.g., Render deployment)
const FALLBACK_CONTRACT_DIRS = [
  join(process.cwd(), 'contracts', 'capability_contracts'),
  join(process.cwd(), '..', 'contracts', 'capability_contracts'),
  join(__dirname, '..', '..', 'contracts', 'capability_contracts'),
];

class CapabilityRegistryService {
  constructor() {
    this.capabilities = new Map();
    this.routeMap = [];
    this.loadedAt = null;
    this.contractHashes = new Map();
    this.registrationId = null;
    this.version = '1.0.0';
  }

  /**
   * Load all capability contracts from the registry directory.
   * This is the single source of truth — no hardcoded maps.
   */
  loadContracts() {
    if (this.loadedAt) return this;

    // Find the contracts directory (try primary path, then fallbacks)
    let contractsDir = CONTRACT_DIR;
    let routeMapPath = ROUTE_MAP_FILE;

    if (!existsSync(contractsDir)) {
      for (const fallback of FALLBACK_CONTRACT_DIRS) {
        if (existsSync(fallback)) {
          contractsDir = fallback;
          routeMapPath = join(fallback, 'capability_route_map.json');
          logger.info(`[CAPABILITY_REGISTRY] Using fallback contract directory: ${fallback}`);
          break;
        }
      }
    }

    try {
      if (!existsSync(contractsDir)) {
        logger.warn(`[CAPABILITY_REGISTRY] Contract directory not found: ${contractsDir}. Registry will be empty.`);
        this.loadedAt = new Date();
        return this;
      }

      const contractFiles = readdirSync(contractsDir).filter(
        f => f.endsWith('.json') && !f.includes('route_map')
      );

      for (const file of contractFiles) {
        try {
          const filePath = join(contractsDir, file);
          const raw = readFileSync(filePath, 'utf-8');
          const contract = JSON.parse(raw);
          const capId = contract.capability_id;

          if (!capId) {
            logger.warn(`[CAPABILITY_REGISTRY] Contract ${file} missing capability_id, skipping`);
            continue;
          }

          // Compute contract hash for tamper detection
          const contractHash = crypto.createHash('sha256').update(raw).digest('hex');
          this.contractHashes.set(capId, contractHash);

          // Build runtime capability record
          const capability = {
            capability_id: capId,
            capability_name: contract.capability_name,
            version: contract.version,
            status: contract.status || 'UNKNOWN',
            owner: contract.owner,
            description: contract.description,
            provider_service: contract.provider_service,
            provider_models: contract.provider_model || contract.provider_models || [],

            // Authority boundaries
            authority_owned: contract.authority_owned || [],
            authority_not_owned: contract.authority_explicitly_not_owned || [],

            // Runtime enforcement data
            api_endpoints: contract.api_endpoints || {},
            input_schemas: contract.input_schemas || {},
            output_schemas: contract.output_schemas || {},

            // Collections this capability can mutate
            owns_collections: this._extractCollections(contract),
            blocked_mutations: this._buildBlockedMutations(contract),
            read_only: this._isReadOnly(contract),

            // API prefixes this capability owns
            owns_api_prefixes: this._extractPrefixes(contract),

            // Failure behavior
            failure_behavior: contract.failure_behavior || {},

            // Dependencies
            dependencies: contract.dependencies || {},

            // Trace requirements
            trace_requirements: contract.trace_requirements || {},

            // Evidence requirements
            evidence_requirements: contract.evidence_requirements || {},

            // Replay compatibility
            replay_compatibility: contract.replay_compatibility || {},

            // Metadata
            contract_hash: contractHash,
            loaded_at: new Date(),
          };

          this.capabilities.set(capId, capability);
          logger.debug(`[CAPABILITY_REGISTRY] Loaded capability: ${capId} v${contract.version}`);
        } catch (parseErr) {
          logger.error(`[CAPABILITY_REGISTRY] Failed to parse contract ${file}: ${parseErr.message}`);
        }
      }

      // Load route-to-capability mapping
      this._loadRouteMap(routeMapPath);

      this.loadedAt = new Date();
      this.registrationId = `REG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      logger.info(
        `[CAPABILITY_REGISTRY] Loaded ${this.capabilities.size} capabilities, ` +
        `${this.routeMap.length} route mappings, registration: ${this.registrationId}`
      );

      return this;
    } catch (err) {
      logger.error(`[CAPABILITY_REGISTRY] Failed to load contracts: ${err.message}`);
      this.loadedAt = new Date();
      return this;
    }
  }

  /**
   * Load route-to-capability mapping from JSON or build fallback.
   */
  _loadRouteMap(customPath) {
    try {
      const routeMapFile = customPath || ROUTE_MAP_FILE;
      if (existsSync(routeMapFile)) {
        const raw = readFileSync(routeMapFile, 'utf-8');
        const map = JSON.parse(raw);
        this.routeMap = (map.routes || []).sort((a, b) => b.prefix.length - a.prefix.length);
      } else {
        this.routeMap = this._buildFallbackRouteMap();
      }
    } catch (err) {
      logger.warn(`[CAPABILITY_REGISTRY] Failed to load route map: ${err.message}, building fallback`);
      this.routeMap = this._buildFallbackRouteMap();
    }
  }

  /**
   * Build fallback route map from loaded capabilities.
   */
  _buildFallbackRouteMap() {
    const map = [];
    for (const [capId, cap] of this.capabilities) {
      for (const prefix of cap.owns_api_prefixes) {
        map.push({ prefix, capability: capId });
      }
    }
    return map.sort((a, b) => b.prefix.length - a.prefix.length);
  }

  /**
   * Extract owned collections from contract provider models.
   */
  _extractCollections(contract) {
    const collections = [];
    const models = contract.provider_model || contract.provider_models || [];
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
      'CompanySettings': 'companysettings',
      'FinancialPeriod': 'financialperiods',
    };

    for (const modelPath of models) {
      const fileName = modelPath.split('/').pop().replace('.js', '');
      const coll = collectionMap[fileName];
      if (coll) collections.push(coll);
    }
    return collections;
  }

  /**
   * Extract API prefixes from contract endpoints.
   */
  _extractPrefixes(contract) {
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
   * Build blocked mutations from contract's authority_explicitly_not_owned.
   */
  _buildBlockedMutations(contract) {
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
    }
    return blocked;
  }

  /**
   * Determine if capability is read-only (no mutating endpoints).
   */
  _isReadOnly(contract) {
    const endpoints = contract.api_endpoints || {};
    return !Object.values(endpoints).some(
      ep => ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method)
    );
  }

  // ─── Runtime Query Methods ─────────────────────────────────────────────

  /**
   * Get a capability by ID.
   */
  getCapability(capabilityId) {
    this.loadContracts();
    return this.capabilities.get(capabilityId) || null;
  }

  /**
   * Get all registered capabilities.
   */
  getAllCapabilities() {
    this.loadContracts();
    return Object.fromEntries(this.capabilities);
  }

  /**
   * Find the capability that owns a given route path.
   */
  resolveRoute(method, path) {
    this.loadContracts();
    const cleanPath = (path || '').split('?')[0];

    const matchedRoute = this.routeMap.find(r => cleanPath.startsWith(r.prefix));
    if (!matchedRoute) return null;

    const capability = this.capabilities.get(matchedRoute.capability);
    return {
      route: matchedRoute,
      capability,
      capabilityId: matchedRoute.capability,
    };
  }

  /**
   * Check if a capability is allowed to mutate a collection.
   */
  canMutateCollection(capabilityId, collectionName) {
    this.loadContracts();
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return { allowed: false, reason: `Unknown capability: ${capabilityId}` };

    if (cap.read_only) {
      return { allowed: false, reason: `${capabilityId} is read-only` };
    }

    if (cap.blocked_mutations[collectionName]) {
      return {
        allowed: false,
        reason: `${capabilityId} cannot mutate ${collectionName}: ${cap.blocked_mutations[collectionName]}`,
      };
    }

    return { allowed: true, reason: `${capabilityId} authorized for ${collectionName}` };
  }

  /**
   * Validate a request against capability contract input schemas.
   */
  validateInput(capabilityId, endpointKey, inputData) {
    this.loadContracts();
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return { valid: false, error: `Unknown capability: ${capabilityId}` };

    const schema = cap.input_schemas?.[endpointKey];
    if (!schema) return { valid: true, reason: 'No input schema defined' };

    // Basic validation — check required fields
    const required = schema.required || [];
    const missing = required.filter(field => !(field in (inputData || {})));
    if (missing.length > 0) {
      return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
    }

    return { valid: true, reason: 'Input validation passed' };
  }

  /**
   * Verify contract integrity (hash comparison).
   */
  verifyContractIntegrity(capabilityId) {
    this.loadContracts();
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return { valid: false, error: 'Capability not found' };

    const currentHash = this.contractHashes.get(capabilityId);
    const filePath = join(CONTRACT_DIR, `${this._getContractFileName(capabilityId)}`);

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const computedHash = crypto.createHash('sha256').update(raw).digest('hex');
      return {
        valid: computedHash === currentHash,
        capability_id: capabilityId,
        expected_hash: currentHash,
        actual_hash: computedHash,
        contract_version: cap.version,
      };
    } catch (err) {
      return { valid: false, error: `Failed to read contract file: ${err.message}` };
    }
  }

  /**
   * Verify ALL contract integrity.
   */
  verifyAllContracts() {
    this.loadContracts();
    const results = {};
    for (const capId of this.capabilities.keys()) {
      results[capId] = this.verifyContractIntegrity(capId);
    }
    return results;
  }

  /**
   * Get registry metadata for runtime status.
   */
  getRegistryMetadata() {
    this.loadContracts();
    return {
      registration_id: this.registrationId,
      version: this.version,
      loaded_at: this.loadedAt,
      capability_count: this.capabilities.size,
      route_count: this.routeMap.length,
      capabilities: Array.from(this.capabilities.entries()).map(([id, cap]) => ({
        capability_id: id,
        version: cap.version,
        status: cap.status,
        read_only: cap.read_only,
        endpoint_count: Object.keys(cap.api_endpoints).length,
        collection_count: cap.owns_collections.length,
        contract_hash: cap.contract_hash,
      })),
    };
  }

  /**
   * Get the contract file name for a capability ID.
   */
  _getContractFileName(capabilityId) {
    const nameMap = {
      'ARTHA-LEDGER-001': 'ledger_capability_contract.json',
      'ARTHA-SIGNAL-001': 'signal_capability_contract.json',
      'ARTHA-AUDIT-001': 'audit_capability_contract.json',
      'ARTHA-TRACE-001': 'trace_capability_contract.json',
      'ARTHA-FINREPORT-001': 'financial_reporting_capability_contract.json',
      'ARTHA-OBSERVE-001': 'observability_capability_contract.json',
      'ARTHA-MULTICOMPANY-001': 'multicompany_capability_contract.json',
      'ARTHA-TALLY-001': 'tally_capability_contract.json',
      'ARTHA-EVIDENCE-001': 'evidence_capability_contract.json',
    };
    return nameMap[capabilityId] || `${capabilityId.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`;
  }
}

// Singleton
const capabilityRegistry = new CapabilityRegistryService();
export default capabilityRegistry;
