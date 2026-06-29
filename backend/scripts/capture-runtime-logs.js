#!/usr/bin/env node
/**
 * backend/scripts/capture-runtime-logs.js
 * 
 * Starts the server, makes test requests, captures logs, then stops the server.
 * Usage: node scripts/capture-runtime-logs.js
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const EVIDENCE_DIR = resolve(ROOT, 'evidence');
const LOGS_DIR = resolve(EVIDENCE_DIR, 'runtime_logs');
const SERVER_ENTRY = resolve(ROOT, 'src', 'server.js');
const PORT = process.env.PORT || 5001; // Use non-default port to avoid conflicts
const STARTUP_TIMEOUT = 15000;
const REQUEST_TIMEOUT = 5000;

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function makeRequest(reqPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path: reqPath,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', (err) => {
      reject(new Error(err.message || String(err)));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function waitForServer(timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 500) {
            resolve(true);
          } else if (Date.now() - start > timeout) {
            reject(new Error('Server did not become ready in time'));
          } else {
            setTimeout(check, 500);
          }
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Server did not become ready in time'));
        } else {
          setTimeout(check, 500);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error('Server did not become ready in time'));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

async function main() {
  console.log('=== ARTHA Runtime Log Capture ===');
  console.log('Timestamp:', new Date().toISOString());

  ensureDir(LOGS_DIR);

  // Start the server
  console.log(`Starting server from: ${SERVER_ENTRY}`);
  console.log(`Using port: ${PORT}`);

  let serverProcess;
  try {
    serverProcess = spawn('node', [SERVER_ENTRY], {
      cwd: ROOT,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'development',
      },
    });
  } catch (err) {
    console.error('Failed to start server process:', err.message);
    process.exit(1);
  }

  const logChunks = [];
  const timestamp = () => new Date().toISOString();

  serverProcess.stdout.on('data', (data) => {
    const msg = `[${timestamp()}] STDOUT: ${data.toString()}`;
    logChunks.push(msg);
    process.stdout.write(msg);
  });

  serverProcess.stderr.on('data', (data) => {
    const msg = `[${timestamp()}] STDERR: ${data.toString()}`;
    logChunks.push(msg);
    process.stderr.write(msg);
  });

  let exitCode = null;
  serverProcess.on('exit', (code) => {
    exitCode = code;
    logChunks.push(`[${timestamp()}] Server exited with code ${code}`);
  });

  serverProcess.on('error', (err) => {
    logChunks.push(`[${timestamp()}] Server error: ${err.message}`);
  });

  // Wait for server to become ready
  console.log('\nWaiting for server to start...');
  try {
    await waitForServer(STARTUP_TIMEOUT);
    console.log('Server is ready!');
  } catch (err) {
    console.warn('Server readiness check failed:', err.message);
    console.warn('Waiting extra 5 seconds for server to stabilize...');
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Make test requests
  const requestLog = [];
  const healthResults = {};

  const endpoints = [
    { name: 'health', path: '/health', method: 'GET' },
    { name: 'health_detailed', path: '/health/detailed', method: 'GET' },
    { name: 'observability', path: '/observability', method: 'GET' },
    { name: 'prometheus', path: '/prometheus', method: 'GET' },
    { name: 'reports_dashboard', path: '/api/v1/reports/dashboard', method: 'GET' },
    { name: 'ledger_entries', path: '/api/v1/ledger/entries', method: 'GET' },
    {
      name: 'auth_login_invalid',
      path: '/api/v1/auth/login',
      method: 'POST',
      body: { email: 'nonexistent@test.com', password: 'wrongpassword' },
    },
  ];

  for (const ep of endpoints) {
    const ts = new Date().toISOString();
    console.log(`\n${ep.method} ${ep.path}`);

    try {
      const response = await makeRequest(ep.path, ep.method, ep.body || null);
      const entry = {
        endpoint: ep.path,
        method: ep.method,
        timestamp: ts,
        status: response.status,
        headers: response.headers,
        body: response.body,
      };
      requestLog.push(entry);

      // Track health results
      if (ep.name.startsWith('health')) {
        healthResults[ep.name] = {
          status: response.status,
          healthy: response.status === 200,
          data: response.body,
        };
      }

      console.log(`  Status: ${response.status}`);
      const bodyStr = JSON.stringify(response.body, null, 2);
      if (bodyStr.length < 200) {
        console.log(`  Body: ${bodyStr}`);
      } else {
        console.log(`  Body: ${bodyStr.slice(0, 200)}...`);
      }
    } catch (err) {
      const errMsg = err?.message || String(err);
      const errCode = err?.code || 'UNKNOWN';
      console.log(`  Error [${errCode}]: ${errMsg}`);
      requestLog.push({
        endpoint: ep.path,
        method: ep.method,
        timestamp: ts,
        status: 0,
        error_code: errCode,
        error: errMsg,
      });

      if (ep.name.startsWith('health')) {
        healthResults[ep.name] = {
          status: 0,
          healthy: false,
          error: err.message,
        };
      }
    }
  }

  // Stop the server
  console.log('\nStopping server...');
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {
      // On Windows SIGTERM may not be supported, force kill
      try { serverProcess.kill('SIGKILL'); } catch {}
    }
    // Wait a moment for graceful shutdown
    await new Promise((r) => setTimeout(r, 3000));
    if (!serverProcess.killed) {
      try { serverProcess.kill('SIGKILL'); } catch {}
    }
  }

  // Wait for process to fully exit
  await new Promise((r) => setTimeout(r, 1000));

  // Write captured logs
  const serverLogPath = resolve(LOGS_DIR, 'server-output.log');
  writeFileSync(serverLogPath, logChunks.join('\n'));
  console.log(`\nServer logs written to: ${serverLogPath}`);

  // Write request log
  const requestLogPath = resolve(LOGS_DIR, 'request-log.json');
  writeFileSync(requestLogPath, JSON.stringify({
    captured_at: new Date().toISOString(),
    port: PORT,
    requests: requestLog,
  }, null, 2));
  console.log(`Request log written to: ${requestLogPath}`);

  // Write health check results
  const healthCheckPath = resolve(LOGS_DIR, 'health-check.json');
  writeFileSync(healthCheckPath, JSON.stringify({
    checked_at: new Date().toISOString(),
    port: PORT,
    server_process_exit_code: exitCode,
    endpoints: healthResults,
    overall_healthy: Object.values(healthResults).some((h) => h.healthy),
  }, null, 2));
  console.log(`Health check results written to: ${healthCheckPath}`);

  console.log('\n=== Runtime log capture complete ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
