#!/usr/bin/env node
/**
 * backend/scripts/capture-full-runtime-logs.js
 *
 * Starts the server, makes requests demonstrating authority enforcement,
 * captures everything, then stops the server.
 *
 * Usage: node scripts/capture-full-runtime-logs.js
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const EVIDENCE_DIR = resolve(ROOT, '..', 'evidence');
const LOGS_DIR = resolve(EVIDENCE_DIR, 'runtime_logs');
const SERVER_ENTRY = resolve(ROOT, 'src', 'server.js');
const PORT = 5002;
const STARTUP_TIMEOUT = 20000;
const REQUEST_TIMEOUT = 5000;

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function makeRequest(reqPath, method = 'GET', body = null) {
  return new Promise((res, rej) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: reqPath,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT,
    };
    const req = http.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        res({ status: response.statusCode, headers: response.headers, body: parsed });
      });
    });
    req.on('error', (err) => rej(new Error(err.message || String(err))));
    req.on('timeout', () => { req.destroy(); rej(new Error('Request timed out')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function waitForServer(timeout) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/health`, (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => {
          if (r.statusCode < 500) res(true);
          else if (Date.now() - start > timeout) rej(new Error('Server not ready'));
          else setTimeout(check, 500);
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) rej(new Error('Server not ready'));
        else setTimeout(check, 500);
      });
      req.on('timeout', () => { req.destroy(); if (Date.now() - start > timeout) rej(new Error('Server not ready')); else setTimeout(check, 500); });
    };
    check();
  });
}

async function main() {
  console.log('=== ARTHA Full Runtime Log Capture ===');
  console.log('Timestamp:', new Date().toISOString());

  ensureDir(LOGS_DIR);

  // Start the server
  console.log(`Starting server: node ${SERVER_ENTRY} on port ${PORT}`);
  let serverProcess;
  try {
    serverProcess = spawn('node', [SERVER_ENTRY], {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }

  const logChunks = [];
  const ts = () => new Date().toISOString();

  serverProcess.stdout.on('data', (data) => {
    const msg = `[${ts()}] STDOUT: ${data.toString()}`;
    logChunks.push(msg);
    process.stdout.write(msg);
  });
  serverProcess.stderr.on('data', (data) => {
    const msg = `[${ts()}] STDERR: ${data.toString()}`;
    logChunks.push(msg);
    process.stderr.write(msg);
  });

  let exitCode = null;
  serverProcess.on('exit', (code) => { exitCode = code; logChunks.push(`[${ts()}] Server exited with code ${code}`); });
  serverProcess.on('error', (err) => { logChunks.push(`[${ts()}] Server error: ${err.message}`); });

  // Wait for server
  console.log('\nWaiting for server to start...');
  let serverReady = false;
  try {
    await waitForServer(STARTUP_TIMEOUT);
    serverReady = true;
    console.log('Server is ready!');
  } catch (err) {
    console.warn('Server readiness check failed:', err.message);
    console.warn('Waiting extra 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
  }

  // Define all requests
  const endpoints = [
    { name: 'health', path: '/health', method: 'GET', expectStatus: 200, desc: 'Health check (public)' },
    { name: 'health_detailed', path: '/health/detailed', method: 'GET', expectStatus: 200, desc: 'Detailed health (public)' },
    { name: 'observability', path: '/observability', method: 'GET', expectStatus: 200, desc: 'Observability metrics (public)' },
    { name: 'prometheus', path: '/prometheus', method: 'GET', expectStatus: 200, desc: 'Prometheus metrics (public)' },
    { name: 'dashboard', path: '/dashboard', method: 'GET', expectStatus: [200, 302], desc: 'Dashboard redirect (public)' },
    { name: 'ledger_entries_no_auth', path: '/api/v1/ledger/entries', method: 'GET', expectStatus: 401, desc: 'Ledger entries WITHOUT auth (should 401)' },
    { name: 'audit_trail_no_auth', path: '/api/v1/audit/trail/invoice/123', method: 'GET', expectStatus: 401, desc: 'Audit trail WITHOUT auth (should 401)' },
    { name: 'signals_no_auth', path: '/api/v1/signals', method: 'GET', expectStatus: 401, desc: 'Signals WITHOUT auth (should 401)' },
    { name: 'trace_no_auth', path: '/api/v1/trace/test-trace', method: 'GET', expectStatus: 401, desc: 'Trace WITHOUT auth (should 401)' },
    { name: 'login_wrong_password', path: '/api/v1/auth/login', method: 'POST', body: { email: 'test@test.com', password: 'wrongpassword' }, expectStatus: 401, desc: 'Login with wrong password (should 401)' },
    { name: 'post_ledger_no_auth', path: '/api/v1/ledger/entries', method: 'POST', body: { test: true }, expectStatus: 401, desc: 'POST ledger entries WITHOUT auth (mutation blocked)' },
    { name: 'post_invoices_no_auth', path: '/api/v1/invoices', method: 'POST', body: { test: true }, expectStatus: 401, desc: 'POST invoices WITHOUT auth (should 401)' },
    { name: 'nonexistent_endpoint', path: '/api/v1/nonexistent-endpoint', method: 'GET', expectStatus: 404, desc: 'Nonexistent endpoint (should 404)' },
    { name: 'reports_no_auth', path: '/api/v1/reports/profit-loss', method: 'GET', expectStatus: 401, desc: 'Reports WITHOUT auth (should 401)' },
  ];

  const requestLog = [];
  const healthResults = {};
  const enforcementResults = [];

  for (const ep of endpoints) {
    const requestTimestamp = new Date().toISOString();
    console.log(`\n${ep.method} ${ep.path} — ${ep.desc}`);
    try {
      const response = await makeRequest(ep.path, ep.method, ep.body || null);
      const entry = {
        endpoint: ep.path,
        method: ep.method,
        name: ep.name,
        description: ep.desc,
        timestamp: requestTimestamp,
        status: response.status,
        body: response.body,
      };
      requestLog.push(entry);

      const statusMatch = Array.isArray(ep.expectStatus)
        ? ep.expectStatus.includes(response.status)
        : response.status === ep.expectStatus;

      enforcementResults.push({
        endpoint: ep.path,
        method: ep.method,
        name: ep.name,
        description: ep.desc,
        expected_status: ep.expectStatus,
        actual_status: response.status,
        blocked: statusMatch,
        timestamp: requestTimestamp,
      });

      if (ep.name.startsWith('health')) {
        healthResults[ep.name] = { status: response.status, healthy: response.status === 200, data: typeof response.body === 'object' ? response.body : null };
      }

      console.log(`  Status: ${response.status} (expected: ${ep.expectStatus}) ${statusMatch ? '✓' : '✗'}`);
      const bodyStr = JSON.stringify(response.body);
      console.log(`  Body: ${bodyStr.length < 200 ? bodyStr : bodyStr.slice(0, 200) + '...'}`);
    } catch (err) {
      const errMsg = err?.message || String(err);
      console.log(`  Error: ${errMsg}`);
      requestLog.push({ endpoint: ep.path, method: ep.method, name: ep.name, description: ep.desc, timestamp: requestTimestamp, status: 0, error: errMsg });
      enforcementResults.push({ endpoint: ep.path, method: ep.method, name: ep.name, description: ep.desc, expected_status: ep.expectStatus, actual_status: 0, blocked: false, timestamp: requestTimestamp, error: errMsg });
    }
  }

  // Stop the server
  console.log('\nStopping server...');
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill('SIGTERM'); } catch { try { serverProcess.kill('SIGKILL'); } catch {} }
    await new Promise(r => setTimeout(r, 3000));
    if (!serverProcess.killed) { try { serverProcess.kill('SIGKILL'); } catch {} }
  }
  await new Promise(r => setTimeout(r, 1000));

  // Compute enforcement summary
  const authBypassAttempts = enforcementResults.filter(e =>
    e.name.includes('no_auth') || e.name.includes('wrong_password')
  );
  const authBypassBlocked = authBypassAttempts.filter(e => e.blocked);

  // Write all output files
  writeFileSync(resolve(LOGS_DIR, 'server-output.log'), logChunks.join('\n'));
  console.log(`\nWrote: runtime_logs/server-output.log`);

  writeFileSync(resolve(LOGS_DIR, 'request-log.json'), JSON.stringify({
    captured_at: new Date().toISOString(),
    port: PORT,
    server_ready: serverReady,
    requests: requestLog,
  }, null, 2));
  console.log('Wrote: runtime_logs/request-log.json');

  writeFileSync(resolve(LOGS_DIR, 'authority-enforcement-log.json'), JSON.stringify({
    enforcement_tested_at: new Date().toISOString(),
    server_port: PORT,
    server_ready: serverReady,
    requests_made: endpoints.length,
    auth_bypass_attempts: authBypassAttempts.length,
    auth_bypass_blocked: authBypassBlocked.length,
    enforcement_rate: authBypassAttempts.length > 0
      ? `${((authBypassBlocked.length / authBypassAttempts.length) * 100).toFixed(0)}%`
      : 'N/A',
    endpoints_tested: enforcementResults,
  }, null, 2));
  console.log('Wrote: runtime_logs/authority-enforcement-log.json');

  writeFileSync(resolve(LOGS_DIR, 'health-check.json'), JSON.stringify({
    checked_at: new Date().toISOString(),
    port: PORT,
    server_process_exit_code: exitCode,
    server_ready: serverReady,
    endpoints: healthResults,
    overall_healthy: Object.values(healthResults).some(h => h.healthy),
  }, null, 2));
  console.log('Wrote: runtime_logs/health-check.json');

  console.log('\n=== Full Runtime Log Capture Complete ===');
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
