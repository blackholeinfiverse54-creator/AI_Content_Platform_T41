#!/usr/bin/env node

/**
 * ARTHA Independent Capability Verifier — v3.0
 *
 * Comprehensive verification with 18 checks.
 * Standalone: reads files directly, NO imports from src/.
 * Machine-readable JSON output to evidence/ directory.
 *
 * CLI: node verification/independent_verifier.js [--ci]
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
const ROUTE_MAP_FILE = join(PROJECT_ROOT, 'contracts', 'capability_contracts', 'capability_route_map.json');
const SRC_DIR = join(ROOT, 'src');
const EVIDENCE_DIR = join(PROJECT_ROOT, 'evidence');

const REQUIRED_FIELDS = [
  'capability_id', 'capability_name', 'version', 'status',
  'authority_owned', 'authority_explicitly_not_owned', 'api_endpoints',
  'authentication', 'dependencies', 'consumers',
  'provider_service', 'failure_behavior'
];

const VALID_STATUSES = ['STABLE', 'EXPERIMENTAL', 'DEPRECATED'];

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
    try {
      const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
      const contract = JSON.parse(raw);
      contracts[contract.capability_id] = contract;
    } catch (err) {
      console.error(`  Failed to load ${file}: ${err.message}`);
    }
  }
  return contracts;
}

function loadRouteMap() {
  if (existsSync(ROUTE_MAP_FILE)) {
    return JSON.parse(readFileSync(ROUTE_MAP_FILE, 'utf-8'));
  }
  return { routes: [] };
}

function computeHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// ─── CHECKS ──────────────────────────────────────────────────

function v01_contractSchema(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const missing = REQUIRED_FIELDS.filter(f => !c[f]);
    if (missing.length > 0) {
      issues.push({ capability: id, missing_fields: missing });
    }
  }
  return {
    check: 'V01',
    name: 'Contract Schema',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? `All ${Object.keys(contracts).length} contracts have all ${REQUIRED_FIELDS.length} required fields`
      : `${issues.length} contracts have missing fields`,
    issues,
  };
}

function v02_authorityNonOverlap(contracts) {
  const ownership = {};
  for (const [id, c] of Object.entries(contracts)) {
    const models = c.provider_model || [];
    for (const m of models) {
      const name = m.split('/').pop().replace('.js', '');
      if (!ownership[name]) ownership[name] = [];
      ownership[name].push(id);
    }
  }
  const conflicts = Object.entries(ownership)
    .filter(([, owners]) => owners.length > 1)
    .map(([model, owners]) => ({ collection: model, owners }));
  return {
    check: 'V02',
    name: 'Authority Non-Overlap',
    status: conflicts.length === 0 ? 'PASS' : 'FAIL',
    detail: conflicts.length === 0
      ? `All ${Object.keys(ownership).length} collections have single ownership`
      : `${conflicts.length} collections have overlapping ownership`,
    issues: conflicts,
  };
}

function v03_routeMapCoverage(contracts, routeMap) {
  const prefixes = (routeMap.routes || []).map(r => r.prefix);
  const uncovered = [];
  for (const [id, c] of Object.entries(contracts)) {
    const endpoints = c.api_endpoints || {};
    for (const [name, ep] of Object.entries(endpoints)) {
      if (!ep.path) continue;
      const covered = prefixes.some(p => ep.path.startsWith(p));
      if (!covered) {
        uncovered.push({ capability: id, endpoint: name, path: ep.path });
      }
    }
  }
  return {
    check: 'V03',
    name: 'Route Map Coverage',
    status: uncovered.length === 0 ? 'PASS' : 'FAIL',
    detail: uncovered.length === 0
      ? 'All contract endpoints covered by route map'
      : `${uncovered.length} endpoints not covered`,
    issues: uncovered,
  };
}

function v04_serviceFileExistence(contracts) {
  const missing = [];
  for (const [id, c] of Object.entries(contracts)) {
    const sp = c.provider_service;
    if (!sp) continue;
    if (!dualPathExists(sp)) {
      missing.push({ capability: id, path: sp });
    }
  }
  return {
    check: 'V04',
    name: 'Service File Existence',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    detail: missing.length === 0
      ? 'All provider service files exist'
      : `${missing.length} service files not found`,
    issues: missing,
  };
}

function v05_modelFileExistence(contracts) {
  const missing = [];
  for (const [id, c] of Object.entries(contracts)) {
    const models = c.provider_model || [];
    for (const mp of models) {
      if (!dualPathExists(mp)) {
        missing.push({ capability: id, path: mp });
      }
    }
  }
  return {
    check: 'V05',
    name: 'Model File Existence',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    detail: missing.length === 0
      ? 'All provider model files exist'
      : `${missing.length} model files not found`,
    issues: missing,
  };
}

function v06_dependencyGraphAcyclicity(contracts) {
  const graph = {};
  for (const [id, c] of Object.entries(contracts)) {
    graph[id] = [];
    const deps = c.dependencies?.internal || [];
    for (const dep of deps) {
      for (const [otherId, otherC] of Object.entries(contracts)) {
        if (otherId !== id && otherC.provider_service?.includes(dep.service)) {
          graph[id].push(otherId);
        }
      }
    }
  }

  const visited = new Set();
  const inStack = new Set();
  const cycles = [];

  function dfs(node, path) {
    if (inStack.has(node)) {
      cycles.push([...path.slice(path.indexOf(node)), node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    path.push(node);
    for (const neighbor of (graph[node] || [])) {
      dfs(neighbor, path);
    }
    path.pop();
    inStack.delete(node);
  }

  for (const node of Object.keys(graph)) {
    dfs(node, []);
  }

  return {
    check: 'V06',
    name: 'Dependency Graph Acyclicity',
    status: cycles.length === 0 ? 'PASS' : 'FAIL',
    detail: cycles.length === 0
      ? 'No dependency cycles detected'
      : `${cycles.length} cycles detected`,
    issues: cycles,
  };
}

function v07_versionConsistency(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const ver = c.version;
    if (!ver || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(ver)) {
      issues.push({ capability: id, version: ver, issue: 'Invalid semver format' });
    }
    if (!c.version_history || !Array.isArray(c.version_history) || c.version_history.length === 0) {
      issues.push({ capability: id, issue: 'Missing or empty version_history' });
    } else {
      const latest = c.version_history[c.version_history.length - 1];
      if (latest.version !== ver) {
        issues.push({ capability: id, issue: `version_history latest (${latest.version}) !== version (${ver})` });
      }
    }
  }
  return {
    check: 'V07',
    name: 'Version Consistency',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All contracts have valid semver and matching version_history'
      : `${issues.length} version issues`,
    issues,
  };
}

function v08_authConfig(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    if (!c.authentication) {
      issues.push({ capability: id, issue: 'Missing authentication config' });
    } else if (!c.authentication.type) {
      issues.push({ capability: id, issue: 'Authentication missing type field' });
    }
  }
  return {
    check: 'V08',
    name: 'Authentication Config Validity',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All contracts have valid authentication config'
      : `${issues.length} auth config issues`,
    issues,
  };
}

function v09_readOnlyEnforcement(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const traceRO = c.trace_requirements?.read_only === true;
    const descRO = (c.description || '').toLowerCase().includes('read-only');
    if (!traceRO && !descRO) continue;

    const endpoints = c.api_endpoints || {};
    const mutating = Object.entries(endpoints)
      .filter(([, ep]) => ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method))
      .map(([name, ep]) => ({ endpoint: name, method: ep.method, path: ep.path }));

    if (mutating.length > 0) {
      issues.push({ capability: id, mutating_endpoints: mutating });
    }
  }
  return {
    check: 'V09',
    name: 'Read-Only Enforcement',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Read-only capabilities have no mutating endpoints'
      : `${issues.length} read-only violations`,
    issues,
  };
}

function v10_failureBehavior(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    if (!c.failure_behavior || Object.keys(c.failure_behavior).length === 0) {
      issues.push({ capability: id, issue: 'Missing or empty failure_behavior' });
    }
  }
  return {
    check: 'V10',
    name: 'Failure Behavior Completeness',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All contracts define failure_behavior'
      : `${issues.length} contracts missing failure_behavior`,
    issues,
  };
}

function v11_consumerDeclaration(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    if (!c.consumers || !Array.isArray(c.consumers) || c.consumers.length === 0) {
      issues.push({ capability: id, issue: 'No consumers declared' });
    }
  }
  return {
    check: 'V11',
    name: 'Consumer Declaration',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All contracts declare at least one consumer'
      : `${issues.length} contracts have no consumers`,
    issues,
  };
}

function v12_consumerExistence(contracts) {
  const knownExternal = ['ARTHA', 'SETU', 'TANTRA', 'Kubernetes', 'Prometheus', 'Grafana', 'External Tally users'];
  const capabilityIds = new Set(Object.keys(contracts));
  const issues = [];

  for (const [id, c] of Object.entries(contracts)) {
    for (const consumer of (c.consumers || [])) {
      const prod = consumer.product;
      if (!capabilityIds.has(prod) && !knownExternal.includes(prod)) {
        issues.push({ capability: id, unknown_consumer: prod });
      }
    }
  }
  return {
    check: 'V12',
    name: 'Consumer Existence',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All consumer names are valid capability IDs or known external systems'
      : `${issues.length} unknown consumers`,
    issues,
  };
}

function v13_evidenceRequirements(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const er = c.evidence_requirements || {};
    const hasHashChain = Object.keys(er).some(k => k.includes('hash'));
    if (hasHashChain && !er.hash_chain && !er.content_hash) {
      issues.push({ capability: id, issue: 'Has hash reference but no hash algorithm defined' });
    }
  }
  return {
    check: 'V13',
    name: 'Evidence Requirements',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'Evidence requirements with hash chains define hash algorithms'
      : `${issues.length} evidence requirement issues`,
    issues,
  };
}

function v14_replayCompatibility(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const rc = c.replay_compatibility;
    if (rc && rc.deterministic === true) {
      if (!rc.replay_method) {
        issues.push({ capability: id, issue: 'deterministic=true but no replay_method defined' });
      }
    } else if (!rc) {
      issues.push({ capability: id, issue: 'No replay_compatibility defined (not marked non-replayable)' });
    }
  }
  return {
    check: 'V14',
    name: 'Replay Compatibility',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All replay compatibility declarations are complete'
      : `${issues.length} replay compatibility issues`,
    issues,
  };
}

function v15_noHiddenDependencies(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const sp = c.provider_service;
    if (!sp || !dualPathExists(sp)) continue;

    const fullPath = existsSync(join(ROOT, sp)) ? join(ROOT, sp) : join(PROJECT_ROOT, sp);
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const importMatches = content.match(/from\s+['"]\.\/[^'"]+['"]/g) || [];
      const declaredServices = (c.dependencies?.internal || []).map(d => d.service);
      const declaredModels = c.dependencies?.models || [];

      for (const imp of importMatches) {
        const match = imp.match(/from\s+['"]\.\/([^'"]+)['"]/);
        if (!match) continue;
        const imported = match[1].split('/').pop();
        const baseName = imported.replace('.service', '').replace('.js', '');
        const isDeclared = declaredServices.some(s => s.includes(baseName)) ||
                          declaredModels.some(m => m.toLowerCase() === baseName.toLowerCase());
        if (!isDeclared && !imported.includes('server') && !imported.includes('app')) {
          issues.push({ capability: id, undeclared_import: imported });
        }
      }
    } catch {
      // Skip if file can't be read
    }
  }
  return {
    check: 'V15',
    name: 'No Hidden Dependencies',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'No undeclared imports found in provider services'
      : `${issues.length} undeclared imports`,
    issues,
  };
}

function v16_authorityConsistency(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const owned = c.authority_owned || [];
    const notOwned = c.authority_explicitly_not_owned || [];
    for (const item of notOwned) {
      const lower = item.toLowerCase();
      const conflicts = owned.filter(o => {
        const oLower = o.toLowerCase();
        return lower.includes(oLower) || oLower.includes(lower);
      });
      if (conflicts.length > 0) {
        issues.push({
          capability: id,
          owned_item: conflicts[0],
          not_owned_item: item,
        });
      }
    }
  }
  return {
    check: 'V16',
    name: 'Authority Owned/Not-Owned Consistency',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'No contradictions between authority_owned and authority_explicitly_not_owned'
      : `${issues.length} contradictions found`,
    issues,
  };
}

function v17_apiEndpointSchema(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const endpoints = c.api_endpoints || {};
    for (const [name, ep] of Object.entries(endpoints)) {
      const missing = [];
      if (!ep.method) missing.push('method');
      if (!ep.path) missing.push('path');
      if (!ep.roles) missing.push('roles');
      if (missing.length > 0) {
        issues.push({ capability: id, endpoint: name, missing_fields: missing });
      }
    }
  }
  return {
    check: 'V17',
    name: 'API Endpoint Schema',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All endpoints have method, path, and roles'
      : `${issues.length} endpoints with incomplete schema`,
    issues,
  };
}

function v18_contentHashIntegrity(contracts) {
  const hashes = {};
  const duplicates = [];
  for (const [id, c] of Object.entries(contracts)) {
    const hash = computeHash(c);
    if (hashes[hash]) {
      duplicates.push({ hash: hash.substring(0, 16), contracts: [hashes[hash], id] });
    }
    hashes[hash] = id;
  }
  return {
    check: 'V18',
    name: 'Content Hash Integrity',
    status: duplicates.length === 0 ? 'PASS' : 'FAIL',
    detail: duplicates.length === 0
      ? `All ${Object.keys(contracts).length} contracts produce unique SHA-256 hashes`
      : `${duplicates.length} duplicate contract hashes`,
    issues: duplicates,
  };
}

// ─── MAIN ────────────────────────────────────────────────────

function main() {
  const isCI = process.argv.includes('--ci');
  const startTime = Date.now();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   ARTHA Independent Capability Verifier v3.0             ║');
  console.log('║   18-Check Comprehensive Verification                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const contracts = loadContracts();
  const routeMap = loadRouteMap();
  const contractCount = Object.keys(contracts).length;
  console.log(`  Loaded ${contractCount} capability contracts`);
  console.log(`  Route map: ${(routeMap.routes || []).length} routes\n`);

  const checks = [
    v01_contractSchema(contracts),
    v02_authorityNonOverlap(contracts),
    v03_routeMapCoverage(contracts, routeMap),
    v04_serviceFileExistence(contracts),
    v05_modelFileExistence(contracts),
    v06_dependencyGraphAcyclicity(contracts),
    v07_versionConsistency(contracts),
    v08_authConfig(contracts),
    v09_readOnlyEnforcement(contracts),
    v10_failureBehavior(contracts),
    v11_consumerDeclaration(contracts),
    v12_consumerExistence(contracts),
    v13_evidenceRequirements(contracts),
    v14_replayCompatibility(contracts),
    v15_noHiddenDependencies(contracts),
    v16_authorityConsistency(contracts),
    v17_apiEndpointSchema(contracts),
    v18_contentHashIntegrity(contracts),
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
    verifier: 'ARTH Independent Capability Verifier',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    contract_count: contractCount,
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
  const evidencePath = join(EVIDENCE_DIR, `capability-verification-${date}.json`);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`  Evidence written to: ${evidencePath}`);
  console.log(`  Evidence hash: ${evidenceHash.substring(0, 16)}...\n`);

  if (isCI && failed > 0) {
    process.exit(1);
  }
}

main();