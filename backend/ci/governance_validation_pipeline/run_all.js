#!/usr/bin/env node

/**
 * ARTHA Governance Pipeline Runner — v1.0
 *
 * Simple orchestrator that spawns the full governance pipeline.
 * Handles errors, logging, and exit code propagation.
 *
 * USAGE:
 *   node ci/run_all.js [--ci]
 *
 * This is equivalent to:
 *   node ci/governance_pipeline.js [--ci]
 *
 * It exists as a convenience entry point and can be used in:
 *   - npm scripts ("governance:run": "node ci/run_all.js")
 *   - CI/CD pipelines
 *   - Manual governance verification
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PIPELINE_SCRIPT = join(__dirname, 'index.js');
const IS_CI = process.argv.includes('--ci');

console.log('');
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║     ARTHA Governance Pipeline Runner                     ║');
console.log('║     Spawning full governance CI pipeline                 ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');

const args = process.argv.slice(2).filter(a => a !== '--ci');
if (IS_CI) args.push('--ci');

const start = Date.now();

try {
  const cmd = `node "${PIPELINE_SCRIPT}" ${args.join(' ')}`.trim();
  console.log(`  Executing: ${cmd}\n`);

  execSync(cmd, {
    cwd: __dirname,
    encoding: 'utf-8',
    stdio: 'inherit',
    timeout: 300000,
  });

  const duration = Date.now() - start;
  console.log(`\n  Pipeline completed successfully in ${duration}ms`);
  process.exit(0);

} catch (err) {
  const duration = Date.now() - start;
  console.error(`\n  Pipeline failed after ${duration}ms`);
  if (err.status !== undefined) {
    console.error(`  Exit code: ${err.status}`);
  }
  process.exit(err.status || 1);
}
