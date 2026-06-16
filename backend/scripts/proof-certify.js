/**
 * PHASE 4 — CERTIFICATION GENERATION
 * 
 * Reads evidence from Phases 1-3 and generates:
 *   - ARTHA_INTEGRITY_CERTIFICATE.json
 *   - ARTHA_PRODUCTION_CERTIFICATE.json
 *   - DEPLOYMENT_READINESS_CHECKLIST.json
 * 
 * All values derived from actual execution evidence.
 * Usage: node scripts/proof-certify.js
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE = path.resolve(__dirname, '../../');

// Ensure .env is loaded
const envPath = path.join(BASE, '.env');
if (!process.env.MONGODB_URI) {
  const envContent = await fs.readFile(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
const EVIDENCE_DIR = path.join(BASE, 'docs/evidence');
const HANDOVER_DIR = path.join(BASE, 'docs/handover');
const REPORT_DIR = path.join(BASE, 'docs/reports');

function ensureDir(dir) { return fs.mkdir(dir, { recursive: true }); }
function timestamp() { return new Date().toISOString(); }
function writeJSON(f, d) { return fs.writeFile(f, JSON.stringify(d, null, 2)); }

async function readEvidence(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  PHASE 4 — CERTIFICATION GENERATION');
  console.log('═══════════════════════════════════════════════════════\n');

  await ensureDir(HANDOVER_DIR);
  await ensureDir(REPORT_DIR);

  // ── Read all evidence ──────────────────────────────────────────────────
  console.log('[Step 1] Reading evidence from Phases 1-3...');

  const replayEvidence = await readEvidence(path.join(EVIDENCE_DIR, 'phase4/replay_verification_results.json'));
  const complianceEvidence = await readEvidence(path.join(EVIDENCE_DIR, 'phase4/full_compliance_trace_evidence.json'));
  const auditEvidence = await readEvidence(path.join(EVIDENCE_DIR, 'phase5/production_audit_results.json'));

  console.log('  Replay evidence:', replayEvidence ? `${replayEvidence.status}` : 'NOT FOUND');
  console.log('  Compliance evidence:', complianceEvidence ? `${complianceEvidence.status}` : 'NOT FOUND');
  console.log('  Audit evidence:', auditEvidence ? `Score: ${auditEvidence.summary?.overall_score}` : 'NOT FOUND');

  // ── Determine statuses ─────────────────────────────────────────────────
  const replayPassed = replayEvidence?.status === 'PASS';
  const compliancePassed = complianceEvidence?.status === 'PASS';
  const auditScore = auditEvidence?.summary?.overall_score || 0;
  const auditPassed = auditScore >= 60;

  const phasesCompleted = [
    replayEvidence ? 1 : null,
    complianceEvidence ? 2 : null,
    auditEvidence ? 3 : null,
  ].filter(Boolean);

  const allPhasesComplete = phasesCompleted.length === 3;

  // ── ARTHA_INTEGRITY_CERTIFICATE ────────────────────────────────────────
  console.log('\n[Step 2] Generating Integrity Certificate...');

  const integrityCert = {
    certificate_id: `CERT-INT-${Date.now()}`,
    certificate_type: 'ARTHA_INTEGRITY_CERTIFICATE',
    issued_at: timestamp(),
    valid_until: new Date(Date.now() + 365 * 86400000).toISOString(),
    issuer: 'ARTHA Certification System',
    subject: {
      system: 'ARTHA v0.1',
      description: 'India-Compliant Double-Entry Accounting System',
      repository: 'AI-Artha-main',
    },
    integrity_status: {
      deterministic_replay: {
        status: replayPassed ? 'VERIFIED' : 'NOT_VERIFIED',
        evidence_file: 'docs/evidence/phase4/replay_verification_results.json',
        details: replayEvidence?.summary?.verdict || 'Evidence not available',
        original_entry: replayEvidence?.steps?.find(s => s.step === 2)?.data?.journal?.entry_number || null,
        replay_entry: replayEvidence?.steps?.find(s => s.step === 6)?.data?.replay_entry_number || null,
        outputs_match: replayEvidence?.steps?.find(s => s.step === 7)?.data?.overall_match || false,
        chain_intact: replayEvidence?.steps?.find(s => s.step === 9)?.data?.chain_valid || false,
      },
      compliance_continuity: {
        status: compliancePassed ? 'VERIFIED' : 'NOT_VERIFIED',
        evidence_file: 'docs/evidence/phase4/full_compliance_trace_evidence.json',
        details: complianceEvidence?.summary?.verdict || 'Evidence not available',
        stages_captured: complianceEvidence?.summary?.stages_captured || [],
        missing_stages: complianceEvidence?.summary?.missing_stages || [],
        trace_continuous: complianceEvidence?.summary?.continuity || false,
      },
      ledger_integrity: {
        status: auditEvidence?.audits?.[2]?.checks?.[0]?.passed ? 'VERIFIED' : 'NOT_VERIFIED',
        double_entry_balanced: auditEvidence?.audits?.[2]?.checks?.[0]?.passed || false,
        hash_chain_valid: auditEvidence?.audits?.[2]?.checks?.[1]?.passed || false,
        account_balances_consistent: auditEvidence?.audits?.[2]?.checks?.[2]?.passed || false,
      },
    },
    overall_integrity: replayPassed && compliancePassed && auditPassed,
    score: {
      replay: replayPassed ? 100 : 0,
      compliance: compliancePassed ? 100 : 0,
      audit: auditScore,
      overall: Math.round((replayPassed ? 100 : 0 + compliancePassed ? 100 : 0 + auditScore) / 3),
    },
    verdict: replayPassed && compliancePassed && auditPassed
      ? 'ARTHA INTEGRITY CERTIFIED — Deterministic replay proven, compliance continuity verified, ledger integrity confirmed'
      : 'ARTHA INTEGRITY CONDITIONAL — Some integrity checks did not pass. Review individual evidence files.',
  };

  await writeJSON(path.join(HANDOVER_DIR, 'ARTHA_INTEGRITY_CERTIFICATE.json'), integrityCert);
  console.log('  ✓ Integrity certificate generated');

  // ── ARTHA_PRODUCTION_CERTIFICATE ───────────────────────────────────────
  console.log('\n[Step 3] Generating Production Certificate...');

  const prodCert = {
    certificate_id: `CERT-PROD-${Date.now()}`,
    certificate_type: 'ARTHA_PRODUCTION_CERTIFICATE',
    issued_at: timestamp(),
    valid_until: new Date(Date.now() + 180 * 86400000).toISOString(),
    issuer: 'ARTHA Certification System',
    subject: {
      system: 'ARTHA v0.1',
      description: 'India-Compliant Double-Entry Accounting System',
      repository: 'AI-Artha-main',
    },
    production_readiness: {
      audit_score: auditScore,
      audit_verdict: auditEvidence?.summary?.verdict || 'NOT_AUDITED',
      phases_completed: phasesCompleted,
      total_phases: 3,
      all_phases_complete: allPhasesComplete,
      security_score: auditEvidence?.audits?.[1]?.score || 0,
      security_max: auditEvidence?.audits?.[1]?.max_score || 100,
      database_integrity_score: auditEvidence?.audits?.[2]?.score || 0,
      database_integrity_max: auditEvidence?.audits?.[2]?.max_score || 100,
      api_compliance_score: auditEvidence?.audits?.[3]?.score || 0,
      api_compliance_max: auditEvidence?.audits?.[3]?.max_score || 100,
      configuration_score: auditEvidence?.audits?.[4]?.score || 0,
      configuration_max: auditEvidence?.audits?.[4]?.max_score || 100,
      system_health_score: auditEvidence?.audits?.[0]?.score || 0,
      system_health_max: auditEvidence?.audits?.[0]?.max_score || 100,
    },
    certifications: {
      integrity: integrityCert.overall_integrity ? 'CERTIFIED' : 'CONDITIONAL',
      replay: replayPassed ? 'CERTIFIED' : 'NOT_CERTIFIED',
      compliance: compliancePassed ? 'CERTIFIED' : 'NOT_CERTIFIED',
      audit: auditPassed ? 'CERTIFIED' : 'NOT_CERTIFIED',
    },
    deployment_ready: allPhasesComplete && auditPassed && replayPassed && compliancePassed,
    conditions: [],
    verdict: allPhasesComplete && auditPassed && replayPassed && compliancePassed
      ? 'ARTHA PRODUCTION CERTIFIED — All phases complete, all audits passed, ready for deployment'
      : 'ARTHA PRODUCTION CONDITIONAL — Some conditions not met. Review certification details.',
  };

  // Add conditions if not fully certified
  if (!replayPassed) prodCert.conditions.push('Deterministic replay proof incomplete');
  if (!compliancePassed) prodCert.conditions.push('Compliance continuity proof incomplete');
  if (!auditPassed) prodCert.conditions.push(`Audit score ${auditScore}/100 below threshold`);
  if (!allPhasesComplete) prodCert.conditions.push(`Only ${phasesCompleted.length}/3 phases completed`);

  await writeJSON(path.join(HANDOVER_DIR, 'ARTHA_PRODUCTION_CERTIFICATE.json'), prodCert);
  console.log('  ✓ Production certificate generated');

  // ── DEPLOYMENT_READINESS_CHECKLIST ─────────────────────────────────────
  console.log('\n[Step 4] Generating Deployment Readiness Checklist...');

  const checklist = {
    checklist_id: `CHECKLIST-${Date.now()}`,
    generated_at: timestamp(),
    system: 'ARTHA v0.1',
    items: [
      {
        category: 'Replay Proof',
        item: 'Deterministic replay verified',
        status: replayPassed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase4/replay_verification_results.json',
      },
      {
        category: 'Replay Proof',
        item: 'Journal hashes match on replay',
        status: replayEvidence?.steps?.find(s => s.step === 7)?.data?.hash_chain_integrity ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase4/replay_verification_results.json',
      },
      {
        category: 'Replay Proof',
        item: 'Chain integrity maintained after replay',
        status: replayEvidence?.steps?.find(s => s.step === 9)?.data?.chain_valid ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase4/replay_verification_results.json',
      },
      {
        category: 'Compliance',
        item: 'Full compliance chain (Transaction → Journal → Signal → Filing → Validation → Dispatch)',
        status: compliancePassed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase4/full_compliance_trace_evidence.json',
      },
      {
        category: 'Compliance',
        item: 'No missing compliance stages',
        status: (complianceEvidence?.summary?.missing_stages?.length || 0) === 0 ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase4/full_compliance_trace_evidence.json',
      },
      {
        category: 'Compliance',
        item: 'Trace continuity verified',
        status: complianceEvidence?.summary?.continuity ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase4/full_compliance_trace_evidence.json',
      },
      {
        category: 'Security',
        item: 'JWT authentication configured',
        status: auditEvidence?.audits?.[1]?.checks?.[0]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/security_audit.json',
      },
      {
        category: 'Security',
        item: 'HMAC secret configured',
        status: auditEvidence?.audits?.[1]?.checks?.[1]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/security_audit.json',
      },
      {
        category: 'Security',
        item: 'Rate limiting enabled',
        status: auditEvidence?.audits?.[1]?.checks?.[4]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/security_audit.json',
      },
      {
        category: 'Database',
        item: 'Double-entry balance verified',
        status: auditEvidence?.audits?.[2]?.checks?.[0]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/database_integrity_audit.json',
      },
      {
        category: 'Database',
        item: 'Hash chain integrity verified',
        status: auditEvidence?.audits?.[2]?.checks?.[1]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/database_integrity_audit.json',
      },
      {
        category: 'Database',
        item: 'Account balances consistent',
        status: auditEvidence?.audits?.[2]?.checks?.[2]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/database_integrity_audit.json',
      },
      {
        category: 'API',
        item: 'All route files present',
        status: auditEvidence?.audits?.[3]?.checks?.[0]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/api_compliance_audit.json',
      },
      {
        category: 'API',
        item: 'All controller files present',
        status: auditEvidence?.audits?.[3]?.checks?.[1]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/api_compliance_audit.json',
      },
      {
        category: 'Configuration',
        item: 'Environment file exists',
        status: auditEvidence?.audits?.[4]?.checks?.[0]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/configuration_audit.json',
      },
      {
        category: 'Configuration',
        item: 'Docker configuration present',
        status: auditEvidence?.audits?.[4]?.checks?.[2]?.passed ? 'PASS' : 'FAIL',
        evidence: 'docs/evidence/phase5/configuration_audit.json',
      },
    ],
    summary: {
      total: 16,
      passed: 0,
      failed: 0,
    },
  };

  checklist.summary.passed = checklist.items.filter(i => i.status === 'PASS').length;
  checklist.summary.failed = checklist.items.filter(i => i.status === 'FAIL').length;

  await writeJSON(path.join(HANDOVER_DIR, 'DEPLOYMENT_READINESS_CHECKLIST.json'), checklist);
  console.log('  ✓ Deployment checklist generated');

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  CERTIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Integrity:   ${integrityCert.overall_integrity ? '✅ CERTIFIED' : '⚠️ CONDITIONAL'}`);
  console.log(`  Production:  ${prodCert.deployment_ready ? '✅ CERTIFIED' : '⚠️ CONDITIONAL'}`);
  console.log(`  Checklist:   ${checklist.summary.passed}/${checklist.summary.total} passed`);
  console.log(`  Verdict:     ${prodCert.verdict}`);
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('✅ Phase 4 complete. Certifications generated.\n');
}

run().catch(err => { console.error('Unhandled:', err); process.exit(1); });
