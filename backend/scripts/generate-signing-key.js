#!/usr/bin/env node

import { generateKeyPairSync, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KEYS_DIR = join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'public.pem');

function main() {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
  }

  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    const pub = readFileSync(PUBLIC_KEY_PATH);
    const fingerprint = createHash('sha256').update(pub).digest('hex');
    console.log('Keys already exist. Skipping generation.');
    console.log(`Public key fingerprint: ${fingerprint}`);
    return;
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(PRIVATE_KEY_PATH, privateKey);
  writeFileSync(PUBLIC_KEY_PATH, publicKey);

  const fingerprint = createHash('sha256').update(publicKey).digest('hex');
  console.log('RSA key pair generated successfully.');
  console.log(`Private key: ${PRIVATE_KEY_PATH}`);
  console.log(`Public key:  ${PUBLIC_KEY_PATH}`);
  console.log(`Public key fingerprint (SHA-256): ${fingerprint}`);
}

main();
