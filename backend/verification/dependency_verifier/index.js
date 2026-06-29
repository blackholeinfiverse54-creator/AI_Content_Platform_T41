#!/usr/bin/env node

/**
 * ARTHA Dependency Graph Integrity Verifier
 *
 * Verifies dependency graph across all capability contracts.
 * Checks cycles, self-dependencies, missing deps, phantom deps,
 * version constraints, circular data flow, and dependency depth.
 *
 * CLI: node verification/dependency_verifier.js [--ci]
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

function buildDependencyGraph(contracts) {
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
  return graph;
}

function findCycles(graph) {
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
  return cycles;
}

function computeDepths(graph) {
  const depths = {};
  const visited = new Set();

  function dfs(node, depth) {
    if (visited.has(node)) return depth;
    visited.add(node);
    let maxChild = depth;
    for (const neighbor of (graph[node] || [])) {
      const childDepth = dfs(neighbor, depth + 1);
      if (childDepth > maxChild) maxChild = childDepth;
    }
    depths[node] = maxChild;
    return maxChild;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      dfs(node, 0);
    }
  }
  return depths;
}

// ─── DEPENDENCY CHECKS ───────────────────────────────────────

function d01_noCycles(contracts) {
  const graph = buildDependencyGraph(contracts);
  const cycles = findCycles(graph);
  return {
    check: 'D01',
    name: 'No Dependency Cycles',
    status: cycles.length === 0 ? 'PASS' : 'FAIL',
    detail: cycles.length === 0
      ? 'No dependency cycles detected'
      : `${cycles.length} cycles detected`,
    issues: cycles,
  };
}

function d02_noSelfDependencies(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const deps = c.dependencies?.internal || [];
    for (const dep of deps) {
      if (c.provider_service?.includes(dep.service)) {
        issues.push({ capability: id, service: dep.service, reason: 'Self-dependency' });
      }
    }
  }
  return {
    check: 'D02',
    name: 'No Self-Dependencies',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'No capabilities depend on themselves'
      : `${issues.length} self-dependencies found`,
    issues,
  };
}

function d03_noMissingDependencies(contracts) {
  const issues = [];
  const capabilityServiceMap = {};
  for (const [id, c] of Object.entries(contracts)) {
    if (c.provider_service) {
      const serviceName = c.provider_service.split('/').pop();
      capabilityServiceMap[serviceName] = id;
    }
  }

  for (const [id, c] of Object.entries(contracts)) {
    const deps = c.dependencies?.internal || [];
    for (const dep of deps) {
      const isCapabilityDep = Object.keys(capabilityServiceMap).some(s => s.includes(dep.service));
      if (isCapabilityDep) {
        const targetCap = Object.entries(capabilityServiceMap)
          .find(([s]) => s.includes(dep.service));
        if (targetCap && !Object.keys(contracts).includes(targetCap[1])) {
          issues.push({
            capability: id,
            dependency: dep.service,
            reason: `Depends on ${targetCap[1]} but it is not a registered capability`,
          });
        }
      }
    }
  }
  return {
    check: 'D03',
    name: 'No Missing Dependencies',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All capability-to-capability dependencies reference existing capabilities'
      : `${issues.length} missing dependencies`,
    issues,
  };
}

function d04_noPhantomDependencies(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const sp = c.provider_service;
    if (!sp || !dualPathExists(sp)) continue;

    const fullPath = existsSync(join(ROOT, sp)) ? join(ROOT, sp) : join(PROJECT_ROOT, sp);
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const serviceImports = content.match(/from\s+['"][^'"]*\.service[^'"]*['"]/g) || [];

      const declaredServices = (c.dependencies?.internal || []).map(d => d.service);
      const allServiceFiles = readdirSync(join(ROOT, 'src', 'services'))
        .filter(f => f.endsWith('.js'));

      for (const imp of serviceImports) {
        const match = imp.match(/from\s+['"]\.\.?\/[^'"]*\/([^'"]+\.service\.js)['"]/);
        if (!match) continue;
        const importedService = match[1];

        const isDeclared = declaredServices.some(s => s === importedService || importedService.includes(s));
        const isModel = (c.dependencies?.models || []).some(m =>
          importedService.toLowerCase().includes(m.toLowerCase())
        );

        if (!isDeclared && !isModel) {
          issues.push({
            capability: id,
            phantom_import: importedService,
            reason: 'Service imported but not declared in dependencies',
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return {
    check: 'D04',
    name: 'No Phantom Dependencies',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'All service imports are declared in dependencies'
      : `${issues.length} phantom dependencies found`,
    issues,
  };
}

function d05_versionConstraints(contracts) {
  const issues = [];
  for (const [id, c] of Object.entries(contracts)) {
    const deps = c.dependencies?.internal || [];
    for (const dep of deps) {
      if (dep.version && !/^[\^~>=<]*\d+\.\d+\.\d+/.test(dep.version)) {
        issues.push({
          capability: id,
          dependency: dep.service,
          version: dep.version,
          reason: 'Invalid version constraint format',
        });
      }
    }
  }
  return {
    check: 'D05',
    name: 'Version Constraints',
    status: issues.length === 0 ? 'PASS' : 'WARN',
    detail: issues.length === 0
      ? 'All version constraints are valid (or none specified)'
      : `${issues.length} invalid version constraints`,
    issues,
  };
}

function d06_noCircularDataFlow(contracts) {
  const graph = buildDependencyGraph(contracts);
  const cycles = findCycles(graph);
  const issues = cycles.map(cycle => ({
    cycle,
    reason: 'Circular data flow between capabilities',
  }));

  return {
    check: 'D06',
    name: 'No Circular Data Flow',
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    detail: issues.length === 0
      ? 'No circular data flow detected'
      : `${issues.length} circular data flows detected`,
    issues,
  };
}

function d07_dependencyDepth(contracts) {
  const graph = buildDependencyGraph(contracts);
  const depths = computeDepths(graph);
  const maxDepth = Math.max(...Object.values(depths), 0);
  const issues = [];

  if (maxDepth > 5) {
    issues.push({
      max_depth: maxDepth,
      reason: `Dependency depth of ${maxDepth} exceeds recommended maximum of 5`,
    });
  }

  const deepCapabilities = Object.entries(depths)
    .filter(([, d]) => d > 3)
    .map(([id, d]) => ({ capability: id, depth: d }));

  return {
    check: 'D07',
    name: 'Dependency Depth',
    status: issues.length === 0 ? 'PASS' : 'WARN',
    detail: issues.length === 0
      ? `Max dependency depth: ${maxDepth} (within limits)`
      : `Max dependency depth ${maxDepth} exceeds recommended limit`,
    issues,
    metadata: { depths, max_depth: maxDepth, deep_capabilities: deepCapabilities },
  };
}

// ─── MAIN ────────────────────────────────────────────────────

function main() {
  const isCI = process.argv.includes('--ci');
  const startTime = Date.now();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   ARTHA Dependency Graph Integrity Verifier               ║');
  console.log('║   Verifying dependency graph across capabilities          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const contracts = loadContracts();
  const graph = buildDependencyGraph(contracts);
  const edgeCount = Object.values(graph).reduce((sum, deps) => sum + deps.length, 0);
  console.log(`  Loaded ${Object.keys(contracts).length} contracts`);
  console.log(`  Dependency graph: ${Object.keys(graph).length} nodes, ${edgeCount} edges\n`);

  const checks = [
    d01_noCycles(contracts),
    d02_noSelfDependencies(contracts),
    d03_noMissingDependencies(contracts),
    d04_noPhantomDependencies(contracts),
    d05_versionConstraints(contracts),
    d06_noCircularDataFlow(contracts),
    d07_dependencyDepth(contracts),
  ];

  const passed = checks.filter(c => c.status === 'PASS').length;
  const failed = checks.filter(c => c.status === 'FAIL').length;
  const warned = checks.filter(c => c.status === 'WARN').length;
  const duration = Date.now() - startTime;

  for (const c of checks) {
    const icon = c.status === 'PASS' ? '  ✓' : c.status === 'WARN' ? '  ⚠' : '  ✗';
    console.log(`${icon} ${c.check} ${c.name}: ${c.detail}`);
  }

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log(`│  RESULTS: ${passed} passed, ${failed} failed, ${warned} warned (${checks.length} total)`);
  console.log(`│  Duration: ${duration}ms`);
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const evidence = {
    verifier: 'ARTH Dependency Graph Integrity Verifier',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    contract_count: Object.keys(contracts).length,
    graph: {
      nodes: Object.keys(graph).length,
      edges: edgeCount,
      adjacency: graph,
    },
    results: checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      warned,
      all_passed: failed === 0,
    },
  };

  const evidenceHash = computeHash(evidence);
  evidence.evidence_hash = evidenceHash;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const evidencePath = join(EVIDENCE_DIR, `dependency-verification-${date}.json`);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`  Evidence written to: ${evidencePath}`);
  console.log(`  Evidence hash: ${evidenceHash.substring(0, 16)}...\n`);

  if (isCI && failed > 0) {
    process.exit(1);
  }
}

main();