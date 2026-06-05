# OPERATIONAL_HARDENING.md
# Phase 3 — Government-Style Operational Hardening
# ARTHA v0.1 | Operationally Governable

---

## Section 1 — RBAC Depth

### Role Definitions

| Role | Assigned at | Default for new signup |
|------|------------|----------------------|
| `admin` | Manual DB update or by existing admin | No |
| `accountant` | Manual DB update or by admin | No |
| `viewer` | Default on signup | Yes |

**Source:** `backend/src/models/User.js`
```js
role: { type: String, enum: ['admin', 'accountant', 'viewer'], default: 'viewer' }
```

**JWT payload carries role:**
```js
// backend/src/utils/authToken.js
roles: [user.role]
```

**Auth middleware reads roles from JWT (no DB lookup per request):**
```js
// backend/src/middleware/auth.js
req.user = {
  _id: decoded.user_id,
  roles: decoded.roles || [],
  role: decoded.roles?.[0] || 'user',
}
```

---

### Backend RBAC Enforcement

**`authorize()` middleware** blocks unauthorized roles with HTTP 403:

```js
// middleware/auth.js:authorize()
if (!hasRole) {
  return res.status(403).json({
    success: false,
    message: `Role '${req.user.role}' is not authorized to access this route`,
  });
}
```

#### Protected Routes by Role

| Endpoint | Required Role | Source |
|----------|--------------|--------|
| `POST /api/v1/ledger/entries` | accountant, admin | ledger.routes.js |
| `POST /api/v1/ledger/entries/:id/validate` | accountant, admin | ledger.routes.js |
| `POST /api/v1/ledger/entries/:id/post` | accountant, admin | ledger.routes.js |
| `POST /api/v1/ledger/entries/:id/void` | accountant, admin | ledger.routes.js |
| `GET /api/v1/ledger/verify-chain` | admin | ledger.routes.js |
| `GET /api/v1/ledger/verify` | admin | ledger.routes.js |
| `GET /api/v1/ledger/chain-stats` | admin | ledger.routes.js |
| `POST /api/v1/expenses/:id/approve` | accountant, admin | expense.routes.js |
| `POST /api/v1/expenses/:id/reject` | accountant, admin | expense.routes.js |
| `POST /api/v1/expenses/:id/record` | accountant, admin | expense.routes.js |
| `POST /api/v1/invoices/:id/send` | accountant, admin | invoice.routes.js |
| `POST /api/v1/tds/entries` | accountant, admin | tds.routes.js |
| `POST /api/v1/tds/entries/:id/deduct` | accountant, admin | tds.routes.js |
| `POST /api/v1/tds/entries/:id/challan` | accountant, admin | tds.routes.js |
| `POST /api/v1/signals/:id/dispatch` | admin, accountant | signal.routes.js |
| `GET /api/v1/signals/:id/pipeline-check` | admin, accountant | signal.routes.js |
| `GET /api/v1/gst/filing-packet/gstr-1` | accountant, admin | gst.routes.js |
| `GET /api/v1/gst/filing-packet/gstr-3b` | accountant, admin | gst.routes.js |
| `GET /api/v1/gst/filing-packet/export` | accountant, admin | gst.routes.js |

#### RBAC Proof — Unauthorized Behavior

**Scenario:** viewer tries to approve an expense

**Request:**
```
POST /api/v1/expenses/65a.../approve
Authorization: Bearer <viewer-token>
```

**Response (403):**
```json
{
  "success": false,
  "message": "Role 'viewer' is not authorized to access this route"
}
```

**Scenario:** unauthenticated request to any protected endpoint

**Response (401):**
```json
{
  "success": false,
  "message": "Not authenticated",
  "redirect": "http://localhost:5173/login"
}
```

**Scenario:** expired token

**Response (401):**
```json
{
  "success": false,
  "message": "Token is invalid or expired",
  "redirect": "http://localhost:5173/login"
}
```

---

### Frontend RBAC Enforcement

**`RoleProtectedRoute`** in `App.jsx`:
```jsx
const userRoles = user?.roles || [user?.role];
const hasAccess = allowedRoles.some(r => userRoles.includes(r));
if (!hasAccess) → "Access Denied" page (not silent redirect)
```

**Frontend role-protected routes:**

| Route | Required Roles |
|-------|---------------|
| `/invoices/new` | admin, accountant |
| `/invoices/:id/edit` | admin, accountant |
| `/expenses/new` | admin, accountant |
| `/expenses/approval` | admin, accountant |
| `/accounts` | admin, accountant |
| `/journal-entries` | admin, accountant |
| `/journal-entries/new` | admin, accountant |
| `/ledger-integrity` | admin, accountant |
| `/signals` | admin, accountant |
| `/statements/upload` | admin, accountant |
| `/settings/company` | admin |
| `/settings/users` | admin |

**Sidebar filtering** (`Sidebar.jsx`):
```js
const filteredMenuItems = menuItems.filter(hasAccess).map(item => {
  if (item.children) return { ...item, children: item.children.filter(hasAccess) };
  return item;
});
```
Viewers cannot see Signals, Ledger, or Settings menu items.

---

## Section 2 — Audit Visibility

### AuditLog Model

**Source:** `backend/src/models/AuditLog.js`

Every write action goes through `auditLogger()` middleware which captures:

| Field | What It Records |
|-------|----------------|
| `action` | e.g., `expense.approved`, `journal_entry.posted` |
| `entityType` | e.g., `Expense`, `JournalEntry` |
| `entityId` | MongoDB `_id` of the affected document |
| `userId` | Who performed the action (`req.user._id`) |
| `ipAddress` | Client IP (via `req.ip`) |
| `userAgent` | Browser/client user agent |
| `changes` | `req.body` at time of action |
| `metadata.method` | HTTP method |
| `metadata.path` | Request path |
| `metadata.statusCode` | Response status |
| `timestamp` | Immutable — set on creation, cannot be changed |

**Immutability enforced:**
```js
auditLogSchema.pre('save', function(next) {
  if (!this.isNew) return next(new Error('Audit logs cannot be modified'));
  next();
});
```

### Audit Actions Recorded

| Action | Trigger |
|--------|---------|
| `expense.created` | `POST /expenses` |
| `expense.updated` | `PUT /expenses/:id` |
| `expense.approved` | `POST /expenses/:id/approve` |
| `expense.rejected` | `POST /expenses/:id/reject` |
| `expense.recorded` | `POST /expenses/:id/record` |
| `journal_entry.created` | `POST /ledger/entries` |
| `journal_entry.validated` | `POST /ledger/entries/:id/validate` |
| `journal_entry.posted` | `POST /ledger/entries/:id/post` |
| `journal_entry.voided` | `POST /ledger/entries/:id/void` |
| `journal_entry.reversed` | `POST /ledger/entries/:id/reversal` |
| `journal_entry.credit_note_created` | `POST /ledger/credit-notes` |
| `journal_entry.debit_note_created` | `POST /ledger/debit-notes` |
| `tds.entry_created` | `POST /tds/entries` |
| `tds.deduction_recorded` | `POST /tds/entries/:id/deduct` |
| `tds.challan_recorded` | `POST /tds/entries/:id/challan` |
| `gst.gstr1_generated` | `POST /gst/gstr1/generate` |
| `gst.gstr3b_generated` | `POST /gst/gstr3b/generate` |
| `gst.return_filed` | `POST /gst/returns/:id/file` |

### Sample AuditLog Document

```json
{
  "_id": "65e5f6a7b8c9d0e1f2a3b4c5",
  "action": "expense.approved",
  "entityType": "Expense",
  "entityId": "65a1b2c3d4e5f6a7b8c9d0e1",
  "userId": "65b2c3d4e5f6a7b8c9d0e1f2",
  "ipAddress": "127.0.0.1",
  "userAgent": "Mozilla/5.0 ...",
  "changes": {},
  "metadata": {
    "method": "POST",
    "path": "/65a1b2c3d4e5f6a7b8c9d0e1/approve",
    "statusCode": 200
  },
  "timestamp": "2025-01-15T06:32:00.000Z"
}
```

### JournalEntry Audit Trail

Every journal entry also carries an internal `auditTrail[]` array (in addition to AuditLog):

```json
{
  "auditTrail": [
    {
      "action": "ENTRY_CREATED",
      "entity_id": "65c3d4e5...",
      "before_state": null,
      "after_state": { "status": "DRAFT", ... },
      "action_user": "65b2c3d4...",
      "timestamp": "2025-01-15T06:32:00.000Z",
      "trace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    },
    {
      "action": "VALIDATED",
      "entity_id": "65c3d4e5...",
      "before_state": { "status": "DRAFT" },
      "after_state": { "status": "VALIDATED", "validation": { "balanced": true } },
      "action_user": "65b2c3d4...",
      "timestamp": "2025-01-15T06:32:00.500Z",
      "trace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    },
    {
      "action": "POSTED",
      "entity_id": "65c3d4e5...",
      "before_state": { "status": "VALIDATED" },
      "after_state": { "status": "POSTED", "posting": { "hash": "...", "ledgerEntriesCreated": 4 } },
      "action_user": "65b2c3d4...",
      "timestamp": "2025-01-15T06:32:01.000Z",
      "trace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
  ]
}
```

**Visibility: who, what, when, where, trace linkage:**
- **Who:** `action_user` = userId
- **What:** `action` = ENTRY_CREATED / VALIDATED / POSTED / VOIDED
- **When:** `timestamp` = ISO string
- **Where:** `entity_id` + `trace_id` = full context
- **Trace linkage:** `trace_id` matches `JournalEntry.trace_id`

---

## Section 3 — Deployment Modes

### Mode 1 — Live Backend (BACKEND_CONNECTED)

**Trigger:** `GET /health` → 200 + `GET /api/v1/signals/snapshot` → 200 or 401

**State:**
- All endpoints active
- Real data from MongoDB Atlas
- Signals generated and persisted
- SETU dispatch attempted (or payload proof if disabled)

**Banner:** `● LIVE BACKEND SIGNALS` (green)

**Verification:**
```bash
curl http://localhost:5000/health
# → {"success":true,"message":"ARTHA API is running",...}
```

---

### Mode 2 — Degraded Backend (BACKEND_DEGRADED)

**Trigger:** `GET /health` → 200 but `GET /api/v1/signals/snapshot` → 500/503

**State:**
- Health endpoint works
- Signal/compliance endpoints failing
- All non-intelligence pages still function (invoices, expenses, reports, GST, TDS)
- Dashboard shows error banner

**Banner:** `● SNAPSHOT FALLBACK ACTIVE` (amber)

**UI behavior:** "SIGNAL FETCH FAILED" red card with exact URL + HTTP status. Refresh button available.

---

### Mode 3 — Backend Unavailable (BACKEND_UNAVAILABLE)

**Trigger:** `GET /health` → ECONNREFUSED / timeout / 5xx

**State:**
- Backend process down
- All API calls will fail
- UI renders full-page unavailable state

**Banner:** `● BACKEND UNAVAILABLE` (red)

**UI behavior:** WifiOff icon + "Cannot reach the Artha API" + "Retry Connection" button

**NO mock data shown. NO crash.**

---

### Mode 4 — Mock Mode (MOCK_MODE)

**Trigger:** `VITE_MOCK_MODE=true` in `frontend/.env`

**State:**
- No network calls made
- No data of any kind shown
- Purely for front-end development without backend

**Banner:** `● MOCK DEVELOPMENT MODE` (purple)

**Hard rule:** This mode is ONLY active with the explicit env flag. Network failure → BACKEND_UNAVAILABLE, not mock.

---

## Section 4 — Monitoring / Observability

### Runtime Mode (always visible)

`RuntimeModeBanner` is rendered at the top of every intelligence page. It is never hidden, never conditional on data availability. It shows:
- Current mode (CHECKING / CONNECTED / DEGRADED / UNAVAILABLE / MOCK)
- Last checked timestamp
- Recheck button

### Health State

```
GET /health          → basic liveness (public)
GET /health/detailed → component health (public)
GET /status          → DB + Redis (public)
GET /api/v1/runtime/status → full operational state (auth required)
```

### Backend Availability

`useRuntimeMode.check()` runs on every app boot and on manual recheck:
1. `GET /health` (5s timeout, no auth)
2. `GET /api/v1/signals/snapshot` (5s timeout, with auth)

Result sets `mode` state globally.

### Dispatch Status

`SignalDetailEngine` maintains 5 dispatch states per session:
- `IDLE` — no dispatch attempted
- `DISPATCHING` — in flight
- `SUCCESS` — pipeline complete (with or without SETU)
- `FAILED` — pipeline or SETU error
- `TIMEOUT` — SETU did not respond

Each state renders a distinct UI element. No silent state changes.

### Compliance Status

`ComplianceVisibilityLayer` shows live GST + TDS state from real backend endpoints. Both have independent error surfaces — one can fail without affecting the other.

---

## Section 5 — Failure Surfaces

### F-01: Timeout (API call)

| Field | Detail |
|-------|--------|
| Scenario | Any API call exceeds response time |
| Trigger | `axios` timeout (default varies by call; SETU = 5000ms, health = 5000ms) |
| Backend behavior | N/A — server still processing |
| UI behavior | `api.js` interceptor: for SETU dispatch → TIMEOUT state. For health → BACKEND_UNAVAILABLE mode. For other calls → generic error toast. |
| Recovery | Retry the operation. Check backend performance. |

---

### F-02: HTTP 502 (SETU unreachable)

| Field | Detail |
|-------|--------|
| Scenario | SETU endpoint configured but not reachable |
| Trigger | `SETU_ENABLED=true`, `SETU_BASE_URL` pointing to offline server |
| Backend behavior | `axios.post()` throws ECONNREFUSED/ENOTFOUND. Returns HTTP 502 with `failure_reason: SETU_UNREACHABLE` |
| UI behavior | `FAILED` dispatch state: "SETU DISPATCH FAILED — SETU_UNREACHABLE: connect ECONNREFUSED..." + payload shown |
| Recovery | Set `SETU_ENABLED=false` to return to payload-proof mode. Or fix `SETU_BASE_URL`. |

---

### F-03: HTTP 500 (Server error)

| Field | Detail |
|-------|--------|
| Scenario | Unhandled exception in backend controller |
| Trigger | DB query error, Mongoose validation error, unhandled promise rejection |
| Backend behavior | Global error handler: `res.status(err.statusCode || 500).json({ success: false, message: err.message })` |
| UI behavior | `api.js` interceptor: `status >= 500` → toast "Server error. Please try again later." (non-auth URLs). Auth URLs: show actual message. |
| Recovery | Check backend logs: `cat backend/logs/combined.log | tail -50` |

---

### F-04: Empty Payloads (no signals)

| Field | Detail |
|-------|--------|
| Scenario | `/api/v1/signals` returns `{ data: [], pagination: { total: 0 } }` |
| Trigger | Fresh database or no compliance events yet |
| Backend behavior | MongoDB `find()` returns empty array. HTTP 200. |
| UI behavior | `useSignals` falls through to snapshot fallback. If snapshot also empty: `EmptySignalState` renders "No signals in database yet. Create invoices, expenses, or run compliance filings." |
| Recovery | Create + approve an expense. Hit `GET /api/v1/signals/snapshot`. Evaluate overdue invoices via `POST /api/v1/signals/evaluate/overdue-invoices`. |

---

### F-05: Schema Mismatch (signal missing fields)

| Field | Detail |
|-------|--------|
| Scenario | A signal in DB has missing/invalid `signal_id`, `source.module`, or `source.entity_type` |
| Trigger | Manual DB edit, or signal emitted with non-standard values |
| Backend behavior | `normalizeSignal()` may succeed (defaults applied). `validateSignal()` returns errors. Pipeline returns `{ ok: false, stage: 'VALIDATE', error: "source.module UNKNOWN is not recognized" }` |
| UI behavior | `pipelineCheck` or `dispatchSignal` returns 422. SignalDetailEngine renders `FAILED` state with exact pipeline error and stage. Signal still renders in list (it's in DB). |
| Recovery | Use pipeline-check to identify exact field. Fix or re-emit the signal. |

---

### F-06: SETU Unavailable (configured but down)

| Field | Detail |
|-------|--------|
| Scenario | `SETU_ENABLED=true`, SETU endpoint offline |
| Trigger | Network partition, SETU deployment issue |
| Backend behavior | `axios.post()` throws. Returns HTTP 502 with `failure_reason: SETU_UNREACHABLE`. Full pipeline payload still returned. |
| UI behavior | `FAILED` state. "SETU DISPATCH FAILED — SETU_UNREACHABLE". Payload shown in collapsible. |
| Recovery | Signal is persisted locally. Retry dispatch when SETU is back. |

---

### F-07: Partial Runtime Degradation

| Field | Detail |
|-------|--------|
| Scenario | MongoDB connected but Redis down; or signals endpoint failing but invoices/expenses working |
| Trigger | Redis pod restart; signals controller DB query error |
| Backend behavior | Redis failure: cache reads return null, operations continue without cache. Signal endpoint failure: 500 on `/signals`. Other endpoints unaffected. |
| UI behavior | Runtime mode → BACKEND_DEGRADED (amber). Non-intelligence pages work normally. Dashboard shows "SIGNAL FETCH FAILED" but invoices, expenses, reports, GST, TDS all function. |
| Recovery | Redis: restart Redis. Signal endpoint: fix underlying DB/query issue. No data loss. |

---

### F-08: F-10 Auto-Record Silent Failure (FIXED)

| Field | Detail |
|-------|--------|
| Scenario | Expense approved but auto-record fails (e.g., CompanySettings missing) |
| **Previous behavior (bug)** | Silently swallowed, expense stays `approved`, no user feedback |
| **Fixed behavior** | Approval response includes `warnings: ["Auto-record failed: <reason>. Call POST /expenses/:id/record to retry..."]` |
| Recovery | Fix CompanySettings, then `POST /api/v1/expenses/:id/record` directly. |

---

## Operational Checklist

```
□ RBAC tested: admin / accountant / viewer / unauthenticated — all return correct HTTP codes
□ Audit logs created for every write operation
□ JournalEntry.auditTrail populated with CREATED → VALIDATED → POSTED steps
□ RuntimeModeBanner visible on all intelligence pages
□ All 4 runtime modes reachable and tested
□ SETU pipeline-check passes for all signals in DB
□ Ledger chain verification returns isValid: true
□ No static/hardcoded data in any production code path
□ F-10 auto-record failure surfaces in approval response
□ GET /api/v1/runtime/status returns operational state in < 200ms
```
