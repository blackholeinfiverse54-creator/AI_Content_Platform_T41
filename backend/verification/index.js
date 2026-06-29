#!/usr/bin/env node

/**
 * ARTHA Verification Manifest
 *
 * Runs all verifiers and produces combined evidence.
 * Aggregates results from independent_verifier, replay_verifier,
 * authority_verifier, and dependency_verifier into a single manifest.
 *
 * CLI: node verification/index.js [--ci]
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const PROJECT_ROOT = join(ROOT, '..', '..');
const EVIDENCE_DIR = join(PROJECT_ROOT, 'evidence');

function computeHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function runVerifier(scriptPath, label) {
  const fullPath = join(__dirname, scriptPath);
  if (!existsSync(fullPath)) {
    return { success: false, error: `${scriptPath} not found`, output: '', evidence: null };
  }

  try {
    const output = execSync(`node "${fullPath}"`, {
      encoding: 'utf-8',
      timeout: 60000,
      cwd: ROOT,
    });
    return { success: true, output, evidence: null };
  } catch (err) {
    const output = err.stdout || err.stderr || err.message;
    return { success: false, output };
  }
}

function loadLatestEvidence(pattern) {
  if (!existsSync(EVIDENCE_DIR)) return null;
  const files = readdirSync(EVIDENCE_DIR)
    .filter(f => f.includes(pattern) && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(EVIDENCE_DIR, files[0]), 'utf-8'));
  } catch {
    return null;
  }
}

function main() {
  const isCI = process.argv.includes('--ci');
  const startTime = Date.now();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   ARTHA Verification Manifest                            ║');
  console.log('║   Running all verifiers and aggregating evidence          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const verifiers = [
    { script: 'independent_verifier/index.js', name: 'Independent Verifier', pattern: 'capability-verification' },
    { script: 'replay_verifier/index.js', name: 'Replay Verifier', pattern: 'replay-verification' },
    { script: 'authority_verifier/index.js', name: 'Authority Verifier', pattern: 'authority-verification' },
    { script: 'dependency_verifier/index.js', name: 'Dependency Verifier', pattern: 'dependency-verification' },
  ];

  const results = [];

  for (const v of verifiers) {
    console.log(`  ▸ Running ${v.name}...`);
    const result = runVerifier(v.script, v.name);
    results.push({
      verifier: v.name,
      script: v.script,
      ran: true,
      success: result.success,
      output_lines: result.output.split('\n').length,
    });

    if (result.success) {
      console.log(`    ✓ ${v.name} completed successfully`);
    } else {
      console.log(`    ✗ ${v.name} had failures`);
    }
  }

  // Load individual evidence files
  const evidenceFiles = {};
  for (const v of verifiers) {
    const ev = loadLatestEvidence(v.pattern);
    evidenceFiles[v.pattern] = ev;
  }

  const duration = Date.now() - startTime;

  // Aggregate summary
  let totalChecks = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const verifierSummaries = {};

  for (const [key, ev] of Object.entries(evidenceFiles)) {
    if (ev && ev.summary) {
      totalChecks += ev.summary.total || 0;
      totalPassed += ev.summary.passed || 0;
      totalFailed += ev.summary.failed || 0;
      verifierSummaries[key] = {
        total: ev.summary.total,
        passed: ev.summary.passed,
        failed: ev.summary.failed,
        all_passed: ev.summary.all_passed,
        evidence_hash: ev.evidence_hash,
      };
    }
  }

  const allPassed = totalFailed === 0;

  // Console summary
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  AGGREGATED RESULTS                                      │');
  console.log('├─────────────────────────────────────────────────────────┤');

  for (const [key, summary] of Object.entries(verifierSummaries)) {
    if (summary) {
      const icon = summary.all_passed ? '✓' : '✗';
      console.log(`│  ${icon} ${key}: ${summary.passed}/${summary.total} passed`);
    }
  }

  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  TOTAL: ${totalPassed}/${totalChecks} checks passed, ${totalFailed} failed`);
  console.log(`│  DURATION: ${duration}ms`);
  console.log(`│  OVERALL: ${allPassed ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('└─────────────────────────────────────────────────────────┘\n');

  // Build manifest
  const manifest = {
    verifier: 'ARTH Verification Manifest',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    overall_status: allPassed ? 'PASS' : 'FAIL',
    summary: {
      total_checks: totalChecks,
      passed: totalPassed,
      failed: totalFailed,
      all_passed: allPassed,
    },
    verifier_results: results,
    verifier_summaries: verifierSummaries,
    evidence_files: Object.keys(evidenceFiles).filter(k => evidenceFiles[k] !== null),
  };

  const manifestHash = computeHash(manifest);
  manifest.evidence_hash = manifestHash;

  // Write manifest
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const manifestPath = join(EVIDENCE_DIR, `verification-manifest-${date}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  Manifest written to: ${manifestPath}`);
  console.log(`  Manifest hash: ${manifestHash.substring(0, 16)}...\n`);

  if (isCI && !allPassed) {
    process.exit(1);
  }
}

main();