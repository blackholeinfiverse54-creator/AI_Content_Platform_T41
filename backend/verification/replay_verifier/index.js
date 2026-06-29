#!/usr/bin/env node

/**
 * ARTHA Replay Determinism Verifier
 *
 * Verifies replay compatibility for all capability contracts.
 * Checks deterministic replay guarantees, trace integration,
 * replay state isolation, and audit trail completeness.
 *
 * CLI: node verification/replay_verifier.js [--ci]
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const PROJECT_ROOT = join(ROOT, '..', '..');
const CONTRACT_DIR = join(PROJECT_ROOT, 'contracts', 'capability_contracts');
const EVIDENCE_DIR = join(PROJECT_ROOT, 'evidence');

function dualPathExists(relativePath) {
  return existsSync(join(ROOT, relativePath)) || existsSync(join(PROJECT_ROOT, relativePath));
}

function loadContracts() {
  const contracts = {};
  if (!existsSync(CONTRACT_DIR)) {
    throw new Error(`Contract directory not found: ${CONTRACT_DIR}`);
  }
  const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
  for (const file of files) {
    const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
    const contract = JSON.parse(raw);
    contracts[contract.capability_id] = contract;
  }
  return contracts;
}

function computeHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// ─── REPLAY CHECKS ──────────────────────────────────────────

function checkReplayDeterminism(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (!rc) {
      issues.push({
        capability: id,
        issue: 'No replay_compatibility block defined',
        severity: 'MEDIUM',
      });
      continue;
    }
    if (rc.deterministic === true) {
      if (!rc.replay_method) {
        issues.push({ capability: id, issue: 'deterministic=true but no replay_method', severity: 'HIGH' });
      }
      if (!rc.prerequisites && !rc.limitations) {
        issues.push({ capability: id, issue: 'No prerequisites or limitations documented', severity: 'LOW' });
      }
    } else if (rc.deterministic === false || rc.deterministic === undefined) {
      if (!rc.justification && !rc.limitations) {
        issues.push({
          capability: id,
          issue: 'Non-deterministic replay without justification or limitations',
          severity: 'LOW',
        });
      }
    }
  }
  return {
    check: 'R01',
    name: 'Replay Determinism',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All replay compatibility declarations are complete'
      : `${issues.length} replay issues`,
    issues,
  };
}

function checkTraceIdFormat(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    if (c.replay_compatibility?.deterministic !== true) continue;
    const tr = c.trace_requirements || {};
    if (!tr.trace_id_format && !tr.trace_id_required) {
      issues.push({
        capability: id,
        issue: 'Deterministic replay capability has no trace_id_format specified',
        severity: 'MEDIUM',
      });
    }
  }
  return {
    check: 'R02',
    name: 'Trace ID Format',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All deterministic replay capabilities specify trace_id format'
      : `${issues.length} missing trace_id format declarations`,
    issues,
  };
}

function checkReplayCountTracking(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (rc?.deterministic !== true) continue;

    const hasReplaySupport = c.trace_requirements?.self_referential === true ||
                             (rc.replay_support || '').includes('count') ||
                             (rc.replay_method || '').includes('count') ||
                             (rc.replay_method || '').includes('replay');

    const er = c.evidence_requirements || {};
    const hasReplayIntegrity = er.replay_integrity || '';

    if (!hasReplaySupport && !hasReplayIntegrity) {
      issues.push({
        capability: id,
        issue: 'No replay count tracking mechanism documented',
        severity: 'LOW',
      });
    }
  }
  return {
    check: 'R03',
    name: 'Replay Count Tracking',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Replay count tracking mechanisms documented'
      : `${issues.length} capabilities lack replay count tracking`,
    issues,
  };
}

function checkReplayInputsOutputs(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (rc?.deterministic !== true) continue;

    const hasInputSchemas = c.input_schemas && Object.keys(c.input_schemas).length > 0;
    const hasOutputSchemas = c.output_schemas && Object.keys(c.output_schemas).length > 0;

    if (!hasInputSchemas) {
      issues.push({ capability: id, issue: 'No input_schemas defined for replay', severity: 'MEDIUM' });
    }
    if (!hasOutputSchemas) {
      issues.push({ capability: id, issue: 'No output_schemas defined for replay', severity: 'MEDIUM' });
    }
  }
  return {
    check: 'R04',
    name: 'Replay Inputs/Outputs',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All deterministic capabilities define input and output schemas'
      : `${issues.length} schema issues`,
    issues,
  };
}

function checkReplayDataIntegrity(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (rc?.deterministic !== true) continue;

    const er = c.evidence_requirements || {};
    const hasIntegrity = er.hash_chain || er.content_hash || er.replay_integrity ||
                         er.stage_history || er.immutability;

    if (!hasIntegrity) {
      issues.push({
        capability: id,
        issue: 'No data integrity mechanisms defined for replay',
        severity: 'MEDIUM',
      });
    }
  }
  return {
    check: 'R05',
    name: 'Replay Data Integrity',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Data integrity mechanisms defined for all deterministic capabilities'
      : `${issues.length} capabilities lack data integrity for replay`,
    issues,
  };
}

function checkReplayStateIsolation(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (rc?.deterministic !== true) continue;

    const fb = c.failure_behavior || {};
    const hasAbortOrRollback = Object.keys(fb).some(k =>
      k.includes('abort') || k.includes('rollback') || k.includes('session')
    );

    const trace = c.trace_requirements || {};
    const hasIsolation = trace.read_only === true || rc.prerequisites?.some(p =>
      p.toLowerCase().includes('isolat') || p.toLowerCase().includes('no side')
    );

    if (!hasAbortOrRollback && !hasIsolation) {
      issues.push({
        capability: id,
        issue: 'No explicit replay state isolation documented',
        severity: 'LOW',
      });
    }
  }
  return {
    check: 'R06',
    name: 'Replay State Isolation',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'State isolation mechanisms documented for replay'
      : `${issues.length} capabilities lack state isolation documentation`,
    issues,
  };
}

function checkReplayAuditTrail(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (rc?.deterministic !== true) continue;

    const er = c.evidence_requirements || {};
    const hasAudit = er.audit_trail || er.stage_history || er.dispatch_record ||
                     er.replay_integrity || er.immutability;

    if (!hasAudit) {
      issues.push({
        capability: id,
        issue: 'No audit trail mechanism documented for replay',
        severity: 'LOW',
      });
    }
  }
  return {
    check: 'R07',
    name: 'Replay Audit Trail',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Audit trail mechanisms documented for all deterministic capabilities'
      : `${issues.length} capabilities lack audit trail for replay`,
    issues,
  };
}

function checkReplayHashChain(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (rc?.deterministic !== true) continue;

    const er = c.evidence_requirements || {};
    const hasHash = er.hash_chain || er.content_hash || er.immutability;
    const endpoints = c.api_endpoints || {};
    const hasVerifyEndpoint = Object.values(endpoints).some(ep =>
      (ep.path || '').includes('verify') || (ep.path || '').includes('chain')
    );

    if (!hasHash && !hasVerifyEndpoint) {
      issues.push({
        capability: id,
        issue: 'No hash chain or verification mechanism for replay consistency',
        severity: 'LOW',
      });
    }
  }
  return {
    check: 'R08',
    name: 'Replay Hash Chain',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Hash chain mechanisms defined for replay consistency'
      : `${issues.length} capabilities lack hash chain for replay`,
    issues,
  };
}

// ─── MAIN ────────────────────────────────────────────────────

function main() {
  const isCI = process.argv.includes('--ci');
  const startTime = Date.now();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   ARTHA Replay Determinism Verifier                      ║');
  console.log('║   Verifying replay guarantees across all capabilities    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const contracts = loadContracts();
  const deterministic = Object.entries(contracts)
    .filter(([, c]) => c.replay_compatibility?.deterministic === true)
    .map(([id]) => id);
  const nonDeterministic = Object.keys(contracts).filter(id => !deterministic.includes(id));

  console.log(`  Loaded ${Object.keys(contracts).length} contracts`);
  console.log(`  Deterministic: ${deterministic.length} (${deterministic.join(', ')})`);
  console.log(`  Non-deterministic: ${nonDeterministic.length} (${nonDeterministic.join(', ')})\n`);

  const checks = [
    checkReplayDeterminism(contracts),
    checkTraceIdFormat(contracts),
    checkReplayCountTracking(contracts),
    checkReplayInputsOutputs(contracts),
    checkReplayDataIntegrity(contracts),
    checkReplayStateIsolation(contracts),
    checkReplayAuditTrail(contracts),
    checkReplayHashChain(contracts),
  ];

  const passed = checks.filter(c => c.status === 'PASS').length;
  const failed = checks.filter(c => c.status === 'FAIL').length;
  const duration = Date.now() - startTime;

  for (const c of checks) {
    const icon = c.status === 'PASS' ? '  ✓' : '  ✗';
    console.log(`${icon} ${c.check} ${c.name}: ${c.detail}`);
  }

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log(`│  RESULTS: ${passed} passed, ${failed} failed (${checks.length} total)`);
  console.log(`│  Duration: ${duration}ms`);
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const evidence = {
    verifier: 'ARTH Replay Determinism Verifier',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    contract_count: Object.keys(contracts).length,
    deterministic_contracts: deterministic,
    non_deterministic_contracts: nonDeterministic,
    results: checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      all_passed: failed === 0,
    },
  };

  const evidenceHash = computeHash(evidence);
  evidence.evidence_hash = evidenceHash;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const evidencePath = join(EVIDENCE_DIR, `replay-verification-${date}.json`);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`  Evidence written to: ${evidencePath}`);
  console.log(`  Evidence hash: ${evidenceHash.substring(0, 16)}...\n`);

  if (isCI && failed > 0) {
    process.exit(1);
  }
}

main();