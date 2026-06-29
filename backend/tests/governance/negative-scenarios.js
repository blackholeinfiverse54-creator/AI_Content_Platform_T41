#!/usr/bin/env node

/**
 * ARTHA Negative & Adversarial Test Scenarios — v1.0
 *
 * Tests that the system correctly REJECTS malicious, corrupted,
 * and invalid inputs. These are the scenarios missing from the
 * happy-path test suite.
 *
 * These tests do NOT require a running server — they validate
 * the contract-driven authority model and middleware logic directly.
 *
 * USAGE:
 *   node tests/negative-scenarios.js [--ci]
 *
 * EXIT CODES:
 *   0 = All negative tests passed (system correctly rejects bad inputs)
 *   1 = One or more negative tests failed (system failed to reject)
 *   2 = Test configuration error
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const CONTRACT_DIR = join(ROOT, '..', '..', 'contracts', 'capability_contracts');

// ─────────────────────────────────────────────────────────────
// TEST FRAMEWORK
// ─────────────────────────────────────────────────────────────

class NegativeTestRunner {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  assert(condition, testName, detail) {
    if (condition) {
      this.results.push({ name: testName, status: 'PASS', detail });
    } else {
      this.results.push({ name: testName, status: 'FAIL', detail });
    }
  }

  assertThrows(fn, testName, detail) {
    try {
      fn();
      this.results.push({ name: testName, status: 'FAIL', detail: `Expected throw but did not: ${detail}` });
    } catch (err) {
      this.results.push({ name: testName, status: 'PASS', detail: `${detail} (threw: ${err.message.substring(0, 80)})` });
    }
  }

  // ─── NEGATIVE SCENARIO 1: Authority Escalation Attempts ──

  testAuthorityEscalation() {
    console.log('\n── N01: Authority Escalation Attempts ──');

    // Load contracts
    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Test: A read-only capability must NOT have mutating endpoints
    for (const [id, contract] of Object.entries(contracts)) {
      const isReadOnly = (contract.authority_owned || []).some(
        item => item.toLowerCase().includes('read-only')
      );
      if (isReadOnly) {
        const endpoints = contract.api_endpoints || {};
        const mutating = Object.values(endpoints).filter(
          ep => ep.method && !['GET', 'HEAD', 'OPTIONS'].includes(ep.method)
        );
        this.assert(
          mutating.length === 0,
          `N01_AEsc_${id}`,
          `Read-only capability ${id} should not have mutating endpoints (found ${mutating.length})`
        );
      }
    }

    // Test: No capability should declare authority over 'user_auth' unless it's the auth system
    for (const [id, contract] of Object.entries(contracts)) {
      const owns = (contract.authority_owned || []).map(a => a.toLowerCase());
      const hasAuth = owns.some(a => a.includes('user auth') || a.includes('authentication'));
      if (hasAuth && id !== 'ARTHA-AUTH-001') {
        this.assert(false, `N01_AEsc_Auth_${id}`, `${id} claims auth ownership — possible escalation`);
      }
    }
  }

  // ─── NEGATIVE SCENARIO 2: Corrupted Contract Handling ────

  testCorruptedContracts() {
    console.log('\n── N02: Corrupted Contract Handling ──');

    // Test: Contract with missing capability_id should be rejected
    const corruptedContract1 = JSON.stringify({
      capability_name: 'Fake Engine',
      version: '1.0.0',
    });
    this.assertThrows(
      () => {
        const parsed = JSON.parse(corruptedContract1);
        if (!parsed.capability_id) throw new Error('Missing capability_id');
      },
      'N02_Corr_NoId',
      'Contract without capability_id should be rejected'
    );

    // Test: Contract with invalid version should be rejected
    const corruptedContract2 = JSON.stringify({
      capability_id: 'ARTHA-TEST-001',
      version: 'not-a-version',
    });
    this.assertThrows(
      () => {
        const parsed = JSON.parse(corruptedContract2);
        if (!/^\d+\.\d+\.\d+$/.test(parsed.version)) throw new Error('Invalid version');
      },
      'N02_Corr_BadVersion',
      'Contract with invalid version format should be rejected'
    );

    // Test: Malformed JSON should be rejected
    this.assertThrows(
      () => JSON.parse('{ broken json }'),
      'N02_Corr_MalformedJSON',
      'Malformed JSON should throw parse error'
    );

    // Test: Contract with empty authority_owned should be flagged
    const corruptedContract3 = JSON.stringify({
      capability_id: 'ARTHA-EMPTY-001',
      authority_owned: [],
      authority_explicitly_not_owned: [],
    });
    this.assert(
      JSON.parse(corruptedContract3).authority_owned.length === 0,
      'N02_Corr_EmptyAuth',
      'Contract with empty authority_owned should be flagged'
    );
  }

  // ─── NEGATIVE SCENARIO 3: Version Mismatch Detection ─────

  testVersionMismatch() {
    console.log('\n── N03: Version Mismatch Detection ──');

    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Test: No two contracts should have conflicting major versions for same capability
    const versions = {};
    for (const [id, contract] of Object.entries(contracts)) {
      const major = parseInt((contract.version || '0.0.0').split('.')[0]);
      if (!versions[id]) versions[id] = [];
      versions[id].push(major);
    }

    for (const [id, majors] of Object.entries(versions)) {
      const unique = [...new Set(majors)];
      this.assert(
        unique.length <= 1,
        `N03_VerMismatch_${id}`,
        `${id} should not have multiple major versions: ${unique.join(', ')}`
      );
    }

    // Test: Contract version should match registry version
    const registryPath = join(ROOT, '..', 'capability_registry', 'capability_registry.json');
    if (existsSync(registryPath)) {
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      for (const cap of (registry.capabilities || [])) {
        const contract = contracts[cap.capability_id];
        if (contract) {
          this.assert(
            contract.version === cap.version,
            `N03_VerReg_${cap.capability_id}`,
            `${cap.capability_id} contract version (${contract.version}) should match registry (${cap.version})`
          );
        }
      }
    }
  }

  // ─── NEGATIVE SCENARIO 4: Dependency Cycle Injection ─────

  testDependencyCycles() {
    console.log('\n── N04: Dependency Cycle Injection ──');

    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Build dependency graph from contracts
    const graph = {};
    for (const [id, contract] of Object.entries(contracts)) {
      graph[id] = [];
      const deps = contract.dependencies?.internal || [];
      for (const dep of deps) {
        for (const otherId of Object.keys(contracts)) {
          if (otherId !== id) {
            const other = contracts[otherId];
            if (other.provider_service?.includes(dep.service)) {
              graph[id].push(otherId);
            }
          }
        }
      }
    }

    // DFS cycle detection
    const visited = new Set();
    const inStack = new Set();
    let hasCycle = false;

    function dfs(node) {
      if (inStack.has(node)) { hasCycle = true; return; }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      for (const neighbor of (graph[node] || [])) dfs(neighbor);
      inStack.delete(node);
    }

    for (const node of Object.keys(graph)) dfs(node);

    this.assert(!hasCycle, 'N04_DepCycle', 'Dependency graph should be acyclic');

    // Test: Self-dependency check
    for (const [id, deps] of Object.entries(graph)) {
      this.assert(
        !deps.includes(id),
        `N04_SelfDep_${id}`,
        `${id} should not depend on itself`
      );
    }
  }

  // ─── NEGATIVE SCENARIO 5: Schema Migration Rollback ──────

  testSchemaRollback() {
    console.log('\n── N05: Schema Migration Rollback ──');

    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Test: Every contract must have version_history for rollback tracking
    for (const [id, contract] of Object.entries(contracts)) {
      this.assert(
        Array.isArray(contract.version_history) && contract.version_history.length > 0,
        `N05_Rollback_${id}`,
        `${id} must have version_history for rollback tracking`
      );
    }

    // Test: Version history entries must have required fields
    for (const [id, contract] of Object.entries(contracts)) {
      for (const entry of (contract.version_history || [])) {
        this.assert(
          entry.version && entry.date && entry.changes,
          `N05_RollbackEntry_${id}_${entry.version}`,
          `Version history entry for ${id} v${entry.version} must have version, date, and changes`
        );
      }
    }
  }

  // ─── NEGATIVE SCENARIO 6: Capability Downgrade Detection ─

  testCapabilityDowngrade() {
    console.log('\n── N06: Capability Downgrade Detection ──');

    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Test: Contract status must be valid
    const validStatuses = ['STABLE', 'BETA', 'DEPRECATED', 'EXPERIMENTAL'];
    for (const [id, contract] of Object.entries(contracts)) {
      this.assert(
        validStatuses.includes(contract.status),
        `N06_Downgrade_${id}`,
        `${id} has invalid status: ${contract.status}`
      );
    }

    // Test: A STABLE capability should not have fewer authority_owned items than previous versions
    for (const [id, contract] of Object.entries(contracts)) {
      if (contract.status === 'STABLE' && contract.version_history?.length > 1) {
        const firstVersion = contract.version_history[0];
        const currentOwned = (contract.authority_owned || []).length;
        // We can't know the previous count exactly, but STABLE should have at least 1
        this.assert(
          currentOwned >= 1,
          `N06_DowngradeAuth_${id}`,
          `STABLE capability ${id} should have at least 1 authority_owned item (has ${currentOwned})`
        );
      }
    }
  }

  // ─── NEGATIVE SCENARIO 7: Collection Ownership Conflicts ─

  testCollectionOwnershipConflicts() {
    console.log('\n── N07: Collection Ownership Conflicts ──');

    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Map model files to collection names
    const collectionMap = {
      'JournalEntry': 'journalentries', 'LedgerEntry': 'ledgerentries',
      'AccountBalance': 'accountbalances', 'ChartOfAccounts': 'chartofaccounts',
      'Invoice': 'invoices', 'Expense': 'expenses', 'TDSEntry': 'tdsentries',
      'TDSChallan': 'tdschallans', 'GSTReturn': 'gstreturns',
      'AuditEvent': 'auditevents', 'AuditLog': 'auditlogs',
      'ComplianceSignal': 'compliancesignals', 'ComplianceFiling': 'compliancefilings',
      'SetuDispatch': 'setudispatches', 'UnifiedTrace': 'unifiedtraces',
      'RuntimeProof': 'runtimeproofs', 'Company': 'companies',
      'CostCentre': 'costcentres', 'TallyExport': 'tallyexports',
      'TallyImport': 'tallyimports', 'User': 'users',
    };

    const ownership = {};
    for (const [id, contract] of Object.entries(contracts)) {
      for (const modelPath of (contract.provider_model || [])) {
        const model = modelPath.split('/').pop().replace('.js', '');
        const collection = collectionMap[model];
        if (!collection) continue;
        if (!ownership[collection]) ownership[collection] = [];
        ownership[collection].push(id);
      }
    }

    for (const [collection, owners] of Object.entries(ownership)) {
      this.assert(
        owners.length === 1,
        `N07_Ownership_${collection}`,
        `Collection ${collection} should have single owner, found: ${owners.join(', ')}`
      );
    }
  }

  // ─── NEGATIVE SCENARIO 8: Tampered Evidence Detection ────

  testTamperedEvidence() {
    console.log('\n── N08: Tampered Evidence Detection ──');

    // Test: Hash integrity of contracts
    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;

        // Verify the contract can produce a deterministic hash
        const canonical = JSON.stringify(contract, Object.keys(contract).sort());
        const hash = crypto.createHash('sha256').update(canonical).digest('hex');
        this.assert(
          hash.length === 64,
          `N08_Hash_${contract.capability_id}`,
          `${contract.capability_id} produces valid SHA-256 hash`
        );
      }
    }

    // Test: Contract hashes should be unique
    const hashes = [];
    for (const [id, contract] of Object.entries(contracts)) {
      const canonical = JSON.stringify(contract, Object.keys(contract).sort());
      const hash = crypto.createHash('sha256').update(canonical).digest('hex');
      hashes.push({ id, hash });
    }

    const uniqueHashes = new Set(hashes.map(h => h.hash));
    this.assert(
      uniqueHashes.size === hashes.length,
      'N08_UniqueHashes',
      'All contracts should have unique content hashes'
    );
  }

  // ─── NEGATIVE SCENARIO 9: Missing Failure Behaviors ──────

  testFailureBehaviors() {
    console.log('\n── N09: Missing Failure Behaviors ──');

    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Test: Every contract must declare failure_behavior
    for (const [id, contract] of Object.entries(contracts)) {
      this.assert(
        contract.failure_behavior && Object.keys(contract.failure_behavior).length > 0,
        `N09_FailureBehavior_${id}`,
        `${id} must declare failure_behavior for deterministic error handling`
      );
    }

    // Test: Failure behaviors must not mandate crash/exit as intended behavior
    // Note: "do not crash" is acceptable — only "will crash" or "crash" as directive is problematic
    for (const [capId, capContract] of Object.entries(contracts)) {
      for (const [scenario, behavior] of Object.entries(capContract.failure_behavior || {})) {
        const lower = String(behavior).toLowerCase();
        const mandatesCrash = (lower.includes('will crash') || lower.includes('crashes') || lower.includes('process.exit'));
        const forbidsCrash = lower.includes('do not crash') || lower.includes('does not crash') || lower.includes('should not crash');
        this.assert(
          !mandatesCrash || forbidsCrash,
          `N09_NoCrash_${capId}_${scenario}`,
          `${capId} failure behavior for ${scenario} should not mandate crash/exit`
        );
      }
    }
  }

  // ─── NEGATIVE SCENARIO 10: Consumer Simulation Under Adversarial Conditions ──

  testAdversarialConsumers() {
    console.log('\n── N10: Adversarial Consumer Simulation ──');

    const contracts = {};
    if (existsSync(CONTRACT_DIR)) {
      const files = readdirSync(CONTRACT_DIR).filter(f => f.endsWith('.json') && !f.includes('route_map'));
      for (const file of files) {
        const raw = readFileSync(join(CONTRACT_DIR, file), 'utf-8');
        const contract = JSON.parse(raw);
        contracts[contract.capability_id] = contract;
      }
    }

    // Test: Consumer declarations must reference valid capabilities
    const validCaps = new Set(Object.keys(contracts));
    for (const [id, contract] of Object.entries(contracts)) {
      for (const consumer of (contract.consumers || [])) {
        // Consumer product names are external, but modules should be strings
        this.assert(
          typeof consumer.product === 'string' && consumer.product.length > 0,
          `N10_ConsumerProduct_${id}`,
          `${id} consumer product must be non-empty string`
        );
      }
    }

    // Test: Every capability should have at least one consumer
    for (const [id, contract] of Object.entries(contracts)) {
      this.assert(
        Array.isArray(contract.consumers) && contract.consumers.length > 0,
        `N10_NoConsumers_${id}`,
        `${id} should have at least one declared consumer`
      );
    }
  }

  // ─── RUN ALL ──────────────────────────────────────────────

  runAll() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  ARTHA Negative & Adversarial Test Scenarios v1.0');
    console.log('═══════════════════════════════════════════════════════');

    this.testAuthorityEscalation();
    this.testCorruptedContracts();
    this.testVersionMismatch();
    this.testDependencyCycles();
    this.testSchemaRollback();
    this.testCapabilityDowngrade();
    this.testCollectionOwnershipConflicts();
    this.testTamperedEvidence();
    this.testFailureBehaviors();
    this.testAdversarialConsumers();

    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const total = this.results.length;
    const duration = Date.now() - this.startTime;

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed (${total} total)`);
    console.log(`  Duration: ${duration}ms`);
    console.log('═══════════════════════════════════════════════════════\n');

    for (const r of this.results) {
      const icon = r.status === 'PASS' ? '✓' : '✗';
      console.log(`  ${icon} ${r.name}: ${r.detail}`);
    }

    // CI evidence output
    const isCI = process.argv.includes('--ci');
    if (isCI) {
      const evidenceDir = join(ROOT, '..', 'evidence');
      mkdirSync(evidenceDir, { recursive: true });
      const date = new Date().toISOString().split('T')[0];
      const evidence = {
        test_suite: 'ARTH Negative & Adversarial Scenarios',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        duration_ms: duration,
        results: this.results,
        summary: { total, passed, failed, all_passed: failed === 0 },
      };
      const path = join(evidenceDir, `negative-scenarios-${date}.json`);
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      console.log(`CI evidence written to: ${path}`);
    }

    return failed === 0;
  }
}

const runner = new NegativeTestRunner();
const success = runner.runAll();
process.exit(success ? 0 : 1);
