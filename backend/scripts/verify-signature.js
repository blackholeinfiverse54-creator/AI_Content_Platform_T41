#!/usr/bin/env node

import { createHash, verify, constants } from 'crypto';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KEYS_DIR = join(__dirname, '..', 'keys');
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'public.pem');
const EVIDENCE_DIR = join(__dirname, '..', 'evidence');

function main() {
  const ciMode = process.argv.includes('--ci');

  if (!existsSync(PUBLIC_KEY_PATH)) {
    console.error('Public key not found. Run generate-signing-key.js first.');
    process.exit(1);
  }

  const publicKey = readFileSync(PUBLIC_KEY_PATH);
  let failed = false;

  const sigFiles = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith('.sig'));

  if (sigFiles.length === 0) {
    console.log('No .sig files found in evidence directory.');
    process.exit(1);
  }

  console.log(`Verifying ${sigFiles.length} signature(s)...\n`);

  for (const sigFile of sigFiles) {
    const jsonFilename = sigFile.replace('.sig', '');
    const jsonPath = join(EVIDENCE_DIR, jsonFilename);
    const sigPath = join(EVIDENCE_DIR, sigFile);

    if (!existsSync(jsonPath)) {
      console.log(`FAIL: ${sigFile} - source file ${jsonFilename} not found`);
      failed = true;
      continue;
    }

    const content = readFileSync(jsonPath);
    const hash = createHash('sha256').update(content).digest('hex');
    const signature = Buffer.from(readFileSync(sigPath, 'utf8').trim(), 'base64');

    const valid = verify('sha256', Buffer.from(hash, 'utf8'), {
      key: publicKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    }, signature);

    if (valid) {
      console.log(`PASS: ${jsonFilename}`);
    } else {
      console.log(`FAIL: ${jsonFilename}`);
      failed = true;
    }
  }

  const manifestPath = join(EVIDENCE_DIR, 'signed-evidence.json');
  if (existsSync(manifestPath)) {
    console.log('\nVerifying signed-evidence.json manifest...');
    const manifestContent = readFileSync(manifestPath);
    const manifestHash = createHash('sha256').update(manifestContent).digest('hex');
    const manifestSigPath = join(EVIDENCE_DIR, 'signed-evidence.json.sig');

    if (!existsSync(manifestSigPath)) {
      console.log('FAIL: signed-evidence.json - no .sig file found');
      failed = true;
    } else {
      const manifestSig = Buffer.from(readFileSync(manifestSigPath, 'utf8').trim(), 'base64');
      const manifestValid = verify('sha256', Buffer.from(manifestHash, 'utf8'), {
        key: publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      }, manifestSig);

      if (manifestValid) {
        console.log('PASS: signed-evidence.json manifest');
      } else {
        console.log('FAIL: signed-evidence.json manifest');
        failed = true;
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  if (failed) {
    console.log('VERIFICATION FAILED');
    process.exit(1);
  } else {
    console.log('ALL SIGNATURES VERIFIED SUCCESSFULLY');
    if (!ciMode) console.log('(CI mode: use --ci flag for machine-readable output)');
  }
}

main();
