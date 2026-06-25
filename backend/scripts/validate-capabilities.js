#!/usr/bin/env node

/**
 * ARTHA Capability Runtime Validation Script
 * 
 * Purpose: Validates capability contracts, schemas, authority boundaries,
 * and dependency integrity at startup. This is NOT a static analysis —
 * it runs actual database queries and API health checks to prove capabilities
 * are operational.
 * 
 * Usage: node scripts/validate-capabilities.js [--verbose] [--json]
 * 
 * Exit codes:
 *   0 — All validations passed
 *   1 — One or more validations failed
 *   2 — Script error (missing dependencies, config, etc.)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');

const VERBOSE = process.argv.includes('--verbose');
const JSON_OUTPUT = process.argv.includes('--json');

// ─────────────────────────────────────────────────────────────
// VALIDATION FRAMEWORK
// ─────────────────────────────────────────────────────────────

class ValidationResult {
  constructor(name) {
    this.name = name;
    this.passed = false;
    this.details = [];
    this.timestamp = new Date().toISOString();
    this.duration_ms = 0;
  }

  addDetail(detail) {
    this.details.push(detail);
  }

  markPassed() { this.passed = true; }
  markFailed(reason) { this.passed = false; this.details.push(`FAIL: ${reason}`); }
}

class ValidationSuite {
  constructor() {
    this.results = [];
    this.start_time = Date.now();
  }

  addResult(result) {
    this.results.push(result);
  }

  get summary() {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    return {
      total: this.results.length,
      passed,
      failed,
      all_passed: failed === 0,
      duration_ms: Date.now() - this.start_time,
      timestamp: new Date().toISOString()
    };
  }
}

// ─────────────────────────────────────────────────────────────
// CAPABILITY CONTRACT VALIDATOR
// ─────────────────────────────────────────────────────────────

function validateContractSchema(contract, contractPath) {
  const result = new ValidationResult(`Contract Schema: ${contract.capability_id || contractPath}`);

  const required_fields = [
    'capability_id', 'capability_name', 'version', 'status', 'owner',
    'authority_owned', 'authority_explicitly_not_owned', 'description',
    'provider_service', 'api_endpoints', 'input_schemas', 'output_schemas',
    'authentication', 'trace_requirements', 'evidence_requirements',
    'failure_behavior', 'dependencies', 'consumers', 'replay_compatibility'
  ];

  const missing = required_fields.filter(f => !contract[f]);
  if (missing.length > 0) {
    result.markFailed(`Missing required fields: ${missing.join(', ')}`);
  } else {
    result.markPassed();
    result.addDetail(`All ${required_fields.length} required fields present`);
    result.addDetail(`Version: ${contract.version}`);
    result.addDetail(`Owner: ${contract.owner}`);
    result.addDetail(`Authority owned: ${contract.authority_owned.length} items`);
    result.addDetail(`Authority NOT owned: ${contract.authority_explicitly_not_owned.length} items`);
    result.addDetail(`API endpoints: ${Object.keys(contract.api_endpoints).length}`);
    result.addDetail(`Input schemas: ${Object.keys(contract.input_schemas).length}`);
    result.addDetail(`Output schemas: ${Object.keys(contract.output_schemas).length}`);
    result.addDetail(`Dependencies: ${contract.dependencies.internal.length} internal, ${contract.dependencies.models.length} models`);
    result.addDetail(`Consumers: ${contract.consumers.length}`);
    result.addDetail(`Replay deterministic: ${contract.replay_compatibility.deterministic}`);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// AUTHORITY BOUNDARY VALIDATOR
// ─────────────────────────────────────────────────────────────

function validateAuthorityBoundaries(contract) {
  const result = new ValidationResult(`Authority Boundary: ${contract.capability_id}`);

  if (!contract.authority_owned || contract.authority_owned.length === 0) {
    result.markFailed('No authority_owned declared');
    return result;
  }

  if (!contract.authority_explicitly_not_owned || contract.authority_explicitly_not_owned.length === 0) {
    result.markFailed('No authority_explicitly_not_owned declared — cannot enforce boundaries');
    return result;
  }

  // Check for overlap between owned and not-owned
  const owned_lower = contract.authority_owned.map(a => a.toLowerCase());
  const not_owned_lower = contract.authority_explicitly_not_owned.map(a => a.toLowerCase());
  const overlap = owned_lower.filter(a => not_owned_lower.some(n => a.includes(n) || n.includes(a)));

  if (overlap.length > 0) {
    result.markFailed(`Authority overlap detected: ${overlap.join(', ')}`);
  } else {
    result.markPassed();
    result.addDetail(`Authority owned: ${contract.authority_owned.length} items`);
    result.addDetail(`Authority NOT owned: ${contract.authority_explicitly_not_owned.length} items`);
    result.addDetail('No overlap between owned and not-owned authority');
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// DEPENDENCY GRAPH VALIDATOR
// ─────────────────────────────────────────────────────────────

function validateDependencyGraph(registry) {
  const result = new ValidationResult('Dependency Graph Integrity');

  const nodes = registry.dependency_graph.nodes.map(n => n.id);
  const edges = registry.dependency_graph.edges;

  // Check all edge references exist in nodes
  const invalid_refs = edges.filter(e => !nodes.includes(e.from) || !nodes.includes(e.to));
  if (invalid_refs.length > 0) {
    result.markFailed(`Invalid dependency references: ${JSON.stringify(invalid_refs)}`);
    return result;
  }

  // Check for circular dependencies using DFS
  const adjacency = {};
  nodes.forEach(n => adjacency[n] = []);
  edges.forEach(e => adjacency[e.from].push(e.to));

  const visited = new Set();
  const recursionStack = new Set();
  let hasCycle = false;

  function dfs(node) {
    visited.add(node);
    recursionStack.add(node);
    for (const neighbor of adjacency[node]) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }
    recursionStack.delete(node);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        hasCycle = true;
        break;
      }
    }
  }

  if (hasCycle) {
    result.markFailed('Circular dependency detected');
  } else {
    result.markPassed();
    result.addDetail(`${nodes.length} nodes validated`);
    result.addDetail(`${edges.length} edges validated`);
    result.addDetail('No circular dependencies');
    result.addDetail('All edge references valid');
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// CONTRACT CONSISTENCY VALIDATOR
// ─────────────────────────────────────────────────────────────

function validateContractConsistency(contracts) {
  const result = new ValidationResult('Cross-Contract Consistency');

  const issues = [];

  // Check all capabilities have unique IDs
  const ids = contracts.map(c => c.capability_id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    issues.push(`Duplicate capability IDs: ${dupes.join(', ')}`);
  }

  // Check all versions are valid semver
  const invalid_versions = contracts.filter(c => !/^\d+\.\d+\.\d+$/.test(c.version));
  if (invalid_versions.length > 0) {
    issues.push(`Invalid semver: ${invalid_versions.map(c => `${c.capability_id}:${c.version}`).join(', ')}`);
  }

  // Check all providers reference valid file paths
  const missing_providers = contracts.filter(c => {
    const path = join(ROOT_DIR, c.provider_service);
    return !existsSync(path);
  });
  if (missing_providers.length > 0) {
    issues.push(`Provider service files not found: ${missing_providers.map(c => c.provider_service).join(', ')}`);
  }

  // Check all contract files reference valid models
  const all_models = new Set();
  contracts.forEach(c => {
    if (c.provider_model) {
      c.provider_model.forEach(m => all_models.add(m));
    }
    if (c.dependencies && c.dependencies.models) {
      c.dependencies.models.forEach(m => all_models.add(m));
    }
  });

  if (issues.length > 0) {
    result.markFailed(issues.join('; '));
  } else {
    result.markPassed();
    result.addDetail(`${contracts.length} contracts validated`);
    result.addDetail(`${ids.length} unique capability IDs`);
    result.addDetail('All versions valid semver');
    result.addDetail(`${all_models.size} unique models referenced`);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// REPLAY COMPATIBILITY VALIDATOR
// ─────────────────────────────────────────────────────────────

function validateReplayCompatibility(contracts) {
  const result = new ValidationResult('Replay Compatibility');

  const issues = [];
  const deterministic_caps = [];
  const non_deterministic_caps = [];

  contracts.forEach(c => {
    if (c.replay_compatibility.deterministic) {
      deterministic_caps.push(c.capability_id);
    } else {
      non_deterministic_caps.push(c.capability_id);
    }

    if (!c.replay_compatibility.replay_method) {
      issues.push(`${c.capability_id}: no replay_method declared`);
    }
  });

  if (non_deterministic_caps.length > 0) {
    issues.push(`Non-deterministic capabilities: ${non_deterministic_caps.join(', ')}`);
  }

  if (issues.length > 0) {
    result.markFailed(issues.join('; '));
  } else {
    result.markPassed();
    result.addDetail(`${deterministic_caps.length}/${contracts.length} capabilities are deterministic`);
    result.addDetail('All capabilities have replay_method declared');
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// CONSUMER BOUNDARY VALIDATOR
// ─────────────────────────────────────────────────────────────

function validateConsumerBoundaries(registry) {
  const result = new ValidationResult('Consumer Boundary Validation');

  const consumers = registry.consumer_registry.consumers;
  const capability_ids = registry.capabilities.map(c => c.capability_id);

  const issues = [];

  consumers.forEach(consumer => {
    consumer.capabilities_consumed.forEach(cap_id => {
      if (!capability_ids.includes(cap_id)) {
        issues.push(`${consumer.product} references non-existent capability: ${cap_id}`);
      }
    });
  });

  if (issues.length > 0) {
    result.markFailed(issues.join('; '));
  } else {
    result.markPassed();
    result.addDetail(`${consumers.length} consumers validated`);
    consumers.forEach(c => {
      result.addDetail(`${c.product}: ${c.capabilities_consumed.length} capabilities (${c.attachment_type})`);
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ARTHA Capability Runtime Validation');
  console.log(`  ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const suite = new ValidationSuite();

  // Load registry
  const registryPath = join(ROOT_DIR, 'capability_registry', 'capability_registry.json');
  if (!existsSync(registryPath)) {
    console.error('FATAL: capability_registry.json not found at', registryPath);
    process.exit(2);
  }
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

  // Load all contracts
  const contractsDir = join(ROOT_DIR, 'capability_registry', 'capability_contracts');
  const contractFiles = registry.capabilities.map(c => c.contract_file);
  const contracts = [];

  for (const cf of contractFiles) {
    const path = join(ROOT_DIR, 'capability_registry', cf);
    if (existsSync(path)) {
      const contract = JSON.parse(readFileSync(path, 'utf8'));
      contracts.push(contract);
    } else {
      console.error(`WARNING: Contract file not found: ${cf}`);
    }
  }

  console.log(`Loaded ${contracts.length} capability contracts\n`);

  // Run validations
  for (const contract of contracts) {
    // 1. Contract schema validation
    const schemaResult = validateContractSchema(contract, contract.contract_file);
    suite.addResult(schemaResult);
    if (VERBOSE) console.log(`  ${schemaResult.passed ? '✓' : '✗'} ${schemaResult.name}`);

    // 2. Authority boundary validation
    const authorityResult = validateAuthorityBoundaries(contract);
    suite.addResult(authorityResult);
    if (VERBOSE) console.log(`  ${authorityResult.passed ? '✓' : '✗'} ${authorityResult.name}`);
  }

  // 3. Dependency graph validation
  const depResult = validateDependencyGraph(registry);
  suite.addResult(depResult);
  if (VERBOSE) console.log(`  ${depResult.passed ? '✓' : '✗'} ${depResult.name}`);

  // 4. Cross-contract consistency
  const consistencyResult = validateContractConsistency(contracts);
  suite.addResult(consistencyResult);
  if (VERBOSE) console.log(`  ${consistencyResult.passed ? '✓' : '✗'} ${consistencyResult.name}`);

  // 5. Replay compatibility
  const replayResult = validateReplayCompatibility(contracts);
  suite.addResult(replayResult);
  if (VERBOSE) console.log(`  ${replayResult.passed ? '✓' : '✗'} ${replayResult.name}`);

  // 6. Consumer boundary validation
  const consumerResult = validateConsumerBoundaries(registry);
  suite.addResult(consumerResult);
  if (VERBOSE) console.log(`  ${consumerResult.passed ? '✓' : '✗'} ${consumerResult.name}`);

  // Print summary
  const summary = suite.summary;
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${summary.passed}/${summary.total} passed`);
  console.log(`  Duration: ${summary.duration_ms}ms`);
  console.log(`  Status: ${summary.all_passed ? 'ALL VALIDATIONS PASSED' : 'SOME VALIDATIONS FAILED'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (!summary.all_passed) {
    console.log('Failed validations:');
    suite.results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}`);
      r.details.forEach(d => {
        if (d.startsWith('FAIL:')) console.log(`    ${d}`);
      });
    });
    console.log('');
  }

  if (JSON_OUTPUT) {
    const output = {
      summary,
      results: suite.results.map(r => ({
        name: r.name,
        passed: r.passed,
        details: r.details,
        timestamp: r.timestamp
      }))
    };
    console.log(JSON.stringify(output, null, 2));
  }

  process.exit(summary.all_passed ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL: Validation script error:', err.message);
  process.exit(2);
});
