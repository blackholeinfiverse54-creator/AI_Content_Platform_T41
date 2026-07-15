/**
 * policyEngine.middleware.js
 *
 * Runtime policy engine — ENFORCES capability boundaries on every request.
 * Unlike the declarative authorityBoundary.js, this middleware:
 * 1. Validates requests against capability contract schemas
 * 2. Enforces mutation restrictions at the middleware level
 * 3. Records policy decisions for audit trail AND decision ledger
 * 4. Anchors governance evidence into provenance chain
 * 5. Blocks unauthorized operations before they reach controllers
 * 6. Provides deterministic enforcement (not advisory)
 * 7. Produces complete constitutional decision ledger artifacts
 *
 * This is the MISSING policy engine identified in the gap analysis.
 */

import capabilityRegistry from '../services/capabilityRegistry.service.js';
import logger from '../config/logger.js';

// Lazy-loaded services to avoid circular imports at module load time
let _decisionLedger = null;
let _provenanceChain = null;

async function getDecisionLedger() {
  if (!_decisionLedger) {
    try {
      const mod = await import('../services/decisionLedger.service.js');
      _decisionLedger = mod.default;
    } catch { /* not yet initialized */ }
  }
  return _decisionLedger;
}

async function getProvenanceChain() {
  if (!_provenanceChain) {
    try {
      const mod = await import('../services/provenanceChain.service.js');
      _provenanceChain = mod.default;
    } catch { /* not yet initialized */ }
  }
  return _provenanceChain;
}

// ─── Policy Decision Record ──────────────────────────────────────────────

/**
 * Record a policy decision for audit trail AND decision ledger.
 * Produces complete constitutional decision ledger artifacts on DENY.
 */
async function recordPolicyDecision(req, decision) {
  const record = {
    timestamp: new Date().toISOString(),
    request_id: req.id || req.headers['x-request-id'] || 'unknown',
    capability: req.capability || 'UNMAPPED',
    method: req.method,
    path: (req.originalUrl || req.path).split('?')[0],
    user: req.user ? {
      id: req.user._id || req.user.user_id,
      email: req.user.email,
      role: req.user.role,
    } : null,
    decision,
    ip: req.ip,
    user_agent: req.get('user-agent'),
  };

  // Log to structured logger
  if (decision === 'DENY') {
    logger.error('[POLICY_ENGINE] DENY', JSON.stringify(record));
  } else {
    logger.debug('[POLICY_ENGINE] ALLOW', JSON.stringify(record));
  }

  // Anchor DENY decisions into decision ledger + provenance chain
  if (decision === 'DENY') {
    try {
      const ledger = await getDecisionLedger();
      if (ledger && ledger.initialized) {
        const decisionRecord = await ledger.recordPolicyDecision({
          capability_id: req.capability || 'UNMAPPED',
          method: req.method,
          path: record.path,
          outcome: 'DENY',
          reason: `Policy enforcement: ${req.capability || 'UNMAPPED'} denied ${req.method} ${record.path}`,
          evidence: {
            request_id: record.request_id,
            ip: record.ip,
            user_agent: record.user_agent,
            user: record.user,
          },
          user_id: req.user?._id || req.user?.user_id,
          policy_name: 'policy-engine-enforcement',
          policy_version: '1.0.0',
          enforcement_point: 'policyEngine-middleware',
        });

        // Anchor into provenance chain
        const provenance = await getProvenanceChain();
        if (provenance && provenance.initialized) {
          await provenance.recordPolicyEvent({
            policy: 'policy-engine-enforcement',
            action: `${req.method} ${record.path}`,
            target: req.capability || 'UNMAPPED',
            outcome: 'DENY',
            details: {
              decision_id: decisionRecord.decision_id,
              request_id: record.request_id,
              ip: record.ip,
            },
          });
        }
      }
    } catch (err) {
      logger.error('[POLICY_ENGINE] Failed to record DENY to decision ledger:', err.message);
    }
  }

  return record;
}

// ─── Main Policy Enforcement Middleware ───────────────────────────────────

/**
 * policyEnforcement — MANDATORY middleware.
 * Mount BEFORE route handlers in server.js.
 *
 * Enforces:
 * - Capability resolution for every request
 * - Read-only capability write protection
 * - Collection mutation authorization
 * - Input schema validation (when contract defines schemas)
 * - Policy decision recording
 */
export function policyEnforcement(req, res, next) {
  const path = (req.originalUrl || req.path).split('?')[0];
  const method = req.method;

  // ─── Bypass public endpoints ──────────────────────────────────────────
  const PUBLIC_PREFIXES = [
    '/health', '/ready', '/live', '/metrics', '/status',
    '/observability', '/prometheus', '/dashboard',
    '/api/v1/auth', '/test', '/api/test', '/api/health',
    '/logout',
  ];

  if (PUBLIC_PREFIXES.some(p => path === p || path.startsWith(p + '/'))) {
    req.capability = 'PUBLIC';
    req.policyDecision = 'ALLOW_PUBLIC';
    return next();
  }

  // Static files
  if (path.startsWith('/uploads')) {
    req.capability = 'STATIC';
    req.policyDecision = 'ALLOW_STATIC';
    return next();
  }

  // ─── Resolve capability for this route ────────────────────────────────
  const resolution = capabilityRegistry.resolveRoute(method, path);

  if (!resolution) {
    // Route not mapped to any capability
    // If registry has no capabilities loaded, be permissive
    if (capabilityRegistry.capabilities.size === 0) {
      logger.warn(`[POLICY_ENGINE] No capabilities loaded, allowing unmapped route: ${method} ${path}`);
      req.capability = 'UNMAPPED';
      req.policyDecision = 'ALLOW_NO_CONTRACTS';
      return next();
    }

    if (process.env.NODE_ENV === 'production') {
      recordPolicyDecision(req, 'DENY').catch(() => {});
      return res.status(403).json({
        success: false,
        error: 'POLICY_VIOLATION',
        message: `Route ${method} ${path} is not governed by any capability contract`,
        request_id: req.id || req.headers['x-request-id'],
      });
    }

    // In development, warn but allow
    logger.warn(`[POLICY_ENGINE] Unmapped route in dev: ${method} ${path}`);
    req.capability = 'UNMAPPED';
    req.policyDecision = 'ALLOW_DEV_UNMAPPED';
    return next();
  }

  req.capability = resolution.capabilityId;
  req.capabilityData = resolution.capability;

  // ─── Enforce read-only capabilities ───────────────────────────────────
  if (resolution.capability?.read_only && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    recordPolicyDecision(req, 'DENY').catch(() => {});
    return res.status(403).json({
      success: false,
      error: 'POLICY_VIOLATION',
      message: `Capability ${resolution.capabilityId} is read-only. ${method} operations are prohibited.`,
      capability: resolution.capabilityId,
      request_id: req.id || req.headers['x-request-id'],
    });
  }

  // ─── Enforce blocked mutations ────────────────────────────────────────
  // Check if this is a mutating request that targets a blocked collection
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const blocked = resolution.capability?.blocked_mutations || {};

    // Extract potential collection from path
    const pathParts = path.split('/').filter(Boolean);
    const collectionHints = pathParts.filter(p => !p.startsWith(':') && !p.startsWith('api'));

    for (const hint of collectionHints) {
      const lowerHint = hint.toLowerCase();
      for (const [collection, reason] of Object.entries(blocked)) {
        if (lowerHint.includes(collection.slice(0, -1)) || lowerHint === collection) {
          recordPolicyDecision(req, 'DENY').catch(() => {});
          return res.status(403).json({
            success: false,
            error: 'POLICY_VIOLATION',
            message: `Capability ${resolution.capabilityId} cannot mutate ${collection}`,
            capability: resolution.capabilityId,
            reason,
            request_id: req.id || req.headers['x-request-id'],
          });
        }
      }
    }
  }

  // ─── Policy decision: ALLOW ───────────────────────────────────────────
  recordPolicyDecision(req, 'ALLOW').catch(() => {});
  next();
}

// ─── Collection Guard (for controllers) ──────────────────────────────────

/**
 * guardCollection — Called by controllers to verify collection access.
 * THROWS on violation — controllers MUST call this.
 *
 * Usage:
 *   guardCollection(req, 'invoices'); // throws if not allowed
 */
export function guardCollection(req, collectionName) {
  const capability = req.capability;

  if (!capability || capability === 'UNMAPPED') {
    if (process.env.NODE_ENV === 'production' && capabilityRegistry.capabilities.size > 0) {
      throw new Error(
        `[POLICY_ENGINE] FATAL: No capability context for ${collectionName}. ` +
        `Request bypassed policy enforcement.`
      );
    }
    return { allowed: true, reason: 'No capability context (permissive mode)' };
  }

  if (capability === 'PUBLIC' || capability === 'STATIC') {
    return { allowed: true, reason: 'Public/static context' };
  }

  const result = capabilityRegistry.canMutateCollection(capability, collectionName);
  if (!result.allowed) {
    logger.error(`[POLICY_ENGINE] Collection guard DENIED: ${capability} -> ${collectionName}`);
    throw new Error(`[POLICY_ENGINE] ${result.reason}`);
  }

  return result;
}

// ─── Input Validation Middleware Factory ──────────────────────────────────

/**
 * validateCapabilityInput — Validates request body against capability contract schemas.
 * Factory function that returns middleware for a specific endpoint key.
 *
 * Usage:
 *   router.post('/entries', validateCapabilityInput('ARTHA-LEDGER-001', 'create_entry'), handler);
 */
export function validateCapabilityInput(capabilityId, endpointKey) {
  return (req, res, next) => {
    const result = capabilityRegistry.validateInput(capabilityId, endpointKey, req.body);

    if (!result.valid) {
      logger.warn(`[POLICY_ENGINE] Input validation failed: ${result.error}`);
      return res.status(400).json({
        success: false,
        error: 'INPUT_VALIDATION_FAILED',
        message: result.error,
        capability: capabilityId,
        endpoint: endpointKey,
      });
    }

    next();
  };
}

// ─── Contract Integrity Check ────────────────────────────────────────────

/**
 * verifyContractIntegrity — Middleware to verify contract hashes.
 * Useful for health checks and runtime verification.
 */
export function contractIntegrityCheck(req, res, next) {
  const results = capabilityRegistry.verifyAllContracts();
  const allValid = Object.values(results).every(r => r.valid);

  if (!allValid) {
    const failures = Object.entries(results)
      .filter(([, r]) => !r.valid)
      .map(([id, r]) => ({ capability_id: id, error: r.error }));

    logger.error('[POLICY_ENGINE] Contract integrity check failed:', failures);
    return res.status(503).json({
      success: false,
      error: 'CONTRACT_INTEGRITY_VIOLATION',
      message: 'Capability contracts have been tampered with',
      failures,
    });
  }

  next();
}

// ─── Exports ─────────────────────────────────────────────────────────────

export default {
  policyEnforcement,
  guardCollection,
  validateCapabilityInput,
  contractIntegrityCheck,
};
