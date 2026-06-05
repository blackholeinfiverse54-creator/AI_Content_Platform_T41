# DEPLOYMENT_RUNTIME_PACKAGE.md
# Phase 5 — Deployment + Monitoring Closure
# ARTHA v0.1 | Operational Readiness Package

---

## Environment Variables — Complete Reference

### Backend (`backend/.env`)

#### Critical — App will not start without these

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `MONGODB_URI` | YES | `mongodb+srv://user:pass@cluster.mongodb.net/?appName=Artha` | Must be reachable. Atlas M0 free tier works. |
| `JWT_SECRET` | YES | `blackhole-auth-super-secure-random-secret-min-32-chars` | Min 32 chars. Used to sign/verify all JWTs. |
| `HMAC_SECRET` | YES | `artha-hmac-chain-secret-local-dev-32chars-ok` | Min 32 chars. Signs ledger hash chain. **Never change in production — invalidates all existing hashes.** |

#### Server config

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `NODE_ENV` | No | `development` | Set to `production` in prod |
| `PORT` | No | `5000` | HTTP server port |
| `LOG_LEVEL` | No | `debug` | `error/warn/info/debug` |

#### URLs and CORS

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `APP_URL` | No | `http://localhost:5000` | This API's public base URL |
| `FRONTEND_URL` | No | `http://localhost:5173` | SPA origin — used in CORS + login redirects |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Browser-accessible origin |
| `CORS_ALLOWED_ORIGINS` | No | — | Comma-separated additional origins |
| `ALLOW_LOCALHOST_CORS` | No | `true` | Set `false` to block localhost in prod |
| `APP_LOGIN_URL` | No | `{FRONTEND_URL}/login` | Override login redirect URL |

#### JWT / Auth

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `JWT_EXPIRES_IN` | No | `7d` | Token lifetime. No refresh token — users re-login after expiry. |
| `APP_ID` | No | — | If set, JWT must include this in `allowedApps` |
| `BHIV_APP_ID` | No | — | Alias for APP_ID |

#### Rate Limiting

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | 15 minutes |
| `RATE_LIMIT_MAX` | No | `1000` | Requests per window (development skips rate limiting) |
| `AUTH_PASSWORD_RATE_LIMIT_MAX` | No | `50` | Login attempts per 15 min |
| `AUTH_SIGNUP_RATE_LIMIT_MAX` | No | `20` | Signup attempts per 15 min |
| `TRUST_PROXY` | No | `1` | Set `0` to disable (Render/reverse proxy environments need `1`) |

#### SETU Integration

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `SETU_ENABLED` | No | `false` | Set `true` to enable real dispatch |
| `SETU_BASE_URL` | SETU only | `https://setu.example.com` | SETU endpoint base URL |
| `SETU_API_KEY` | SETU only | — | SETU Bearer token |
| `SETU_TIMEOUT_MS` | No | `5000` | Dispatch timeout in milliseconds |

#### Storage

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `STORAGE_TYPE` | No | `local` | `local` or `s3` |
| `AWS_BUCKET_NAME` | S3 only | — | S3 bucket for receipts |
| `AWS_REGION` | S3 only | — | AWS region |
| `AWS_ACCESS_KEY_ID` | S3 only | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | S3 only | — | AWS secret key |

#### Optional Services

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `INSIGHTCORE_ENDPOINT` | No | `http://localhost:8000/telemetry` | InsightCore telemetry |
| `INSIGHTCORE_ENABLED` | No | `false` | Enable InsightCore |
| `MONGODB_TEST_URI` | Test only | — | Separate URI for jest tests |

---

### Frontend (`frontend/.env`)

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `VITE_API_URL` | No | (auto) | Full API base URL including `/api/v1`. Overrides auto-detection. |
| `VITE_API_ORIGIN` | No | (auto) | API origin only (no path). `${VITE_API_ORIGIN}/api/v1` used as base. |
| `VITE_MOCK_MODE` | No | unset | Set `true` to force MOCK_MODE. Development only. |

**Auto-detection logic (`frontend/src/services/api.js:resolveApiConfig()`):**
```
1. VITE_API_URL set → use it directly
2. VITE_API_ORIGIN set → append /api/v1
3. window.location.hostname === localhost → http://localhost:5000/api/v1
4. Otherwise → ${window.location.origin}/api/v1  (production same-origin)
```

---

## Startup Flow

### Development

```bash
# Step 1: Start backend
cd backend
npm install
cp .env.example .env          # then fill in MONGODB_URI, JWT_SECRET, HMAC_SECRET
npm run dev                   # nodemon src/server.js → port 5000

# Step 2: Seed database (REQUIRED for GST + TDS to work)
node scripts/seed.js          # creates CompanySettings + 33 Chart of Accounts + sample invoices
node scripts/seed-tds.js      # creates 6 TDS entries for Q4 FY2025-26

# Step 3: Verify seeding
node scripts/verify-integrity.js

# Step 4: Start frontend
cd ../frontend
npm install
npm run dev                   # vite → http://localhost:5173
```

### Production (Docker)

```bash
# Full stack
docker-compose -f docker-compose.prod.yml up -d

# Dev stack
docker-compose -f docker-compose.dev.yml up -d

# Monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d
```

### Backend-only startup sequence (inside Docker/server)

1. `dotenv.config()` — loads `.env`
2. `validateEnvironment()` — checks required vars (production only)
3. `connectDB()` — connects to MongoDB Atlas, checks replica set for transactions
4. `connectRedis()` — optional, continues without Redis if unavailable
5. Express app setup — CORS, Helmet, rate limiting, body parsing
6. Route mounting — all 18 route groups
7. `app.listen(PORT)` — ready

**Server is ready when logs show:**
```
MongoDB Connected: artha.rzneis7.mongodb.net
Server running on port 5000
SPA (public app): http://localhost:5173
```

---

## Runtime Dependencies

### Required (startup fails without these)

| Dependency | Version | Why |
|------------|---------|-----|
| MongoDB Atlas | 7+ | Primary database. All models depend on it. |
| Node.js | 18+ | ESM modules (`type: module`), `randomUUID()` from `node:crypto` |

### Optional (app degrades gracefully)

| Dependency | Degradation behavior |
|------------|---------------------|
| Redis | Cache reads return null → re-computed each request. All features work. Logged as warning. |
| MongoDB Replica Set | `withTransaction()` runs without ACID guarantees. `areTransactionsAvailable()` returns false. Logged as warning. |
| Tesseract.js | OCR for images unavailable. PDF OCR via pdf-parse still works. Expense creation still works (manual entry). |
| SETU endpoint | `dispatch_attempted: false` returned. Payload proof still generated. Signals persisted locally. |

### Transaction availability check

On startup, backend tries:
```js
await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
```
- Success → `transactionsAvailable = true` → all `withTransaction()` calls use ACID sessions
- Failure → `transactionsAvailable = false` → `withTransaction(callback(null))` runs without session

**Atlas M0 free tier is a replica set** → transactions available.

---

## Health Check Usage

### Endpoints and their purpose

| Endpoint | Auth | Purpose | Use case |
|----------|------|---------|----------|
| `GET /health` | None | Basic liveness | `useRuntimeMode` boot check, load balancer health check |
| `GET /health/detailed` | None | Component health (DB, Redis, disk) | Monitoring dashboard |
| `GET /ready` | None | Kubernetes readiness probe | K8s deployment |
| `GET /live` | None | Kubernetes liveness probe | K8s deployment |
| `GET /status` | None | DB + Redis status | Quick operational check |
| `GET /metrics` | None | Performance metrics (limited) | Prometheus scraping |
| `GET /api/v1/runtime/status` | Bearer token | Full operational proof | Integration layer, incoming developer check |

### Health check response shapes

**`GET /health` (200 always if server is running):**
```json
{ "success": true, "message": "ARTHA API is running", "timestamp": "...", "version": "0.1.0", "uptime": 3600.5 }
```

**`GET /health/detailed` (200 healthy, 503 unhealthy):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "components": {
      "database": { "status": "healthy", "state": "connected" },
      "redis": { "status": "disabled", "message": "Redis not configured" },
      "disk": { "status": "healthy" }
    }
  }
}
```

**`GET /api/v1/runtime/status` (200 with auth token):**
Returns full `{ ledger, compliance, transactions, setu, endpoints }` state.
See `backend/src/routes/runtime.routes.js`.

---

## Common Failures and Recovery

### Failure: "Company GSTIN not configured"

**When:** Any GST operation (invoice send, expense record with GST, GST summary)

**Cause:** `CompanySettings` document with `_id: 'company_settings'` missing, or `gstin` field empty

**Recovery:**
```bash
cd backend
node scripts/seed.js   # creates CompanySettings with sample data
```
Or via UI: navigate to `/settings/company` → fill in GSTIN, address.state → save.

---

### Failure: "Required accounts not found"

**When:** Invoice send, expense record, TDS deduction

**Cause:** Chart of Accounts not seeded — accounts 1010, 1100, 2311, 2312, 2313, etc. don't exist

**Recovery:**
```bash
cd backend
node scripts/seed.js   # creates 33 Chart of Accounts
```

---

### Failure: MongoDB connection timeout

**When:** Server startup or any DB operation

**Cause:** MongoDB Atlas connection string wrong, IP not whitelisted, cluster paused

**Recovery:**
1. Check `MONGODB_URI` in `.env`
2. Whitelist your IP in Atlas Network Access
3. Wake up cluster if paused (free tier auto-pauses after inactivity)
4. Test: `node -e "const mongoose=require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(()=>console.log('ok'))`

---

### Failure: JWT "Token is invalid or expired"

**When:** Any authenticated API call after 7 days

**Cause:** JWT expired (7-day default), tampered token, or wrong `JWT_SECRET`

**Recovery:** Re-login. If all users are locked out (JWT_SECRET changed), update secret back or issue new tokens.

---

### Failure: "Transactions not available"

**When:** Log warning on startup, not an error

**Cause:** MongoDB not running as replica set

**Recovery:** Use Atlas (replica set by default) or configure local replica set. Operations continue without ACID guarantees.

---

### Failure: Ledger chain invalid

**When:** `GET /api/v1/ledger/verify-chain` returns `isValid: false`

**Cause options:**
1. `HMAC_SECRET` changed after entries were created
2. Manual DB edit of a LedgerEntry
3. Data migration without re-hashing

**Recovery:**
```bash
# If HMAC_SECRET changed:
node scripts/migrate-hash-chain.js

# Otherwise: investigate at the position reported in errors[]
# Do NOT silently re-hash — this would defeat tamper detection
```

---

### Failure: Rate limit exceeded

**When:** HTTP 429 response

**Cause:** > 1000 requests per 15 minutes from same IP (development: unlimited)

**Recovery:** Wait for window reset (15 min). For development, rate limiting is skipped automatically (`skip: (req) => process.env.NODE_ENV === 'development'`).

---

### Failure: SETU pipeline fails at VALIDATE stage

**When:** `POST /api/v1/signals/:id/dispatch` returns 422

**Common causes and fixes:**

| Error | Fix |
|-------|-----|
| `source.module "UNKNOWN" is not recognized` | Signal was emitted with unknown module. Re-emit with valid module from `VALID_MODULES` |
| `source.entity_type "UNKNOWN" is not recognized` | Signal context missing entity_type. Re-emit correctly. |
| `source.entity_id is missing or unresolved` | Signal context has `entity_id: "UNKNOWN"`. Re-emit with real entity ID. |
| `signal_id "XYZ" is not a recognized signal type` | signal_id is neither in `VALID_SIGNAL_TYPES` nor matches `SIG-<uuid>` format. This should not happen with signals generated by `signalEngine.emitSignal()`. |

---

## Deployment Checklist

### Pre-deployment

```
□ MONGODB_URI tested and reachable
□ JWT_SECRET set (min 32 chars)
□ HMAC_SECRET set (min 32 chars) — STORE THIS PERMANENTLY
□ FRONTEND_URL set to production SPA URL
□ CORS_ORIGIN set to production SPA URL
□ node scripts/seed.js ran on fresh database
□ GET /health returns 200
□ GET /api/v1/runtime/status returns "operational"
□ GET /api/v1/ledger/verify-chain returns isValid: true
□ Login works, JWT issued
□ Expense create → approve → verify ledger entry created
□ GET /api/v1/signals/snapshot returns cashFlow value
```

### Production-specific

```
□ NODE_ENV=production
□ RATE_LIMIT_MAX set appropriately
□ TRUST_PROXY=1 (for Render/reverse proxy)
□ Docker containers running as non-root
□ Backups configured: node scripts/backup-database.js
□ Monitoring stack deployed (docker-compose.monitoring.yml)
□ Logs shipping to external service (currently: winston to files + console)
```

### Render.com deployment

See `backend/render.yaml` for service definitions.

Required env vars in Render dashboard:
- `MONGODB_URI`
- `JWT_SECRET`
- `HMAC_SECRET`
- `FRONTEND_URL` → Vercel/custom SPA URL
- `CORS_ORIGIN` → same as FRONTEND_URL
- `NODE_ENV=production`

---

## Learning Kit

### Recommended Keywords
- "distributed tracing systems"
- "production observability architecture"
- "React operational dashboard patterns"
- "RBAC frontend enforcement"
- "failure-aware UI systems"
- "deployment health monitoring"

### Reading
- OpenTelemetry concepts (trace context propagation)
- RBAC design patterns (role hierarchy, permission matrices)
- Production observability systems (health checks, circuit breakers)
- Distributed tracing basics (trace_id, span, parent-child relationships)
- API contract verification concepts (contract testing, schema validation)

### LLM Learning Prompts
- "Teach me deterministic runtime proof systems."
- "Teach me operational observability for production dashboards."
- "Explain distributed tracing in ledger-backed systems."
- "Explain RBAC validation in financial applications."
