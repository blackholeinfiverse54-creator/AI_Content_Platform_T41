#!/usr/bin/env node

/**
 * ARTHA Authority Ownership Verifier
 *
 * Verifies authority ownership across all capability contracts.
 * Checks collection ownership maps, conflict detection, specificity,
 * blocked mutations, and middleware mounting.
 *
 * CLI: node verification/authority_verifier.js [--ci]
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
const SERVER_FILE = join(ROOT, 'src', 'server.js');
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

function getCollectionOwnerMap(contracts) {
  const map = {};
  for (const [id, c] of Object.entries(contracts)) {
    const models = c.provider_model || [];
    for (const m of models) {
      const name = m.split('/').pop().replace('.js', '');
      if (!map[name]) map[name] = [];
      map[name].push(id);
    }
  }
  return map;
}

function getAllModelFiles() {
  const modelsDir = join(ROOT, 'src', 'models');
  if (!existsSync(modelsDir)) return [];
  return readdirSync(modelsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace('.js', ''));
}

// ─── AUTHORITY CHECKS ────────────────────────────────────────

function a01_noCollectionOverlap(contracts) {
  const map = getCollectionOwnerMap(contracts);
  const conflicts = Object.entries(map)
    .filter(([, owners]) => owners.length > 1)
    .map(([collection, owners]) => ({ collection, owners }));
  return {
    check: 'A01',
    name: 'No Collection Overlap',
    status: conflicts.length === 0 ? 'PASS' : 'FAIL',
    detail: conflicts.length === 0
      ? `All ${Object.keys(map).length} collections have single ownership`
      : `${conflicts.length} collections owned by multiple capabilities`,
    issues: conflicts,
  };
}

function a02_everyCollectionHasOwner(contracts) {
  const map = getCollectionOwnerMap(contracts);
  const allModels = getAllModelFiles();
  const unowned = allModels.filter(m => !map[m]);
  return {
    check: 'A02',
    name: 'Every Collection Has Owner',
    status: unowned.length === 0 ? 'PASS' : 'FAIL',
    detail: unowned.length === 0
      ? 'All model collections are owned by at least one capability'
      : `${unowned.length} collections have no owner: ${unowned.join(', ')}`,
    issues: unowned.map(m => ({ collection: m })),
  };
}

function a03_noPhantomCollections(contracts) {
  const map = getCollectionOwnerMap(contracts);
  const allModels = new Set(getAllModelFiles());
  const phantom = Object.keys(map).filter(c => !allModels.has(c));
  return {
    check: 'A03',
    name: 'No Phantom Collections',
    status: phantom.length === 0 ? 'PASS' : 'FAIL',
    detail: phantom.length === 0
      ? 'All claimed collections exist as model files'
      : `${phantom.length} collections claimed but no model file exists: ${phantom.join(', ')}`,
    issues: phantom.map(c => ({ collection: c })),
  };
}

function a04_ownedEntriesSpecific(contracts) {
  const vaguePatterns = [/^all data$/i, /^everything$/i, /^all.*$/i, /^all collections$/i];
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const owned = c.authority_owned || [];
    for (const item of owned) {
      const trimmed = item.trim();
      if (trimmed.length < 10) {
        issues.push({ capability: id, entry: trimmed, reason: 'Too vague (< 10 chars)' });
      }
      for (const pattern of vaguePatterns) {
        if (pattern.test(trimmed) && trimmed.length < 20) {
          issues.push({ capability: id, entry: trimmed, reason: 'Matches vague pattern' });
          break;
        }
      }
    }
  }
  return {
    check: 'A04',
    name: 'Owned Entries Specificity',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All authority_owned entries are specific and descriptive'
      : `${issues.length} entries are too vague`,
    issues,
  };
}

function a05_notOwnedEntriesMeaningful(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const notOwned = c.authority_explicitly_not_owned || [];
    if (notOwned.length === 0) {
      issues.push({ capability: id, reason: 'No authority_explicitly_not_owned defined' });
      continue;
    }
    for (const item of notOwned) {
      if (item.trim().length < 5) {
        issues.push({ capability: id, entry: item, reason: 'Entry too short to be meaningful' });
      }
    }
  }
  return {
    check: 'A05',
    name: 'Not-Owned Entries Meaningful',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All authority_explicitly_not_owned entries are meaningful'
      : `${issues.length} issues with not-owned entries`,
    issues,
  };
}

function a06_blockedMutationsDefined(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const endpoints = c.api_endpoints || {};
    const hasMutating = Object.values(endpoints).some(ep =>
      ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method)
    );

    const isReadOnly = c.trace_requirements?.read_only === true ||
                       (c.description || '').toLowerCase().includes('read-only');

    if (hasMutating && !isReadOnly) {
      const fb = c.failure_behavior || {};
      const hasMutationProtection = Object.keys(fb).some(k =>
        k.includes('abort') || k.includes('rollback') || k.includes('validation') ||
        k.includes('failure') || k.includes('tamper')
      );
      if (!hasMutationProtection) {
        issues.push({
          capability: id,
          reason: 'Has mutating endpoints but no failure behaviors covering mutation protection',
        });
      }
    }
  }
  return {
    check: 'A06',
    name: 'Blocked Mutations Defined',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Mutable capabilities have failure behaviors covering mutations'
      : `${issues.length} capabilities lack mutation protection`,
    issues,
  };
}

function a07_readOnlyCannotMutate(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const isReadOnly = c.trace_requirements?.read_only === true ||
                       (c.description || '').toLowerCase().includes('read-only');
    if (!isReadOnly) continue;

    const endpoints = c.api_endpoints || {};
    const mutating = Object.entries(endpoints)
      .filter(([, ep]) => ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method))
      .map(([name, ep]) => ({ endpoint: name, method: ep.method, path: ep.path }));

    if (mutating.length > 0) {
      issues.push({ capability: id, mutating_endpoints: mutating });
    }
  }
  return {
    check: 'A07',
    name: 'Read-Only Cannot Mutate',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Read-only capabilities have no mutating endpoints'
      : `${issues.length} read-only capabilities have mutating endpoints`,
    issues,
  };
}

function a08_authorityMiddlewareMounted() {
  const issues = [];
  if (!existsSync(SERVER_FILE)) {
    return {
      check: 'A08',
      name: 'Authority Middleware Mounted',
      status: 'SKIP',
      detail: 'server.js not found — cannot verify middleware mounting',
      issues: [],
    };
  }

  try {
    const serverContent = readFileSync(SERVER_FILE, 'utf-8');

    const hasImport = serverContent.includes('authorityEnforcement') ||
                      serverContent.includes('authorityBoundary');
    const hasMount = serverContent.includes('app.use(authorityEnforcement)') ||
                     serverContent.includes('app.use(capabilityGuard)');

    if (!hasImport) {
      issues.push({ issue: 'authorityEnforcement not imported in server.js' });
    }
    if (!hasMount) {
      issues.push({ issue: 'authorityEnforcement middleware not mounted via app.use()' });
    }
  } catch (err) {
    issues.push({ issue: `Could not read server.js: ${err.message}` });
  }

  return {
    check: 'A08',
    name: 'Authority Middleware Mounted',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'authorityEnforcement is imported and mounted in server.js'
      : `${issues.length} middleware issues`,
    issues,
  };
}

// ─── MAIN ────────────────────────────────────────────────────

function main() {
  const isCI = process.argv.includes('--ci');
  const startTime = Date.now();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   ARTHA Authority Ownership Verifier                      ║');
  console.log('║   Verifying authority boundaries across capabilities      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const contracts = loadContracts();
  const map = getCollectionOwnerMap(contracts);
  console.log(`  Loaded ${Object.keys(contracts).length} contracts`);
  console.log(`  Collections: ${Object.keys(map).length} (${Object.keys(map).join(', ')})\n`);

  const checks = [
    a01_noCollectionOverlap(contracts),
    a02_everyCollectionHasOwner(contracts),
    a03_noPhantomCollections(contracts),
    a04_ownedEntriesSpecific(contracts),
    a05_notOwnedEntriesMeaningful(contracts),
    a06_blockedMutationsDefined(contracts),
    a07_readOnlyCannotMutate(contracts),
    a08_authorityMiddlewareMounted(),
  ];

  const passed = checks.filter(c => c.status === 'PASS').length;
  const failed = checks.filter(c => c.status === 'FAIL').length;
  const skipped = checks.filter(c => c.status === 'SKIP').length;
  const duration = Date.now() - startTime;

  for (const c of checks) {
    const icon = c.status === 'PASS' ? '  ✓' : c.status === 'SKIP' ? '  ○' : '  ✗';
    console.log(`${icon} ${c.check} ${c.name}: ${c.detail}`);
  }

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log(`│  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (${checks.length} total)`);
  console.log(`│  Duration: ${duration}ms`);
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const evidence = {
    verifier: 'ARTH Authority Ownership Verifier',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    contract_count: Object.keys(contracts).length,
    collection_map: map,
    results: checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      skipped,
      all_passed: failed === 0,
    },
  };

  const evidenceHash = computeHash(evidence);
  evidence.evidence_hash = evidenceHash;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const evidencePath = join(EVIDENCE_DIR, `authority-verification-${date}.json`);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`  Evidence written to: ${evidencePath}`);
  console.log(`  Evidence hash: ${evidenceHash.substring(0, 16)}...\n`);

  if (isCI && failed > 0) {
    process.exit(1);
  }
}

main();