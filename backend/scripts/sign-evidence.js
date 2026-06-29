#!/usr/bin/env node

import { createHash, sign, constants } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KEYS_DIR = join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'private.pem');
const EVIDENCE_DIR = join(__dirname, '..', 'evidence');

function main() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error('Private key not found. Run generate-signing-key.js first.');
    process.exit(1);
  }

  const privateKey = readFileSync(PRIVATE_KEY_PATH);
  const publicKey = readFileSync(join(KEYS_DIR, 'public.pem'));
  const fingerprint = createHash('sha256').update(publicKey).digest('hex');

  const jsonFiles = readdirSync(EVIDENCE_DIR).filter(
    (f) => f.endsWith('.json') && f !== 'signed-evidence.json'
  );

  if (jsonFiles.length === 0) {
    console.log('No JSON files found in evidence directory.');
    return;
  }

  const signedFiles = [];

  for (const file of jsonFiles) {
    const filePath = join(EVIDENCE_DIR, file);
    const content = readFileSync(filePath);
    const hash = createHash('sha256').update(content).digest('hex');

    const signature = sign('sha256', Buffer.from(hash, 'utf8'), {
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    });

    const sigPath = join(EVIDENCE_DIR, `${file}.sig`);
    writeFileSync(sigPath, signature.toString('base64'));

    signedFiles.push({ filename: file, hash, signature: signature.toString('base64') });
    console.log(`Signed: ${file}`);
  }

  const manifest = {
    signed_at: new Date().toISOString(),
    public_key_fingerprint: fingerprint,
    files: signedFiles,
    verification_instructions: {
      command: 'node scripts/verify-signature.js',
      description: 'Verify all evidence file signatures using the public key.',
      required_files: ['backend/keys/public.pem', 'evidence/signed-evidence.json', 'evidence/*.sig'],
    },
  };

  const manifestPath = join(EVIDENCE_DIR, 'signed-evidence.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const manifestContent = readFileSync(manifestPath);
  const manifestHash = createHash('sha256').update(manifestContent).digest('hex');
  const manifestSig = sign('sha256', Buffer.from(manifestHash, 'utf8'), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  writeFileSync(join(EVIDENCE_DIR, 'signed-evidence.json.sig'), manifestSig.toString('base64'));

  console.log(`\nManifest written and signed: signed-evidence.json`);
  console.log(`Total files signed: ${signedFiles.length} + manifest`);
}

main();
