/**
 * ARTHA PROOF ORCHESTRATOR
 * 
 * Runs all phases sequentially and generates the complete certification packet.
 * Usage: node scripts/proof-all.js
 * 
 * Prerequisites:
 *   - MongoDB must be running and accessible
 *   - Database must be seeded (node scripts/seed.js)
 *   - All environment variables must be set
 */

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE = path.resolve(__dirname, '../../');

const phases = [
  { name: 'Phase 1: Deterministic Replay', script: 'proof-replay.js' },
  { name: 'Phase 2: Compliance Continuity', script: 'proof-compliance.js' },
  { name: 'Phase 3: Production Audit', script: 'proof-audit.js' },
  { name: 'Phase 4: Certification', script: 'proof-certify.js' },
];

async function run() {
  const startTime = Date.now();
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║     ARTHA PROOF ORCHESTRATOR — ALL PHASES            ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const phase of phases) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  RUNNING: ${phase.name}`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      const output = execSync(`node scripts/${phase.script}`, {
        cwd: path.join(BASE, 'backend'),
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(output);
      results.push({ phase: phase.name, status: 'SUCCESS', script: phase.script });
    } catch (error) {
      console.log(error.stdout || '');
      console.error(error.stderr || error.message);
      results.push({ phase: phase.name, status: 'FAILED', script: phase.script, error: error.message });
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  ORCHESTRATION COMPLETE');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Time elapsed: ${elapsed}s`);
  console.log(`  Phases run: ${results.length}`);
  console.log(`  Successful: ${results.filter(r => r.status === 'SUCCESS').length}`);
  console.log(`  Failed: ${results.filter(r => r.status === 'FAILED').length}`);
  console.log('');

  for (const r of results) {
    console.log(`  ${r.status === 'SUCCESS' ? '✅' : '❌'} ${r.phase}`);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Deliverables:');
  console.log(`${'═'.repeat(60)}`);
  console.log('  📄 docs/evidence/phase4/replay_verification_results.json');
  console.log('  📄 docs/evidence/phase4/full_compliance_trace_evidence.json');
  console.log('  📄 docs/evidence/phase5/production_audit_results.json');
  console.log('  📄 docs/evidence/phase5/system_health_audit.json');
  console.log('  📄 docs/evidence/phase5/security_audit.json');
  console.log('  📄 docs/evidence/phase5/database_integrity_audit.json');
  console.log('  📄 docs/evidence/phase5/api_compliance_audit.json');
  console.log('  📄 docs/evidence/phase5/configuration_audit.json');
  console.log('  📄 docs/handover/ARTHA_INTEGRITY_CERTIFICATE.json');
  console.log('  📄 docs/handover/ARTHA_PRODUCTION_CERTIFICATE.json');
  console.log('  📄 docs/handover/DEPLOYMENT_READINESS_CHECKLIST.json');
  console.log('  📄 docs/reports/replay_execution_report.md');
  console.log('  📄 docs/reports/compliance_continuity_report.md');
  console.log('  📄 docs/reports/PRODUCTION_AUDIT_REPORT.md');
  console.log(`${'═'.repeat(60)}\n`);
}

run().catch(err => {
  console.error('Orchestrator error:', err);
  process.exit(1);
});
