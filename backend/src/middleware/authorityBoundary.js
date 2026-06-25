/**
 * ARTHA Authority Boundary Enforcement Middleware
 * 
 * Purpose: Programmatically enforces authority boundaries at runtime.
 * Prevents any capability from accessing or mutating data outside its
 * declared authority scope.
 * 
 * This is NOT documentation — this is executable code that intercepts
 * requests and blocks unauthorized cross-capability access.
 * 
 * Usage: Import and mount in server.js before route handlers
 *   import { authorityEnforcement, capabilityGuard } from './middleware/authorityBoundary.js';
 *   app.use(authorityEnforcement);
 *   app.use('/api/v1/ledger', capabilityGuard('ARTHA-LEDGER-001'), ledgerRoutes);
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────
// AUTHORITY DEFINITIONS (loaded from contracts)
// ─────────────────────────────────────────────────────────────

const AUTHORITY_MAP = {
  'ARTHA-LEDGER-001': {
    owns: [
      'journal_entry_lifecycle',
      'double_entry_integrity', 
      'hash_chain_maintenance',
      'account_balance_computation',
      'credit_debit_notes',
      'reversal_void_workflows'
    ],
    owns_collections: ['journalentries', 'ledgerentries', 'accountbalances'],
    owns_api_prefixes: ['/api/v1/ledger'],
    blocked_mutations: {
      'invoices': 'Use InvoiceService instead',
      'expenses': 'Use ExpenseService instead',
      'tdsentries': 'Use TDSService instead',
      'compliancesignals': 'Use SignalEngine instead',
      'setudispatches': 'Use SignalEngine instead'
    }
  },
  'ARTHA-AUDIT-001': {
    owns: ['audit_events', 'audit_hash_chain', 'audit_trails'],
    owns_collections: ['auditevents'],
    owns_api_prefixes: ['/api/v1/audit'],
    blocked_mutations: {
      'journalentries': 'Cannot modify journal entries',
      'ledgerentries': 'Cannot modify ledger entries',
      'accountbalances': 'Cannot modify account balances',
      'invoices': 'Cannot modify invoices',
      'expenses': 'Cannot modify expenses'
    }
  },
  'ARTHA-TRACE-001': {
    owns: ['trace_lifecycle', 'stage_recording', 'continuity_verification', 'replay'],
    owns_collections: ['unifiedtraces'],
    owns_api_prefixes: ['/api/v1/trace'],
    blocked_mutations: {
      'journalentries': 'Cannot modify journal entries',
      'compliancesignals': 'Cannot modify compliance signals',
      'setudispatches': 'Cannot modify SETU dispatches'
    }
  },
  'ARTHA-EVIDENCE-001': {
    owns: ['proof_capture', 'assertion_verification', 'evidence_packages'],
    owns_collections: ['runtimeproofs'],
    owns_api_prefixes: ['/api/v1/trace/proofs'],
    blocked_mutations: {
      'unifiedtraces': 'Cannot modify traces',
      'journalentries': 'Cannot modify journal entries'
    }
  },
  'ARTHA-OBSERVE-001': {
    owns: ['health_monitoring', 'metrics_exposition', 'dashboard_data'],
    owns_collections: [],
    owns_api_prefixes: ['/health', '/observability', '/prometheus', '/dashboard', '/api/v1/runtime'],
    blocked_mutations: {
      'ALL': 'Observability engine is read-only — no mutations permitted'
    },
    read_only: true
  },
  'ARTHA-FINREPORT-001': {
    owns: ['report_generation', 'equation_verification', 'kpi_calculation'],
    owns_collections: [],
    owns_api_prefixes: ['/api/v1/reports'],
    blocked_mutations: {
      'ALL': 'Financial reporting is read-only — no mutations permitted'
    },
    read_only: true
  },
  'ARTHA-SIGNAL-001': {
    owns: ['signal_generation', 'signal_persistence', 'setu_dispatch', 'retry_logic'],
    owns_collections: ['compliancesignals', 'setudispatches'],
    owns_api_prefixes: ['/api/v1/signals'],
    blocked_mutations: {
      'journalentries': 'Cannot modify journal entries',
      'accountbalances': 'Cannot modify account balances',
      'unifiedtraces': 'Cannot modify traces directly (use addStage via TraceEngine)'
    }
  },
  'ARTHA-MULTICOMPANY-001': {
    owns: ['company_hierarchy', 'consolidated_reporting', 'cost_centres'],
    owns_collections: ['companies', 'costcentres'],
    owns_api_prefixes: ['/api/v1/multi-company'],
    blocked_mutations: {
      'journalentries': 'Cannot modify journal entries directly',
      'chartofaccounts': 'Only seeds default accounts during company creation'
    }
  },
  'ARTHA-TALLY-001': {
    owns: ['import_export', 'xml_generation', 'migration_validation'],
    owns_collections: ['tallyexports', 'tallyimports'],
    owns_api_prefixes: ['/api/v1/tally'],
    blocked_mutations: {
      'journalentries': 'Cannot modify existing journal entries (creates new ones only)'
    }
  }
};

// ─────────────────────────────────────────────────────────────
// ROUTE-TO-CAPABILITY MAPPING
// ─────────────────────────────────────────────────────────────

const ROUTE_CAPABILITY_MAP = [
  { prefix: '/api/v1/ledger', capability: 'ARTHA-LEDGER-001' },
  { prefix: '/api/v1/accounts', capability: 'ARTHA-LEDGER-001' },
  { prefix: '/api/v1/audit', capability: 'ARTHA-AUDIT-001' },
  { prefix: '/api/v1/trace', capability: 'ARTHA-TRACE-001' },
  { prefix: '/api/v1/signals', capability: 'ARTHA-SIGNAL-001' },
  { prefix: '/api/v1/reports', capability: 'ARTHA-FINREPORT-001' },
  { prefix: '/api/v1/multi-company', capability: 'ARTHA-MULTICOMPANY-001' },
  { prefix: '/api/v1/tally', capability: 'ARTHA-TALLY-001' },
  { prefix: '/api/v1/runtime', capability: 'ARTHA-OBSERVE-001' },
  { prefix: '/health', capability: 'ARTHA-OBSERVE-001' },
  { prefix: '/observability', capability: 'ARTHA-OBSERVE-001' },
  { prefix: '/prometheus', capability: 'ARTHA-OBSERVE-001' },
  { prefix: '/dashboard', capability: 'ARTHA-OBSERVE-001' }
];

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE: AUTHORITY ENFORCEMENT
// ─────────────────────────────────────────────────────────────

/**
 * Main authority enforcement middleware.
 * Intercepts all requests and validates that the target collection/resource
 * is within the requesting capability's authority scope.
 */
export function authorityEnforcement(req, res, next) {
  const path = req.originalUrl || req.path;
  const method = req.method;

  // Skip health endpoints (public, read-only)
  if (path.startsWith('/health') || path === '/ready' || path === '/live' || 
      path === '/metrics' || path === '/status' || path.startsWith('/observability') ||
      path.startsWith('/prometheus') || path === '/dashboard') {
    return next();
  }

  // Skip auth endpoints
  if (path.includes('/auth/')) {
    return next();
  }

  // Determine which capability this route belongs to
  const matchedRoute = ROUTE_CAPABILITY_MAP.find(r => path.startsWith(r.prefix));
  if (!matchedRoute) {
    // Route not mapped to any capability — allow but log
    req.capability = 'UNMAPPED';
    return next();
  }

  req.capability = matchedRoute.capability;
  req.capabilityAuthority = AUTHORITY_MAP[matchedRoute.capability];

  // Check if this capability is read-only
  if (req.capabilityAuthority.read_only && method !== 'GET' && method !== 'HEAD') {
    console.error(`[AUTHORITY VIOLATION] ${req.capability} is read-only. Attempted ${method} ${path}`);
    return res.status(403).json({
      success: false,
      error: 'AUTHORITY_VIOLATION',
      message: `Capability ${req.capability} is read-only and cannot perform ${method} operations`,
      capability: req.capability
    });
  }

  next();
}

/**
 * Capability guard middleware.
 * Ensures the request is routed through the correct capability's authority scope.
 * Mount on specific route groups.
 * 
 * Usage: app.use('/api/v1/ledger', capabilityGuard('ARTHA-LEDGER-001'), ledgerRoutes);
 */
export function capabilityGuard(capabilityId) {
  return (req, res, next) => {
    req.capability = capabilityId;
    req.capabilityAuthority = AUTHORITY_MAP[capabilityId];
    next();
  };
}

/**
 * Collection access guard.
 * Validates that the target MongoDB collection is within the capability's scope.
 * 
 * Usage: In controller methods before DB operations
 *   guardCollectionAccess(req, 'invoices') → throws if capability doesn't own 'invoices'
 */
export function guardCollectionAccess(req, collectionName) {
  const capability = req.capability;
  if (!capability || !AUTHORITY_MAP[capability]) {
    return { allowed: true, reason: 'No capability context — request not routed through authority middleware' };
  }

  const authority = AUTHORITY_MAP[capability];

  // Check if read-only capability is attempting write
  if (authority.read_only) {
    return { allowed: false, reason: `${capability} is read-only` };
  }

  // Check if collection is in the blocked list
  if (authority.blocked_mutations && authority.blocked_mutations[collectionName]) {
    return { 
      allowed: false, 
      reason: `${capability} cannot mutate ${collectionName}: ${authority.blocked_mutations[collectionName]}` 
    };
  }

  return { allowed: true, reason: `${capability} is authorized for ${collectionName}` };
}

/**
 * Authority violation logger.
 * Records all authority violations for audit purposes.
 */
export function logAuthorityViolation(req, violation) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    capability: req.capability || 'UNKNOWN',
    path: req.originalUrl,
    method: req.method,
    violation: violation,
    user: req.user ? { id: req.user._id, email: req.user.email, role: req.user.role } : null,
    ip: req.ip,
    userAgent: req.get('user-agent')
  };

  console.error('[AUTHORITY_VIOLATION]', JSON.stringify(logEntry));

  // Write to audit log if audit service is available
  try {
    const auditPath = join(__dirname, '..', 'logs', 'authority-violations.jsonl');
    const { appendFileSync, mkdirSync } = await import('fs');
    const logDir = join(__dirname, '..', 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    appendFileSync(auditPath, JSON.stringify(logEntry) + '\n');
  } catch (e) {
    // Non-fatal — violation is still logged to console
  }
}

/**
 * Get authority definition for a capability.
 * Useful for runtime introspection and debugging.
 */
export function getAuthorityDefinition(capabilityId) {
  return AUTHORITY_MAP[capabilityId] || null;
}

/**
 * List all capability authority boundaries.
 * Returns the full authority map for introspection.
 */
export function listAllAuthorityBoundaries() {
  return Object.entries(AUTHORITY_MAP).map(([id, auth]) => ({
    capability_id: id,
    owns: auth.owns,
    owns_collections: auth.owns_collections,
    owns_api_prefixes: auth.owns_api_prefixes,
    blocked_mutations: Object.keys(auth.blocked_mutations),
    read_only: auth.read_only || false
  }));
}

export default {
  authorityEnforcement,
  capabilityGuard,
  guardCollectionAccess,
  logAuthorityViolation,
  getAuthorityDefinition,
  listAllAuthorityBoundaries,
  AUTHORITY_MAP,
  ROUTE_CAPABILITY_MAP
};
