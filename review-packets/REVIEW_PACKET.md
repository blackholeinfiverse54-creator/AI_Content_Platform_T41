# REVIEW_PACKET.md — Phase 2 Frontend Intelligence Surface

**Submission:** Ashmit — Frontend Intelligence Surface  
**Date:** 29/05/2026  
**Folder:** `review-packets/REVIEW_PACKET.md`

---

## 1. ENTRY POINT

```
frontend/src/pages/dashboard/FinancialIntelligenceDashboard.jsx
```

Route: `/dashboard` (default after login)  
Auth: requires Bearer JWT — redirects to `/login` if unauthenticated

---

## 2. CORE EXECUTION FLOW (3 files)

```
FinancialIntelligenceDashboard.jsx
  │
  ├── useRuntimeMode.js          ← determines BACKEND_CONNECTED | DEGRADED | UNAVAILABLE | MOCK
  │     GET /health (5s timeout)
  │     GET /signals/snapshot (5s timeout)
  │
  ├── useSignals.js              ← fetches real signals, no silent mock
  │     Attempt 1: GET /api/v1/signals?limit=50
  │     Attempt 2: GET /api/v1/signals/snapshot
  │     On both fail: sets error state, renders SIGNAL FETCH FAILED banner
  │
  └── ComplianceVisibilityLayer.jsx
        GET /api/v1/gst/summary?period=YYYY-MM
        GET /api/v1/tds/dashboard?quarter=Qx&financialYear=FYxxxx-xx
```

---

## 3. LIVE FLOW (actual execution)

### Happy path — backend connected, signals exist

```
1. useRuntimeMode: GET /health → 200 OK
2. useRuntimeMode: GET /signals/snapshot → 200 OK
3. mode = BACKEND_CONNECTED
4. RuntimeModeBanner renders: "● LIVE BACKEND SIGNALS"
5. useSignals: GET /signals?limit=50 → returns ComplianceSignal[]
6. mapDbSignalToDisplay() maps each record to display shape
7. SignalStackPanel renders grouped by severity
8. ComplianceVisibilityLayer: GET /gst/summary → renders real GST metrics
9. ComplianceVisibilityLayer: GET /tds/dashboard → renders real TDS metrics
10. User clicks signal → SignalDetailEngine shows reason + recommendation
11. User clicks "Trace" → SignalTracePanel calls GET /signals/trace/:traceId
12. User clicks "SEND TO SETU" → GET /signals/:signalId/pipeline-check
    → renders SUCCESS with dispatched payload or FAILED with exact error
```

### Degraded path — health OK, signals endpoint fails

```
1. useRuntimeMode: GET /health → 200 OK
2. useRuntimeMode: GET /signals/snapshot → 500 or timeout
3. mode = BACKEND_DEGRADED
4. RuntimeModeBanner renders: "● SNAPSHOT FALLBACK ACTIVE"
5. useSignals: GET /signals → fails
6. useSignals: GET /signals/snapshot → fails
7. error state set → "SIGNAL FETCH FAILED" banner with exact URL + HTTP status
8. EmptySignalState renders with "Refresh" button
```

### Unavailable path

```
1. useRuntimeMode: GET /health → network error / timeout
2. mode = BACKEND_UNAVAILABLE
3. RuntimeModeBanner renders: "● BACKEND UNAVAILABLE"
4. BackendUnavailableState renders with "Retry Connection" button
5. No signals fetched. No mock data shown.
```

---

## 4. WHAT WAS BUILT

### Phase 1A — Backend Contract Verification
- `useSignals.js`: calls real `/api/v1/signals` then `/api/v1/signals/snapshot`
- `useComplianceSnapshot.js`: calls real `/api/v1/gst/summary` and `/api/v1/tds/dashboard`
- Raw payload exposed in "raw payload" details toggle on Cost Intelligence View
- Response schema mapped: DB ComplianceSignal shape → display shape via `mapDbSignalToDisplay()`

### Phase 1B — Production Mode Hardening
- `useRuntimeMode.js`: 4 explicit states — BACKEND_CONNECTED, BACKEND_DEGRADED, BACKEND_UNAVAILABLE, MOCK_MODE
- `RuntimeModeBanner.jsx`: always visible, colored dot + label, recheck button
- MOCK_MODE only activates when `VITE_MOCK_MODE=true` in `.env` — never silent
- No MOCK_SIGNALS array used in production flow

### Phase 1C — Signal Trace Proof
- `SignalTracePanel.jsx`: calls `GET /api/v1/signals/trace/:traceId`
- Shows 5-step chain: Signal → Validation → Filing → JournalEntries → LedgerEntries
- Each step collapsible with raw JSON
- Snapshot-derived signals (no trace_id) show explicit message: "snapshot-derived signal"

### Phase 2A — SETU Dispatch Runtime Proof
- `SignalDetailEngine.jsx`: real dispatch flow, not simulation
- Step 1: `GET /api/v1/signals/:signalId/pipeline-check` (dry-run validation)
- Step 2: surfaces pipeline result as proof of what would be sent
- 4 explicit dispatch states: IDLE → DISPATCHING → SUCCESS | FAILED | TIMEOUT
- SUCCESS: shows setu_signal_id + dispatched payload in collapsible
- FAILED: shows exact error message + HTTP status
- TIMEOUT: "SETU UNAVAILABLE — REQUEST TIMED OUT" with explanation
- Snapshot-derived signals: explicit error "no signal_id — cannot dispatch"

### Phase 2B — Compliance Visibility Layer
- `ComplianceVisibilityLayer.jsx`: real backend data only
- GST: output tax, input credit, net payable, CGST/SGST/IGST breakdown
- TDS: total deducted, pending payment, pending count, quarter/FY
- Filing readiness indicator derived from TDS status
- Risk surface: warns when GST net payable > ₹1L or TDS pending > ₹50K
- Error surface: shows exact backend error message when endpoint fails

### Phase 2C — Failure Simulation Matrix

| Failure | UI Behavior |
|---------|-------------|
| Backend unavailable | `BackendUnavailableState` — no crash, no mock, retry button |
| Empty signal list | `EmptySignalState` — explains how to generate signals, refresh button |
| Signal fetch error | Red banner with exact URL + HTTP status + message |
| GST endpoint fails | `ErrorSurface` in ComplianceVisibilityLayer with exact error |
| TDS endpoint fails | `ErrorSurface` in ComplianceVisibilityLayer with exact error |
| SETU pipeline fails | `DispatchResult FAILED` with exact error + HTTP status |
| SETU timeout | `DispatchResult TIMEOUT` — "SETU UNAVAILABLE" message |
| No trace_id on signal | SignalTracePanel: "snapshot-derived signal" message |
| Snapshot-derived SETU dispatch | Explicit error: "no signal_id — cannot dispatch" |

---

## 5. FAILURE CASES

### F1 — Backend not running
- `useRuntimeMode` GET /health fails with ECONNREFUSED
- `mode = BACKEND_UNAVAILABLE`
- Dashboard shows: WifiOff icon + "Backend Unavailable" + "Retry Connection" button
- No data fetched. No mock shown.

### F2 — Signals endpoint returns empty array
- `useSignals` GET /signals returns `{ data: [] }`
- Falls through to snapshot attempt
- If snapshot also empty: `signals = []`, `source = EMPTY`
- `EmptySignalState` renders — no crash

### F3 — Signal has invalid schema (missing severity)
- `mapDbSignalToDisplay()` defaults severity to 'LOW' if not in enum
- Signal still renders — no crash — but severity is visibly 'LOW'

### F4 — SETU pipeline-check returns validation error
- `DispatchResult FAILED` renders with `stage: VALIDATE` and error list
- Toast: "SETU pipeline failed: [error]"
- No fake success

### F5 — Compliance endpoints return 500
- `useComplianceSnapshot` catches error, sets `errors.gst` or `errors.tds`
- `ErrorSurface` renders with exact message
- Other compliance data still renders if available

---

## 6. PROOF

### New files created
| File | Purpose |
|------|---------|
| `frontend/src/hooks/useRuntimeMode.js` | Runtime mode detection |
| `frontend/src/hooks/useSignals.js` | Real signal fetching, no mock |
| `frontend/src/hooks/useComplianceSnapshot.js` | Real GST + TDS fetching |
| `frontend/src/components/intelligence/RuntimeModeBanner.jsx` | Visible mode declaration |
| `frontend/src/components/intelligence/SignalTracePanel.jsx` | 5-step trace reconstruction |
| `frontend/src/components/intelligence/ComplianceVisibilityLayer.jsx` | GST + TDS widgets |
| `frontend/src/components/intelligence/SignalDetailEngine.jsx` | SETU dispatch proof |
| `frontend/src/pages/dashboard/FinancialIntelligenceDashboard.jsx` | Full dashboard rewrite |

### API endpoints consumed
| Endpoint | Purpose | Phase |
|----------|---------|-------|
| `GET /health` | Runtime mode check | 1B |
| `GET /api/v1/signals?limit=50` | Live signal list | 1A |
| `GET /api/v1/signals/snapshot` | Ledger snapshot | 1A |
| `GET /api/v1/signals/trace/:traceId` | Chain reconstruction | 1C |
| `GET /api/v1/signals/:signalId/pipeline-check` | SETU dispatch proof | 2A |
| `GET /api/v1/gst/summary?period=YYYY-MM` | GST compliance | 2B |
| `GET /api/v1/tds/dashboard?quarter=Qx&financialYear=FYxx` | TDS compliance | 2B |

### SETU payload example (from pipeline-check response)
```json
{
  "signal_id": "SIG_FILING_NOT_READY",
  "trace_id": "TRC-20260529-a1b2c3d4",
  "source": {
    "system": "ARTHA",
    "module": "COMPLIANCE_FILING",
    "entity_type": "COMPLIANCE_FILING",
    "entity_id": "FIL-abc123"
  },
  "severity": "HIGH",
  "timestamp": "2026-05-29T10:00:00.000Z",
  "context": {
    "filing_id": "FIL-abc123",
    "filing_type": "GSTR-1",
    "error_count": 2
  },
  "recommendation": {
    "code": "RESOLVE_FILING_ERRORS",
    "message": "Compliance filing has validation errors and is not ready for submission."
  }
}
```

### Runtime mode states (visible in UI)
```
● LIVE BACKEND SIGNALS          — green dot, success colors
● SNAPSHOT FALLBACK ACTIVE      — amber dot, warning colors
● BACKEND UNAVAILABLE           — red dot, destructive colors
● MOCK DEVELOPMENT MODE         — purple dot, secondary colors
● CHECKING CONNECTION           — grey dot, pulsing
```

### Existing endpoints — unchanged
All pre-existing routes, controllers, services, and models are untouched.
Only frontend files were modified/created.
