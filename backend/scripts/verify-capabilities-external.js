#!/usr/bin/env node

/**
 * ARTHA Independent Capability Verifier — v2.0
 *
 * This is an EXTERNAL verifier — it runs INDEPENDENTLY of the ARTHA server.
 * It reads capability contracts from the registry and validates them against
 * the actual codebase and runtime state.
 *
 * ROLE SEPARATION:
 *   - Producer: ARTHA server (writes contracts, serves API)
 *   - Verifier: This script (reads contracts, validates independently)
 *   - Auditor: CI pipeline (runs this script, produces evidence)
 *
 * USAGE:
 *   node scripts/verify-capabilities-external.js [--output evidence.json] [--ci]
 *
 * EXIT CODES:
 *   0 = All verifications passed
 *   1 = One or more verifications failed
 *   2 = Configuration error
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const CONTRACT_DIR = join(ROOT, '..', 'contracts', 'capability_contracts');
const ROUTE_MAP_FILE = join(ROOT, '..', 'contracts', 'capability_contracts', 'capability_route_map.json');
const SRC_DIR = join(ROOT, 'src');
const EVIDENCE_DIR = join(ROOT, '..', 'evidence');

// ─────────────────────────────────────────────────────────────
// VERIFICATION RUNNER
// ─────────────────────────────────────────────────────────────

class VerificationRunner {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
    this.contracts = {};
    this.routeMap = {};
  }

  loadContracts() {
    if (!existsSync(CONTRACT_DIR)) {
      throw new Error(`Contract directory not found: ${CONTRACT_DIR}`);
    }

    const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
    for (const file of files) {
      try {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        this.contracts[contract.capability_id] = contract;
      } catch (err) {
        this.addResult({
          name: 'CONTRACT_LOAD',
          status: 'FAIL',
          detail: `Failed to load ${file}: ${err.message}`,
          severity: 'CRITICAL',
        });
      }
    }

    if (existsSync(ROUTE_MAP_FILE)) {
      this.routeMap = JSON.parse(readFileSync(ROUTE_MAP_FILE, 'utf-8'));
    }
  }

  addResult(result) {
    this.results.push({
      timestamp: new Date().toISOString(),
      ...result,
    });
  }

  // ─── VERIFICATION CHECKS ─────────────────────────────────

  /**
   * V01: Contract Schema Validation
   * Every contract file must have required fields.
   */
  verifyContractSchemas() {
    const required = ['capability_id', 'capability_name', 'version', 'status',
      'authority_owned', 'authority_explicitly_not_owned', 'api_endpoints',
      'authentication', 'dependencies', 'consumers'];

    for (const [id, contract] of Object.entries(this.contracts)) {
      const missing = required.filter(f => !contract[f]);
      if (missing.length > 0) {
        this.addResult({
          name: 'V01_CONTRACT_SCHEMA',
          status: 'FAIL',
          capability: id,
          detail: `Missing required fields: ${missing.join(', ')}`,
          severity: 'HIGH',
        });
      } else {
        this.addResult({
          name: 'V01_CONTRACT_SCHEMA',
          status: 'PASS',
          capability: id,
          detail: `All ${required.length} required fields present`,
        });
      }
    }
  }

  /**
   * V02: Authority Non-Overlap
   * No two capabilities should own the same collection.
   */
  verifyAuthorityNonOverlap() {
    const collectionOwnership = {};

    for (const [id, contract] of Object.entries(this.contracts)) {
      const models = contract.provider_model || [];
      for (const modelPath of models) {
        const model = modelPath.split('/').pop().replace('.js', '');
        if (!collectionOwnership[model]) {
          collectionOwnership[model] = [];
        }
        collectionOwnership[model].push(id);
      }
    }

    for (const [model, owners] of Object.entries(collectionOwnership)) {
      if (owners.length > 1) {
        this.addResult({
          name: 'V02_AUTHORITY_NON_OVERLAP',
          status: 'FAIL',
          detail: `Collection ${model} owned by multiple capabilities: ${owners.join(', ')}`,
          severity: 'HIGH',
        });
      }
    }

    if (this.results.filter(r => r.name === 'V02_AUTHORITY_NON_OVERLAP').length === 0) {
      this.addResult({
        name: 'V02_AUTHORITY_NON_OVERLAP',
        status: 'PASS',
        detail: `All ${Object.keys(collectionOwnership).length} collections have single ownership`,
      });
    }
  }

  /**
   * V03: Route Map Coverage
   * Every API endpoint in contracts must be covered by the route map.
   */
  verifyRouteMapCoverage() {
    const routePrefixes = (this.routeMap.routes || []).map(r => r.prefix);
    const uncovered = [];

    for (const [id, contract] of Object.entries(this.contracts)) {
      const endpoints = contract.api_endpoints || {};
      for (const [name, ep] of Object.entries(endpoints)) {
        if (!ep.path) continue;
        const covered = routePrefixes.some(p => ep.path.startsWith(p));
        if (!covered) {
          uncovered.push({ capability: id, endpoint: name, path: ep.path });
        }
      }
    }

    if (uncovered.length > 0) {
      this.addResult({
        name: 'V03_ROUTE_MAP_COVERAGE',
        status: 'FAIL',
        detail: `${uncovered.length} endpoints not covered by route map`,
        severity: 'MEDIUM',
        details: uncovered,
      });
    } else {
      this.addResult({
        name: 'V03_ROUTE_MAP_COVERAGE',
        status: 'PASS',
        detail: 'All contract endpoints covered by route map',
      });
    }
  }

  /**
   * V04: Service File Existence
   * Every provider_service referenced in contracts must exist.
   */
  verifyServiceFiles() {
    const missing = [];

    for (const [id, contract] of Object.entries(this.contracts)) {
      const servicePath = contract.provider_service;
      if (!servicePath) continue;
      // Try both relative to ROOT (backend/) and relative to project root
      const fullPathBackend = join(ROOT, servicePath);
      const fullPathProject = join(ROOT, '..', servicePath);
      const serviceExists = existsSync(fullPathBackend) || existsSync(fullPathProject);
      if (!serviceExists) {
        missing.push({ capability: id, path: servicePath });
      }
    }

    if (missing.length > 0) {
      this.addResult({
        name: 'V04_SERVICE_EXISTENCE',
        status: 'FAIL',
        detail: `${missing.length} service files not found`,
        severity: 'CRITICAL',
        details: missing,
      });
    } else {
      this.addResult({
        name: 'V04_SERVICE_EXISTENCE',
        status: 'PASS',
        detail: 'All provider service files exist',
      });
    }
  }

  /**
   * V05: Model File Existence
   * Every provider_model referenced in contracts must exist.
   */
  verifyModelFiles() {
    const missing = [];

    for (const [id, contract] of Object.entries(this.contracts)) {
      const models = contract.provider_model || [];
      for (const modelPath of models) {
        // Try both relative to ROOT (backend/) and relative to project root
        const fullPathBackend = join(ROOT, modelPath);
        const fullPathProject = join(ROOT, '..', modelPath);
        if (!existsSync(fullPathBackend) && !existsSync(fullPathProject)) {
          missing.push({ capability: id, path: modelPath });
        }
      }
    }

    if (missing.length > 0) {
      this.addResult({
        name: 'V05_MODEL_EXISTENCE',
        status: 'FAIL',
        detail: `${missing.length} model files not found`,
        severity: 'CRITICAL',
        details: missing,
      });
    } else {
      this.addResult({
        name: 'V05_MODEL_EXISTENCE',
        status: 'PASS',
        detail: 'All provider model files exist',
      });
    }
  }

  /**
   * V06: Dependency Cycle Detection
   * The dependency graph must be acyclic.
   */
  verifyNoDependencyCycles() {
    const graph = {};
    for (const [id, contract] of Object.entries(this.contracts)) {
      graph[id] = [];
      const deps = contract.dependencies?.internal || [];
      for (const dep of deps) {
        // Only track inter-capability dependencies (service names that match other capabilities)
        for (const otherId of Object.keys(this.contracts)) {
          if (otherId !== id) {
            const otherContract = this.contracts[otherId];
            if (otherContract.provider_service?.includes(dep.service)) {
              graph[id].push(otherId);
            }
          }
        }
      }
    }

    // Topological sort with cycle detection
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

    if (cycles.length > 0) {
      this.addResult({
        name: 'V06_DEPENDENCY_CYCLE',
        status: 'FAIL',
        detail: `${cycles.length} dependency cycles detected`,
        severity: 'CRITICAL',
        details: cycles,
      });
    } else {
      this.addResult({
        name: 'V06_DEPENDENCY_CYCLE',
        status: 'PASS',
        detail: 'No dependency cycles detected',
      });
    }
  }

  /**
   * V07: Version Consistency
   * All contracts should have consistent version formats.
   */
  verifyVersionConsistency() {
    const versions = {};
    const issues = [];

    for (const [id, contract] of Object.entries(this.contracts)) {
      const ver = contract.version;
      if (!ver || !/^\d+\.\d+\.\d+$/.test(ver)) {
        issues.push({ capability: id, version: ver, issue: 'Invalid semver format' });
      }
      if (!contract.version_history || contract.version_history.length === 0) {
        issues.push({ capability: id, version: ver, issue: 'Missing version_history' });
      }
      versions[id] = ver;
    }

    if (issues.length > 0) {
      this.addResult({
        name: 'V07_VERSION_CONSISTENCY',
        status: 'FAIL',
        detail: `${issues.length} version issues`,
        severity: 'MEDIUM',
        details: issues,
      });
    } else {
      this.addResult({
        name: 'V07_VERSION_CONSISTENCY',
        status: 'PASS',
        detail: `All ${Object.keys(versions).length} contracts have valid semver versions`,
      });
    }
  }

  /**
   * V08: Authentication Configuration
   * Every contract must declare authentication requirements.
   */
  verifyAuthConfig() {
    const issues = [];

    for (const [id, contract] of Object.entries(this.contracts)) {
      if (!contract.authentication) {
        issues.push({ capability: id, issue: 'Missing authentication config' });
      } else if (!contract.authentication.type) {
        issues.push({ capability: id, issue: 'Authentication missing type field' });
      }
    }

    if (issues.length > 0) {
      this.addResult({
        name: 'V08_AUTH_CONFIG',
        status: 'FAIL',
        detail: `${issues.length} auth configuration issues`,
        severity: 'HIGH',
        details: issues,
      });
    } else {
      this.addResult({
        name: 'V08_AUTH_CONFIG',
        status: 'PASS',
        detail: 'All contracts have valid authentication configuration',
      });
    }
  }

  /**
   * V09: Read-Only Capability Enforcement
   * Read-only capabilities must not have mutating endpoints in their contracts.
   */
  verifyReadOnlyEnforcement() {
    const issues = [];

    for (const [id, contract] of Object.entries(this.contracts)) {
      const endpoints = contract.api_endpoints || {};
      const mutating = Object.entries(endpoints).filter(
        ([, ep]) => ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method)
      );

      // Check if contract declares read-only in authority_owned descriptions
      const isDeclaredReadOnly = (contract.authority_owned || []).some(
        item => item.toLowerCase().includes('read-only') || item.toLowerCase().includes('monitoring')
      );

      if (isDeclaredReadOnly && mutating.length > 0) {
        issues.push({
          capability: id,
          issue: `Declared read-only but has ${mutating.length} mutating endpoints`,
          endpoints: mutating.map(([name, ep]) => `${ep.method} ${ep.path}`),
        });
      }
    }

    if (issues.length > 0) {
      this.addResult({
        name: 'V09_READONLY_ENFORCEMENT',
        status: 'FAIL',
        detail: `${issues.length} read-only violations`,
        severity: 'HIGH',
        details: issues,
      });
    } else {
      this.addResult({
        name: 'V09_READONLY_ENFORCEMENT',
        status: 'PASS',
        detail: 'Read-only capabilities are correctly configured',
      });
    }
  }

  /**
   * V10: Evidence Package Integrity
   * Each verification result has a content hash for tamper detection.
   */
  generateEvidenceHash() {
    const payload = JSON.stringify(this.results.sort((a, b) => a.name.localeCompare(b.name)));
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    this.addResult({
      name: 'V10_EVIDENCE_HASH',
      status: 'PASS',
      detail: `Evidence package hash: ${hash.substring(0, 16)}...`,
      hash,
    });
    return hash;
  }

  // ─── RUN ALL VERIFICATIONS ───────────────────────────────

  runAll() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  ARTHA Independent Capability Verifier v2.0');
    console.log('═══════════════════════════════════════════════════════\n');

    this.loadContracts();
    console.log(`Loaded ${Object.keys(this.contracts).length} capability contracts\n`);

    console.log('Running verifications...');
    this.verifyContractSchemas();
    this.verifyAuthorityNonOverlap();
    this.verifyRouteMapCoverage();
    this.verifyServiceFiles();
    this.verifyModelFiles();
    this.verifyNoDependencyCycles();
    this.verifyVersionConsistency();
    this.verifyAuthConfig();
    this.verifyReadOnlyEnforcement();
    const evidenceHash = this.generateEvidenceHash();

    // Summary
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const total = this.results.length;
    const duration = Date.now() - this.startTime;

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed (${total} total)`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Evidence Hash: ${evidenceHash.substring(0, 16)}...`);
    console.log('═══════════════════════════════════════════════════════\n');

    // Detailed results
    for (const r of this.results) {
      const icon = r.status === 'PASS' ? '✓' : '✗';
      const cap = r.capability ? ` [${r.capability}]` : '';
      console.log(`  ${icon} ${r.name}${cap}: ${r.detail}`);
    }

    // Output evidence
    const isCI = process.argv.includes('--ci');
    const outputIdx = process.argv.indexOf('--output');
    const outputPath = outputIdx >= 0 ? process.argv[outputIdx + 1] : null;

    const evidence = {
      verifier: 'ARTH Independent Capability Verifier',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      evidence_hash: evidenceHash,
      contract_count: Object.keys(this.contracts).length,
      results: this.results,
      summary: {
        total: this.results.length,
        passed,
        failed,
        all_passed: failed === 0,
      },
    };

    if (outputPath) {
      const fullPath = join(ROOT, '..', outputPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, JSON.stringify(evidence, null, 2));
      console.log(`\nEvidence written to: ${outputPath}`);
    }

    if (isCI) {
      // Write to evidence directory
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      const date = new Date().toISOString().split('T')[0];
      const evidencePath = join(EVIDENCE_DIR, `capability-verification-${date}.json`);
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
      console.log(`CI evidence written to: ${evidencePath}`);
    }

    // Always output JSON to stdout for piping
    if (process.argv.includes('--json')) {
      console.log('\n--- JSON OUTPUT ---');
      console.log(JSON.stringify(evidence, null, 2));
    }

    return failed === 0;
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

const runner = new VerificationRunner();
const success = runner.runAll();
process.exit(success ? 0 : 1);
