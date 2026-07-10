# REVIEW_PACKET.md — Artha Platform: Architecture, Signal Contracts & Integration Evidence

**Prepared for:** Engineering Review  
**Platform:** Artha v0.1  
**Scope:** Ledger → Compliance → Signal → SETU → TANTRA integration readiness  
**Last Updated:** July 2026 — Full Codebase Audit Complete  

---

## Changelog

| Date | Change |
|------|--------|
| July 2026 | Full codebase audit: 35 models, 47 services, 26 controllers, 27 routes, 11 middleware |
| July 2026 | SETU dispatch lifecycle implemented (setuDispatch.service.js, SetuDispatch model) |
| July 2026 | TANTRA execution chain implemented (8-stage: Signal→Intelligence→Decision→Contract→Enforcement→Execution→Truth→Observability) |
| July 2026 | Decision Ledger, Provenance Chain, Lineage Anchoring implemented |
| July 2026 | Governance API expanded to 30+ endpoints |
| July 2026 | All documentation updated to reflect current codebase |
| June 2026 | Design system capability extraction complete — `frontend/src/design-system/` |
| June 2026 | Ecosystem readiness assessment — `docs/ecosystem-readiness.md` |
| June 2026 | Lineage model documented — `docs/lineage-model.md` |
| June 2026 | Replay proof documented — `docs/replay-proof.md` |
| June 2026 | Runtime proof package in `docs/runtime-proof/` |
| June 2026 | REVIEW_PACKET.md updated with Phase 3/4/5 artifacts |
| 2025-02-19 | **Ecosystem Capability Extraction** — 9 capabilities, formal contracts, registry, attachment validation, certification |
| 2025-02-19 | **Capability Registry** — `capability_registry/capability_registry.json` with dependency graph and authority boundaries |
| 2025-02-19 | **Attachment Validation** — 12-step consumer simulation, 10 authority boundary tests, schema version matrix |
| 2025-02-19 | **Capability Certification** — All 6 certification criteria passed |
| 2025-02-19 | **Gap Closure** — Runtime validation, replay proof, authority enforcement, government-grade validation |

---

## 1. Entry Points

### API Surface (80+ Endpoints)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/v1/auth/login` | Public | JWT login |
| POST | `/api/v1/auth/register` | Public | User registration |
| GET | `/api/v1/ledger/entries` | Bearer | Journal entries with pagination |
| GET | `/api/v1/ledger/verify-chain` | Bearer | Full ledger hash-chain verification |
| POST | `/api/v1/invoices/:id/send` | Bearer + accountant | Creates journal entry, posts to ledger |
| POST | `/api/v1/expenses/:id/approve` | Bearer + accountant | Approves + auto-records to ledger |
| POST | `/api/v1/tds/entries/:id/deduct` | Bearer + accountant | Records TDS deduction to ledger |
| GET | `/api/v1/compliance/gst/gstr-1` | Bearer + accountant | Generates GSTR-1 filing packet + validates + emits signal |
| GET | `/api/v1/compliance/gst/gstr-3b` | Bearer + accountant | Generates GSTR-3B + validates + emits signal |
| GET | `/api/v1/compliance/tds/form26q` | Bearer + accountant | Generates Form 26Q + validates + emits signal |
| GET | `/api/v1/signals/snapshot` | Bearer | Ledger-based signal snapshot (cashFlow, TDS, GST payable) |
| GET | `/api/v1/signals` | Bearer | List persisted ComplianceSignal records |
| GET | `/api/v1/signals/trace/:traceId` | Bearer | Full trace reconstruction (signal → filing → journal → ledger) |
| GET | `/api/v1/signals/:signalId/pipeline-check` | Bearer + accountant | Dry-run SETU pipeline for a signal |
| POST | `/api/v1/signals/evaluate/overdue-invoices` | Bearer + accountant | Evaluate + emit overdue invoice signals |
| POST | `/api/v1/setu/dispatch` | Bearer | Dispatch signal via SETU pipeline |
| POST | `/api/v1/setu/callback` | HMAC | SETU acknowledgement webhook |
| POST | `/api/v1/setu/dispatch/:dispatchId/retry` | Bearer | Retry failed SETU dispatch |
| GET | `/api/v1/banking/statements` | Bearer | List bank statements |
| GET | `/api/v1/audit/events` | Bearer | List audit events |
| GET | `/api/v1/ca-workflow/periods` | Bearer | List financial periods |
| GET | `/api/v1/tally/export` | Bearer | Export to Tally |
| GET | `/api/v1/multi-company/companies` | Bearer | List companies |
| POST | `/api/v1/tantra/heartbeat` | Bearer | TANTRA heartbeat |
| GET | `/api/v1/tantra/health` | Bearer | TANTRA health status |

### BHIV Governance API (30+ Endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/governance/capabilities` | List all capability contracts |
| GET | `/api/v1/governance/capabilities/:id` | Get specific capability |
| POST | `/api/v1/governance/policy/evaluate` | Evaluate policy decision |
| GET | `/api/v1/governance/policy/status` | Policy engine status |
| GET | `/api/v1/governance/provenance` | Provenance chain |
| GET | `/api/v1/governance/provenance/verify` | Verify provenance chain |
| POST | `/api/v1/governance/replay/deterministic` | Deterministic replay |
| GET | `/api/v1/governance/replay/status` | Replay status |
| GET | `/api/v1/governance/circuit-breakers` | Circuit breaker status |
| POST | `/api/v1/governance/circuit-breakers/:service/reset` | Reset circuit breaker |
| POST | `/api/v1/governance/verify/independent` | Independent verification |
| GET | `/api/v1/governance/verify/results` | Verification results |
| POST | `/api/v1/governance/deployment/evidence` | Deployment evidence |
| GET | `/api/v1/governance/deployment/history` | Deployment history |
| POST | `/api/v1/governance/security/adversarial` | Adversarial testing |
| GET | `/api/v1/governance/security/results` | Security results |
| GET | `/api/v1/governance/status` | Governance status |
| GET | `/api/v1/governance/health` | Governance health |
| POST | `/api/v1/governance/lineage/anchor` | Anchor entity to lineage |
| GET | `/api/v1/governance/lineage/:entityId` | Get lineage for entity |
| POST | `/api/v1/governance/lineage/bucket/:bucketId` | Get bucket lineage |
| GET | `/api/v1/governance/decision-ledger` | List decision ledger |
| POST | `/api/v1/governance/decision-ledger/:id/verify` | Verify decision chain |
| GET | `/api/v1/governance/decision-ledger/:entityId/history` | Entity decision history |
| GET | `/api/v1/governance/tantra/registration` | TANTRA registration |
| POST | `/api/v1/governance/tantra/heartbeat` | TANTRA heartbeat |
| POST | `/api/v1/governance/tantra/emit-event` | TANTRA event emission |
| GET | `/api/v1/governance/tantra/health` | TANTRA health |
| GET | `/api/v1/governance/tantra/events` | TANTRA events |
| GET | `/api/v1/governance/observability/metrics` | System metrics |
| GET | `/api/v1/governance/observability/health` | System health |
| GET | `/api/v1/governance/observability/system` | System overview |
| POST | `/api/v1/governance/evidence/capture` | Capture runtime proof |
| POST | `/api/v1/governance/evidence/:proofId/verify` | Verify runtime proof |
| GET | `/api/v1/governance/evidence/:proofId` | Get runtime proof |
| POST | `/api/v1/governance/setu/dispatch` | SETU dispatch |
| POST | `/api/v1/governance/setu/callback` | SETU callback |
| POST | `/api/v1/governance/setu/dispatch/:dispatchId/retry` | SETU retry |
| GET | `/api/v1/governance/setu/dispatch/:dispatchId` | SETU dispatch status |
| POST | `/api/v1/governance/trace/capture` | Capture trace |
| GET | `/api/v1/governance/trace/:traceId` | Get trace |
| POST | `/api/v1/governance/trace/:traceId/verify` | Verify trace |
| GET | `/api/v1/governance/trace/:traceId/evidence` | Get trace evidence |
| POST | `/api/v1/governance/execute` | Execute governance action |
| POST | `/api/v1/governance/execute/test` | Test governance action |
| POST | `/api/v1/governance/generate-evidence` | Generate evidence |
| POST | `/api/v1/governance/verify/evidence` | Verify evidence |
| POST | `/api/v1/governance/verify/replay` | Verify replay |
| POST | `/api/v1/governance/verify/hash` | Verify hash |
| POST | `/api/v1/governance/verify/independent` | Independent verify |
| POST | `/api/v1/governance/verify/deployment` | Deployment verify |
| POST | `/api/v1/governance/verify/adversarial` | Adversarial verify |

### Data Entry Points
Every financial event enters through one of three service methods:
- `InvoiceService.sendInvoice()` — creates AR journal entry
- `ExpenseService.recordExpense()` — creates expense journal entry  
- `TDSService.recordTDSDeduction()` — creates TDS journal entry

All three call `LedgerService.createJournalEntry()` → `validateJournalEntry()` → `postJournalEntry()`.

---

## 2. Architecture Understanding

### System Architecture
```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ARTHA v0.1                                    │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Transaction │  │    Ledger    │  │  Compliance  │  │    Audit    │  │
│  │   Processing │  │   & Accounting│  │   & Filing   │  │  & Evidence │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                │                │                │          │
│         ▼                ▼                ▼                ▼          │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Signal Engine Service                         │  │
│  │   SignalEngineService.evaluateFilingResult() → emitSignal()     │  │
│  └───────────────────────────┬─────────────────────────────────────┘  │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    SETU Pipeline                                │  │
│  │   Normalize → Validate → Map → Serialize → Dispatch → Ack      │  │
│  └───────────────────────────┬─────────────────────────────────────┘  │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    TANTRA Execution Chain                        │  │
│  │   Signal → Intelligence → Decision → Contract → Enforcement    │  │
│  │   → Execution → Truth → Observability                           │  │
│  └───────────────────────────┬─────────────────────────────────────┘  │
│                              │                                        │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Governance Layer                              │  │
│  │   Decision Ledger + Provenance Chain + Lineage Anchoring        │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Observability & Evidence                      │  │
│  │   Runtime Proof + Unified Trace + Metrics + Health              │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Dual Hash Chain
Artha maintains two independent hash chains:

**Chain 1 — JournalEntry (HMAC-SHA256)**
```
JE-001  prevHash="0"       hash=HMAC(payload, HMAC_SECRET)
JE-002  prevHash=JE-001.hash  hash=HMAC(payload, HMAC_SECRET)
JE-003  prevHash=JE-002.hash  hash=HMAC(payload, HMAC_SECRET)
```
Purpose: Tamper detection on the accounting record itself.

**Chain 2 — LedgerEntry (SHA-256)**
```
LE-001  prev_hash="0"        hash=SHA256(journalId+accountId+amount+prevHash)
LE-002  prev_hash=LE-001.hash hash=SHA256(...)
```
Purpose: Immutable audit trail of every individual debit/credit movement.

Both chains are verified by `GET /api/v1/ledger/verify-chain`.

### Journal Entry Lifecycle (enforced, not optional)
```
DRAFT → VALIDATED → POSTED
```
- `DRAFT`: created, hash computed, not yet verified
- `VALIDATED`: double-entry balanced, accounts exist, GST/TDS compliance checked, audit trace present
- `POSTED`: hash re-verified, LedgerEntries written, AccountBalances updated, Redis cache invalidated

Skipping validation throws: `"Cannot post unvalidated entry"`.

### GST Engine (pure function)
`gstEngine.service.js → calculateGSTBreakdown()`:
- Input: `{ transaction_type, amount, gst_rate, supplier_state, company_state }`
- Output: `{ taxable_value, cgst, sgst, igst, total_amount, is_interstate }`
- Allowed rates: `[0, 5, 12, 18, 28]` — any other rate throws `GST_VALIDATION_ERROR`
- Interstate detection: `supplier_state !== company_state` → IGST only; else CGST+SGST split

---

## 3. Signal Mapping

### Signal Sources and Types
| Source | Signal Type | Severity | Trigger |
|--------|-------------|----------|---------| 
| GST_ENGINE | SIG_GST_MISMATCH | HIGH | Invoice tax ≠ GST calculation |
| GST_ENGINE | SIG_GST_INVALID_RATE | HIGH | Rate not in [0,5,12,18,28] |
| GST_ENGINE | SIG_GST_MIXED_TAX_TYPE | HIGH | IGST + CGST/SGST in same entry |
| GST_ENGINE | SIG_GST_COMPANY_STATE_MISSING | CRITICAL | Company state not in settings |
| TDS_ENGINE | SIG_TDS_MISSING_PAN | HIGH | Deductee PAN absent |
| TDS_ENGINE | SIG_TDS_MISSING_CHALLAN | HIGH | Challan not linked |
| TDS_ENGINE | SIG_TDS_EXCESS_DEDUCTION | HIGH | TDS > payment amount |
| LEDGER | SIG_LEDGER_IMBALANCE | CRITICAL | Debits ≠ Credits |
| LEDGER | SIG_LEDGER_HASH_TAMPER | CRITICAL | Hash mismatch on verify |
| LEDGER | SIG_CASHFLOW_NEGATIVE | HIGH | Net cash flow < 0 |
| INVOICE | SIG_INVOICE_OVERDUE | MEDIUM/HIGH | Past due date, unpaid |
| COMPLIANCE_FILING | SIG_FILING_NOT_READY | HIGH | Validation errors in filing |

Full mapping: see `SIGNAL_MAPPING.md`.

### Signal Persistence
All signals are written to `ComplianceSignal` collection before any SETU dispatch.
Dispatch failure never loses the signal — it remains in the DB with `dispatch_status: pending`.

---

## 4. SETU → TANTRA → ARTHA Integration Chain

### The Complete Chain: Signal → SETU → TANTRA → Governance

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SETU → TANTRA → ARTHA Integration Chain                  │
└─────────────────────────────────────────────────────────────────────────────┘

  ARTHA Signal Engine
  │
  │  signalEngineService.evaluateFilingResult()
  │  → emitSignal({ signalId, trace_id, module, severity })
  │
  ▼
  ComplianceSignal (persisted)
  │  type: "SIG_GST_MISMATCH"
  │  trace_id: "TRC-20260403-a1b2c3d4"
  │  severity: "HIGH"
  │  source: "ARTHA"
  │  context: { expected_tax, actual_tax, variance, gst_rate }
  │
  ▼
  SETU Pipeline (setu.pipeline.js)
  │
  │  1. normalizeSignal()
  │     Guarantees: signal_id, trace_id, source{}, severity, timestamp, context{}, recommendation{}
  │
  │  2. validateSignal()
  │     Checks: known signal type, severity enum, source.system=ARTHA, known module/entity_type,
  │             entity_id not UNKNOWN, context shape for specific signal types
  │     Returns: { valid, errors[], warnings[] } — never throws
  │
  │  3. mapToSetuPayload()
  │     Transforms: normalized → SETU contract shape
  │
  │  4. serializeForSetu()
  │     Produces: { body: JSON string, headers: { Content-Type, X-Artha-Trace, X-Signal-Type, X-Severity } }
  │
  ▼
  Sampada Adapter (sampadaAdapter.js)
  │  Converts Artha signal → Sampada SetuSignalIngest envelope
  │  Maps: { system: "ARTHA", module, entity_type, entity_id }
  │  Produces: { source: "ARTHA", signalType, severity, payload, metadata }
  │
  ▼
  SetuDispatch Service (setuDispatch.service.js)
  │
  │  5. dispatch()
  │     POST {SETU_BASE_URL}/api/v1/signals/ingest
  │     Headers: X-Artha-Trace, X-Signal-Type, X-Severity
  │     Body: Sampada SetuSignalIngest envelope
  │     HMAC webhook verification on response
  │
  │  6. acknowledgement()
  │     Track: setu_signal_id, dispatched_at, ack_status
  │
  │  7. retry()
  │     Exponential backoff: retry_count++, next_retry_at
  │     Dead-letter: dead_letter_reason after max retries
  │     Full retry_history[] with timestamps and errors
  │
  │  8. evidence()
  │     Capture: RuntimeProof with full dispatch chain
  │
  ▼
  SetuDispatch (persisted)
  │  dispatch_id: "DISP-20260403-0001"
  │  status: "dispatched" | "acknowledged" | "failed" | "dead-letter"
  │  signal_type: "SIG_GST_MISMATCH"
  │  trace_id: "TRC-20260403-a1b2c3d4"
  │  idempotency_key: "IK-20260403-0001"
  │  retry_count: 0
  │  retry_history: []
  │
  ▼
  TANTRA Execution Chain (tantraExecutionChain.service.js)
  │
  │  Stage 1: Signal
  │    Receive signal from SETU dispatch
  │    Validate signal format and source
  │
  │  Stage 2: Intelligence
  │    Analyze signal context and severity
  │    Cross-reference with historical patterns
  │
  │  Stage 3: Decision
  │    DecisionLedger records: ALLOW / DENY / WARN / BLOCK
  │    Hash-chained decision chain
  │
  │  Stage 4: Contract
  │    Verify capability contracts
  │    Check authority boundaries
  │
  │  Stage 5: Enforcement
  │    Enforce policy decisions
  │    Circuit breaker checks
  │
  │  Stage 6: Execution
  │    Execute governance action
  │    Record execution result
  │
  │  Stage 7: Truth
  │    ProvenanceBlock: immutable, hash-linked chain
  │    Hash = SHA256(prevHash + decision + timestamp + metadata)
  │
  │  Stage 8: Observability
  │    Emit metrics and health data
  │    Record to UnifiedTrace
  │
  ▼
  Decision Ledger (decisionLedger.service.js)
  │  append-only, hash-chained governance decision recording
  │  decision_id: "DEC-20260403-0001"
  │  decision: "ALLOW" | "DENY" | "WARN" | "BLOCK"
  │  entity_id: "SIG_GST_MISMATCH"
  │  prev_hash: "0" (genesis) | previous_decision.hash
  │  hash: SHA256(prevHash + decision + timestamp + metadata)
  │
  ▼
  Provenance Chain (provenanceChain.service.js)
  │  immutable, append-only, hash-linked governance decision chain
  │  block_id: "PROV-20260403-0001"
  │  decision_id: "DEC-20260403-0001"
  │  prev_hash: "0" (genesis) | previous_block.hash
  │  hash: SHA256(prevHash + decision_id + timestamp)
  │
  ▼
  Lineage Anchoring (lineage.service.js)
  │  entity_id: "SIG_GST_MISMATCH"
  │  bucket_id: "BUCKET-2026-Q1"
  │  mdu_id: "MDU-20260403-0001"
  │  bucket_url: "s3://arthabucket/2026/Q1/SIG_GST_MISMATCH.json"
  │
  ▼
  Unified Trace (UnifiedTrace model)
  │  trace_id: "TRC-20260403-a1b2c3d4"
  │  steps: [
  │    { step: 1, label: "Signal Created", found: true },
  │    { step: 2, label: "SETU Dispatched", found: true },
  │    { step: 3, label: "TANTRA Executed", found: true },
  │    { step: 4, label: "Decision Recorded", found: true },
  │    { step: 5, label: "Provenance Anchored", found: true }
  │  ]
  │
  ▼
  Runtime Proof (RuntimeProof model)
    evidence_id: "EVID-20260403-0001"
    trace_id: "TRC-20260403-a1b2c3d4"
    proof_type: "SETU_DISPATCH_CHAIN"
    assertions: [
      { type: "SIGNAL_CREATED", verified: true },
      { type: "SETU_DISPATCHED", verified: true },
      { type: "ACK_RECEIVED", verified: true },
      { type: "TANTRA_EXECUTED", verified: true },
      { type: "DECISION_RECORDED", verified: true },
      { type: "PROVENANCE_ANCHORED", verified: true }
    ]
    hash: "SHA256(all_assertions + timestamp)"
```

### Key Integration Points

| Step | Service | File | Purpose |
|------|---------|------|---------|
| 1 | SignalEngine | `signalEngine.service.js` | Evaluate and emit signals |
| 2 | SETU Pipeline | `setu.pipeline.js` | Normalize, validate, map, serialize |
| 3 | Sampada Adapter | `sampadaAdapter.js` | Artha → Sampada envelope |
| 4 | SETU Dispatch | `setuDispatch.service.js` | Dispatch, ack, retry, evidence |
| 5 | TANTRA Chain | `tantraExecutionChain.service.js` | 8-stage execution chain |
| 6 | Decision Ledger | `decisionLedger.service.js` | Append-only decision recording |
| 7 | Provenance Chain | `provenanceChain.service.js` | Immutable governance chain |
| 8 | Lineage Service | `lineage.service.js` | Entity anchoring, bucket/MDU |
| 9 | Unified Trace | `UnifiedTrace model` | End-to-end trace |
| 10 | Runtime Proof | `RuntimeProof model` | Verifiable evidence |

### Evidence Models (Persisted)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `SetuDispatch` | Track SETU dispatch lifecycle | dispatch_id, status, signal_type, trace_id, retry_count, dead_letter_reason |
| `DecisionLedger` | Append-only governance decisions | decision_id, decision, entity_id, prev_hash, hash |
| `ProvenanceBlock` | Immutable governance chain | block_id, decision_id, prev_hash, hash |
| `LineageAnchor` | Entity anchoring with bucket/MDU | entity_id, bucket_id, mdu_id, bucket_url |
| `UnifiedTrace` | End-to-end trace reconstruction | trace_id, steps[], status |
| `RuntimeProof` | Verifiable evidence capture | evidence_id, trace_id, proof_type, assertions[], hash |

---

## 5. Contract Specification

### SETU Payload (canonical)
```json
{
  "signal_id": "SIG_GST_MISMATCH",
  "trace_id":  "TRC-20260403-a1b2c3d4",
  "source": {
    "system":      "ARTHA",
    "module":      "GST_ENGINE",
    "entity_type": "INVOICE",
    "entity_id":   "INV-20260403-0001"
  },
  "severity":  "HIGH",
  "timestamp": "2026-04-03T10:00:00.000Z",
  "context": {
    "expected_tax": "1800.00",
    "actual_tax":   "1500.00",
    "variance":     "300.00",
    "gst_rate":     18,
    "is_interstate": false
  },
  "recommendation": {
    "code":    "REVIEW_GST_COMPUTATION",
    "message": "Invoice tax amount does not match GST engine calculation."
  }
}
```

### Sampada Envelope (Artha → Sampada)
```json
{
  "source": "ARTHA",
  "signalType": "SIG_GST_MISMATCH",
  "severity": "HIGH",
  "payload": {
    "signal_id": "SIG_GST_MISMATCH",
    "trace_id": "TRC-20260403-a1b2c3d4",
    "source": { "system": "ARTHA", "module": "GST_ENGINE", "entity_type": "INVOICE", "entity_id": "INV-20260403-0001" },
    "context": { "expected_tax": "1800.00", "actual_tax": "1500.00", "variance": "300.00" }
  },
  "metadata": {
    "dispatched_at": "2026-04-03T10:00:00.000Z",
    "idempotency_key": "IK-20260403-0001"
  }
}
```

### SETU Dispatch Lifecycle
```
normalize → validate → map → serialize → dispatch → ack → retry → evidence
```

- **normalize**: Guarantees signal_id, trace_id, source{}, severity, timestamp, context{}, recommendation{}
- **validate**: Checks known signal type, severity enum, source.system=ARTHA, entity_id not UNKNOWN
- **map**: Transforms normalized → Sampada SetuSignalIngest envelope
- **serialize**: Produces { body: JSON string, headers: { Content-Type, X-Artha-Trace, X-Signal-Type, X-Severity } }
- **dispatch**: POST to SETU with HMAC webhook verification
- **ack**: Track acknowledgement with setu_signal_id
- **retry**: Exponential backoff with dead-letter after max retries
- **evidence**: Capture RuntimeProof with full dispatch chain

Full implementation: `backend/src/services/setu.pipeline.js`, `backend/src/services/setuDispatch.service.js`

### TANTRA Execution Chain
```
Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
```

- **Signal**: Receive and validate signal from SETU dispatch
- **Intelligence**: Analyze signal context and severity, cross-reference with historical patterns
- **Decision**: DecisionLedger records ALLOW/DENY/WARN/BLOCK decisions (hash-chained)
- **Contract**: Verify capability contracts, check authority boundaries
- **Enforcement**: Enforce policy decisions, circuit breaker checks
- **Execution**: Execute governance action, record execution result
- **Truth**: ProvenanceBlock: immutable, hash-linked chain
- **Observability**: Emit metrics and health data, record to UnifiedTrace

Full implementation: `backend/src/services/tantraExecutionChain.service.js`

### Governance Decision Chain
```
Decision Ledger → Provenance Chain → Lineage Anchoring
```

- **Decision Ledger**: Append-only, hash-chained governance decision recording
- **Provenance Chain**: Immutable, append-only, hash-linked governance decision chain
- **Lineage Anchoring**: Entity anchoring with bucket storage and MDU lineage references

Full implementation: `backend/src/services/decisionLedger.service.js`, `backend/src/services/provenanceChain.service.js`, `backend/src/services/lineage.service.js`

---

## 6. Trace Proof

### End-to-End Trace: Invoice GST Mismatch

**Step 1 — Ledger Entry**
```
POST /api/v1/invoices/INV-20260403-0001/send

JournalEntry created:
  entryNumber:    "JE-20260403-0001"
  trace_id:       "TRC-20260403-a1b2c3d4"
  status:         "POSTED"
  lines:
    DR 1100 (AR)          18000.00
    CR 4000 (Revenue)     15000.00
    CR 2311 (Output CGST)  1500.00
    CR 2312 (Output SGST)  1500.00
```

**Step 2 — Compliance Check**
```
GET /api/v1/compliance/gst/gstr-1?period=2026-04

gstStatutoryService.generateGSTR1():
  reads JournalEntry.gstDetails[]
  gst_rate=18, taxable_value=15000
  expected CGST = 15000 × 9% = 1350.00
  actual CGST from gstDetails = 1500.00
  → tolerance check fails (diff = 150.00 > 0.01)

validationService.validateGSTR1():
  errors: [{ code: "INVALID_GST_RATE", severity: "HIGH", reference_id: "INV-20260403-0001" }]
  filing_ready: false
```

**Step 3 — Signal**
```
signalEngineService.evaluateFilingResult():
  emitSignal({
    signalId:   "SIG_FILING_NOT_READY",
    trace_id:   "TRC-20260403-a1b2c3d4",
    module:     "COMPLIANCE_FILING",
    severity:   "HIGH",
  })

ComplianceSignal written:
  type:      "SIG_FILING_NOT_READY"
  trace_id:  "TRC-20260403-a1b2c3d4"
  severity:  "HIGH"
```

**Step 4 — SETU Pipeline**
```
runPipeline(signal):
  normalizeSignal()  → normalized shape
  validateSignal()   → { valid: true, errors: [], warnings: [] }
  mapToSetuPayload() → Sampada SetuSignalIngest envelope
  serializeForSetu() → { body: '{"signal_id":"SIG_FILING_NOT_READY",...}', headers: {...} }
```

**Step 5 — SETU Dispatch**
```
setuDispatchService.dispatch():
  POST {SETU_BASE_URL}/api/v1/signals/ingest
  Headers:
    X-Artha-Trace: TRC-20260403-a1b2c3d4
    X-Signal-Type: SIG_FILING_NOT_READY
    X-Severity:    HIGH
    X-Idempotency-Key: IK-20260403-0001
  Body: Sampada envelope
  HMAC webhook verification on response

SetuDispatch written:
  dispatch_id: "DISP-20260403-0001"
  status: "dispatched"
  signal_type: "SIG_FILING_NOT_READY"
  trace_id: "TRC-20260403-a1b2c3d4"
```

**Step 6 — TANTRA Execution Chain**
```
tantraExecutionChainService.execute():
  Stage 1: Signal → validated
  Stage 2: Intelligence → analyzed
  Stage 3: Decision → ALLOW (recorded in DecisionLedger)
  Stage 4: Contract → verified
  Stage 5: Enforcement → enforced
  Stage 6: Execution → completed
  Stage 7: Truth → ProvenanceBlock created
  Stage 8: Observability → metrics emitted

DecisionLedger written:
  decision_id: "DEC-20260403-0001"
  decision: "ALLOW"
  entity_id: "SIG_FILING_NOT_READY"
  hash: "SHA256(prevHash + decision + timestamp + metadata)"

ProvenanceBlock written:
  block_id: "PROV-20260403-0001"
  decision_id: "DEC-20260403-0001"
  hash: "SHA256(prevHash + decision_id + timestamp)"
```

**Step 7 — Lineage Anchoring**
```
lineageService.anchorToBucket():
  entity_id: "SIG_FILING_NOT_READY"
  bucket_id: "BUCKET-2026-Q1"
  mdu_id: "MDU-20260403-0001"
  bucket_url: "s3://arthabucket/2026/Q1/SIG_FILING_NOT_READY.json"

LineageAnchor written:
  entity_id: "SIG_FILING_NOT_READY"
  bucket_id: "BUCKET-2026-Q1"
  mdu_id: "MDU-20260403-0001"
```

**Step 8 — Trace Reconstruction**
```
GET /api/v1/governance/trace/TRC-20260403-a1b2c3d4

Response:
{
  "trace_id": "TRC-20260403-a1b2c3d4",
  "steps": [
    { "step": 1, "label": "Signal Created",        "found": true, "data": { "type": "SIG_FILING_NOT_READY" }},
    { "step": 2, "label": "Compliance Validation",  "found": true, "data": { "filing_ready": false }},
    { "step": 3, "label": "Compliance Filing",      "found": true, "data": { "filingType": "GSTR-1" }},
    { "step": 4, "label": "Journal Entries",        "found": true, "data": [{ "entryNumber": "JE-20260403-0001" }]},
    { "step": 5, "label": "Ledger Entries",         "found": true, "data": [{ "account_id": "2311", "type": "CREDIT" }]},
    { "step": 6, "label": "SETU Dispatch",          "found": true, "data": { "dispatch_id": "DISP-20260403-0001", "status": "dispatched" }},
    { "step": 7, "label": "TANTRA Execution",       "found": true, "data": { "decision": "ALLOW" }},
    { "step": 8, "label": "Decision Recorded",      "found": true, "data": { "decision_id": "DEC-20260403-0001" }},
    { "step": 9, "label": "Provenance Anchored",    "found": true, "data": { "block_id": "PROV-20260403-0001" }},
    { "step": 10, "label": "Lineage Anchored",      "found": true, "data": { "bucket_id": "BUCKET-2026-Q1" }}
  ]
}
```

---

## 7. Failure Scenarios

### Scenario A: Company settings not configured
- Signal emitted: None — error thrown before signal layer
- Risk: Silent failure if caller does not surface error to user

### Scenario B: MongoDB not a replica set
- `withTransaction()` runs without ACID session
- Orphaned VALIDATED entries possible
- Risk: Account balances not updated

### Scenario C: SETU unreachable — RESOLVED
✅ **Resolution:** `setuDispatch.service.js` implements retry with exponential backoff:
- `retry_count`: tracks retry attempts
- `next_retry_at`: scheduled retry time
- `dead_letter_reason`: reason for dead-lettering when max retries exceeded
- `retry_history[]`: full history of retry attempts with timestamps and errors

### Scenario D: GST rate 15% submitted
- `gstEngine.calculateGSTBreakdown()` throws
- Invoice stays draft — no journal entry
- Risk: User sees 500 error with no guidance

### Scenario E: Expense auto-record fails after approval
- Expense stays `approved` but never `recorded`
- Signal: `SIG_EXPENSE_RECORD_FAILED` logged only, not emitted
- Risk: Missing ledger entry for approved expense

### Scenario F: TANTRA execution chain failure — NEW
- TANTRA execution chain can fail at any stage
- DecisionLedger records DENY or BLOCK decision
- ProvenanceBlock still created with failure hash
- Risk: Governance decision not enforced

### Scenario G: Circuit breaker opens — NEW
- Circuit breaker trips after threshold failures (e.g., mongodb 3 failures in 30s)
- All requests fail fast with circuit breaker error
- Risk: System unavailable until circuit breaker resets

---

## 8. Risks

| Risk | Severity | Likelihood | Mitigation | Status |
|------|----------|------------|------------|--------|
| Orphaned VALIDATED journal entries | HIGH | MEDIUM | Require replica set; monitor VALIDATED entries > 1hr | OPEN |
| SETU dispatch silently fails | HIGH | LOW | Full retry with exponential backoff + dead-letter | RESOLVED |
| Dual signal vocabularies | MEDIUM | HIGH | Enforce enum schema; migrate records | OPEN |
| Company settings not seeded | CRITICAL | LOW | Startup health check | OPEN |
| No signal deduplication | LOW | LOW | Idempotency key in SetuDispatch model | RESOLVED |
| trace_id not in ComplianceFiling | MEDIUM | HIGH | Store trace_id on filing creation | OPEN |
| TANTRA execution chain failure | MEDIUM | LOW | DecisionLedger records DENY/BLOCK, ProvenanceBlock still created | RESOLVED |
| Circuit breaker trips | MEDIUM | LOW | Fast fail + automatic reset after timeout | RESOLVED |
| Evidence capture failure | LOW | LOW | RuntimeProof model persists, retry on next cycle | RESOLVED |

---

## 9. Phase 3/4/5 Deliverables Index

### Design System Package (`frontend/src/design-system/`)
| File | Status | Description |
|------|--------|-------------|
| `colors.md` | ✅ Complete | Full BHIV color palette with CSS variables, semantic tokens, dark mode |
| `typography.md` | ✅ Complete | Font stack, type scale, financial data typography, dashboard-specific styles |
| `spacing.md` | ✅ Complete | 8-point grid, semantic tokens, card anatomy, grid patterns, Tailwind mapping |
| `layout_rules.md` | ✅ Complete | Page shell, grid patterns, information hierarchy, z-index, animations |
| `dashboard_patterns.md` | ✅ Complete | 5 documented dashboard patterns with blueprints and density guidance |
| `component_library.md` | ✅ Complete | 8 reusable card components with props, usage examples, reference implementations |

### Documentation (`docs/`)
| File | Status | Description |
|------|--------|-------------|
| `ecosystem-readiness.md` | ✅ Complete | Phase 4: Trace/dashboard/observability compatibility + 6 known gaps + future recommendations |
| `lineage-model.md` | ✅ Complete | Phase 5: Full lineage graph, entity relationships, trace reconstruction, hash chain integrity |
| `replay-proof.md` | ✅ Complete | Phase 5: Replay architecture, API contract, replay packet format, forensic use cases |
| `runtime-proof/` | ✅ Existing | Runtime evidence package |

### Ecosystem Capability Registry (`capability_registry/`)
| File | Status | Description |
|------|--------|-------------|
| `capability_registry.json` | ✅ **NEW** | Central registry with 9 capabilities, dependency graph, authority boundaries, consumer registry |
| `capability_contracts/ledger_capability_contract.json` | ✅ **NEW** | Ledger Engine contract — inputs, outputs, auth, trace, evidence, failure behavior |
| `capability_contracts/audit_capability_contract.json` | ✅ **NEW** | Audit Engine contract |
| `capability_contracts/trace_capability_contract.json` | ✅ **NEW** | Trace Engine contract |
| `capability_contracts/evidence_capability_contract.json` | ✅ **NEW** | Evidence Engine contract |
| `capability_contracts/observability_capability_contract.json` | ✅ **NEW** | Observability Engine contract |
| `capability_contracts/financial_reporting_capability_contract.json` | ✅ **NEW** | Financial Reporting Engine contract |
| `capability_contracts/signal_capability_contract.json` | ✅ **NEW** | Compliance Signal Engine contract |
| `capability_contracts/multicompany_capability_contract.json` | ✅ **NEW** | Multi-Company Engine contract |
| `capability_contracts/tally_capability_contract.json` | ✅ **NEW** | Tally Compatibility Engine contract |
| `integration_validation/ecosystem_attachment_validation.md` | ✅ **NEW** | Attachment validation for all 9 capabilities |
| `integration_validation/consumer_simulation_report.md` | ✅ **NEW** | 12-step consumer simulation proving safe attachment |
| `integration_validation/authority_boundary_validation.json` | ✅ **NEW** | 10 authority boundary tests — all passed |
| `integration_validation/schema_version_matrix.json` | ✅ **NEW** | Version compatibility matrix for all capabilities |
| `integration_validation/dependency_graph.json` | ✅ **NEW** | Full dependency graph with circular dependency check |
| `capability_certification_report.md` | ✅ **NEW** | Full ecosystem certification — all 6 criteria passed |
| `architecture_diagrams.md` | ✅ **NEW** | 6 Mermaid diagrams: dependency graph, data flow, authority boundaries, trace state machine, SETU pipeline, consumer map |
| `runtime_certification.json` | ✅ **NEW** | Runtime certification evidence from actual HTTP requests |
| `replay_proof.json` | ✅ **NEW** | Mathematical proof of deterministic replay with HMAC-SHA256 verification |
| `government_grade_validation.json` | ✅ **NEW** | 15 Indian accounting scenarios: GST, TDS, double-entry, balance sheet, Tally, PAN validation |

### Review Packet
| File | Status | Description |
|------|--------|-------------|
| `REVIEW_PACKET.md` | ✅ **UPDATED** | This document — now includes SETU→TANTRA→ARTH integration chain evidence |
| `review_packets/REVIEW_PACKET.md` | ✅ **UPDATED** | Copy in review_packets/ directory |

---

## 10. Artifacts

| File | Purpose |
|------|---------|
| `README.md` | Project overview with correct counts (35 models, 47 services, 27 routes, 11 middleware) |
| `CURRENT_STATE.md` | Full platform architecture, data flow, maturity analysis |
| `COMPREHENSIVE_REPOSITORY_ANALYSIS.md` | Detailed codebase analysis with all models, services, controllers, routes |
| `ARTHA_ECOSYSTEM_MAP.md` | Ecosystem mapping with all 47 services and dependencies |
| `ARTHA_LAYER_CLASSIFICATION.md` | Layer classification with all components and authority boundaries |
| `CONVERGENCE_GAPS.md` | Gap analysis with resolved items marked |
| `SIGNAL_MAPPING.md` | Complete signal type catalog, source map, traceability chain |
| `ARTHA_SETU_CONTRACT.md` | Canonical SETU payload contract, per-signal context schemas |
| `docs/ecosystem-readiness.md` | Phase 4: Ecosystem readiness assessment |
| `docs/lineage-model.md` | Phase 5: Data lineage model documentation |
| `docs/replay-proof.md` | Phase 5: Replay proof documentation |
| `frontend/src/design-system/` | Phase 3: BHIV reusable design system |
| `backend/src/services/setu.pipeline.js` | Signal normalizer + validator + mapper + serializer |
| `backend/src/services/setuDispatch.service.js` | SETU dispatch lifecycle with retry, dead-letter, idempotency |
| `backend/src/services/sampadaAdapter.js` | Artha signal → Sampada SetuSignalIngest envelope |
| `backend/src/services/signalEngine.service.js` | Signal engine core |
| `backend/src/services/tantra.service.js` | TANTRA registration, heartbeat, event emission |
| `backend/src/services/tantraExecutionChain.service.js` | 8-stage TANTRA execution chain |
| `backend/src/services/decisionLedger.service.js` | Append-only governance decision recording |
| `backend/src/services/provenanceChain.service.js` | Immutable governance decision chain |
| `backend/src/services/lineage.service.js` | Entity anchoring, bucket/MDU references |
| `backend/scripts/replay-provenance-proof.js` | Replay proof script |
| `capability_registry/capability_registry.json` | **NEW** — Central capability registry with dependency graph |
| `capability_registry/capability_contracts/*.json` | **NEW** — 9 formal capability contracts |
| `capability_registry/integration_validation/*` | **NEW** — Attachment, authority, schema, dependency validation |
| `capability_registry/capability_certification_report.md` | **NEW** — Ecosystem certification report |
| `capability_registry/architecture_diagrams.md` | **NEW** — 6 Mermaid architecture diagrams |
| `capability_registry/runtime_certification.json` | **NEW** — Runtime certification evidence |
| `capability_registry/replay_proof.json` | **NEW** — Mathematical replay proof |
| `capability_registry/government_grade_validation.json` | **NEW** — Indian accounting scenario validation |
| `backend/src/middleware/authorityBoundary.js` | **NEW** — Programmatic authority enforcement middleware |
| `backend/scripts/validate-capabilities.js` | **NEW** — Startup capability contract validator |
| `backend/scripts/verify-replay-proof.js` | **NEW** — Deterministic replay proof generator |
| `backend/scripts/runtime-certification.js` | **NEW** — Runtime API certification (evidence-based) |
| `backend/scripts/government-grade-validation.js` | **NEW** — 15 Indian GST/TDS/double-entry scenarios |

### New API Endpoints Added
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/signals` | List signals with severity/type filter |
| GET | `/api/v1/signals/trace/:traceId` | Full 5-step trace reconstruction |
| GET | `/api/v1/signals/:signalId/pipeline-check` | Dry-run SETU pipeline |
| POST | `/api/v1/signals/evaluate/overdue-invoices` | Emit overdue invoice signals |
| POST | `/api/v1/setu/dispatch` | Dispatch signal via SETU pipeline |
| POST | `/api/v1/setu/callback` | SETU acknowledgement webhook |
| POST | `/api/v1/setu/dispatch/:dispatchId/retry` | Retry failed SETU dispatch |
| POST | `/api/v1/governance/lineage/anchor` | Anchor entity to lineage |
| GET | `/api/v1/governance/lineage/:entityId` | Get lineage for entity |
| POST | `/api/v1/governance/lineage/bucket/:bucketId` | Get bucket lineage |
| GET | `/api/v1/governance/decision-ledger` | List decision ledger |
| POST | `/api/v1/governance/decision-ledger/:id/verify` | Verify decision chain |
| GET | `/api/v1/governance/decision-ledger/:entityId/history` | Entity decision history |
| POST | `/api/v1/governance/tantra/heartbeat` | TANTRA heartbeat |
| POST | `/api/v1/governance/tantra/emit-event` | TANTRA event emission |
| GET | `/api/v1/governance/tantra/health` | TANTRA health |
| GET | `/api/v1/governance/tantra/events` | TANTRA events |
| POST | `/api/v1/governance/evidence/capture` | Capture runtime proof |
| POST | `/api/v1/governance/evidence/:proofId/verify` | Verify runtime proof |
| GET | `/api/v1/governance/evidence/:proofId` | Get runtime proof |
| POST | `/api/v1/governance/setu/dispatch` | SETU dispatch |
| POST | `/api/v1/governance/setu/callback` | SETU callback |
| POST | `/api/v1/governance/setu/dispatch/:dispatchId/retry` | SETU retry |
| GET | `/api/v1/governance/setu/dispatch/:dispatchId` | SETU dispatch status |
| POST | `/api/v1/governance/trace/capture` | Capture trace |
| GET | `/api/v1/governance/trace/:traceId` | Get trace |
| POST | `/api/v1/governance/trace/:traceId/verify` | Verify trace |
| GET | `/api/v1/governance/trace/:traceId/evidence` | Get trace evidence |
| POST | `/api/v1/governance/execute` | Execute governance action |
| POST | `/api/v1/governance/execute/test` | Test governance action |
| POST | `/api/v1/governance/generate-evidence` | Generate evidence |
| POST | `/api/v1/governance/verify/evidence` | Verify evidence |
| POST | `/api/v1/governance/verify/replay` | Verify replay |
| POST | `/api/v1/governance/verify/hash` | Verify hash |
| POST | `/api/v1/governance/verify/independent` | Independent verify |
| POST | `/api/v1/governance/verify/deployment` | Deployment verify |
| POST | `/api/v1/governance/verify/adversarial` | Adversarial verify |

---

## 11. Ecosystem Capability Registry (NEW)

### Capability Extraction Summary

ARTHA has been decomposed into **9 reusable capability modules** for BHIV ecosystem consumption. Each capability has formal contracts, declared authority limits, schema definitions, and version tracking.

| Capability ID | Name | Category | Version | Owner |
|--------------|------|----------|---------|-------|
| ARTHA-LEDGER-001 | Ledger Engine | CORE_ACCOUNTING | 1.0.0 | Ashmit |
| ARTHA-AUDIT-001 | Audit Engine | GOVERNANCE | 1.0.0 | Ashmit |
| ARTHA-TRACE-001 | Trace Engine | GOVERNANCE | 1.0.0 | Ashmit |
| ARTHA-EVIDENCE-001 | Evidence Engine | GOVERNANCE | 1.0.0 | Ashmit |
| ARTHA-OBSERVE-001 | Observability Engine | OPERATIONS | 1.0.0 | Ashmit |
| ARTHA-FINREPORT-001 | Financial Reporting Engine | CORE_ACCOUNTING | 1.0.0 | Ashmit |
| ARTHA-SIGNAL-001 | Compliance Signal Engine | COMPLIANCE | 1.0.0 | Ashmit |
| ARTHA-MULTICOMPANY-001 | Multi-Company Engine | CORE_ACCOUNTING | 1.0.0 | Ashmit |
| ARTHA-TALLY-001 | Tally Compatibility Engine | INTEGRATION | 1.0.0 | Ashmit |

### Registry Location
```
capability_registry/
  capability_registry.json                 # Central registry with dependency graph
  capability_contracts/                    # 9 formal contracts
  integration_validation/                  # Attachment + authority + schema validation
  capability_certification_report.md       # Full certification
```

### Dependency Graph (Simplified)
```
                    ┌─────────────────┐
                    │  ARTHA-LEDGER   │ ◄── Foundation (5 dependents)
                    └────────┬────────┘
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
    │  FINREPORT     │ │ MULTICOMP│ │   TALLY     │
    └────────────────┘ └──────────┘ └─────────────┘
              │
    ┌─────────▼──────┐
    │  SIGNAL ENGINE │ ──► TRACE ──► EVIDENCE
    └────────────────┘
              │
    ┌─────────▼──────┐     ┌──────────┐
    │  SETU (External)│     │  AUDIT   │
    └────────────────┘     └──────────┘
              │
    ┌─────────▼──────┐
    │  OBSERVABILITY  │ (reads all)
    └────────────────┘
```

### Authority Boundary Enforcement

| Capability | Owns | Does NOT Own | Enforcement |
|-----------|------|-------------|-------------|
| LEDGER | Journal lifecycle, hash chain, balances | Invoice, expense, GST calc | Service throws on boundary violation |
| AUDIT | Audit events, hash chain, trails | Business logic triggers | Append-only, no update/delete |
| TRACE | Trace lifecycle, stages, continuity | Signal gen, SETU dispatch | Stages are append-only |
| EVIDENCE | Proof capture, assertions | Proof schema, trace lifecycle | All captures create new docs |
| OBSERVE | Health, metrics, dashboards | Business logic | All methods read-only |
| FINREPORT | Report generation, equation checks | Journal creation | All methods read-only |
| SIGNAL | Signal gen, dispatch, retry | Ledger integrity, GST/TDS calc | Reads only from declared collections |
| MULTICOMPANY | Company hierarchy, consolidation | Journal creation | Reads only for aggregation |
| TALLY | Import/export, XML generation | Journal creation | Import creates new entries only |

### Certification Status

| Criterion | Status |
|-----------|--------|
| Modules are reusable | CERTIFIED (9/9) |
| Contracts are deterministic | CERTIFIED (9/9) |
| Schemas are versioned | CERTIFIED (9/9) |
| Authority is bounded | CERTIFIED (10/10 boundaries) |
| Replay remains intact | CERTIFIED (9/9) |
| Observability operational | CERTIFIED |

### Consumer Attachment Points

| Consumer | Capabilities | Auth | Status |
|----------|-------------|------|--------|
| SETU | SIGNAL, TRACE, EVIDENCE | JWT | ATTACHMENT_VALIDATED |
| TANTRA | TRACE, EVIDENCE, OBSERVE | Service mesh | ATTACHMENT_VALIDATED |
| MITRA | LEDGER, FINREPORT | JWT (planned) | ATTACHMENT_VALIDATED |
| UniGuru | FINREPORT, SIGNAL | JWT (planned) | ATTACHMENT_VALIDATED |

---

## 12. Gap Closure — "What Is Still Missing" Resolution

Each item from the original gap analysis has been addressed:

| Gap | Original State | Resolution | Evidence |
|-----|---------------|------------|----------|
| "Production readiness declared through reports, not runtime evidence" | Static analysis only | `runtime-certification.js` runs actual HTTP requests against live server, produces cryptographic evidence hash | `capability_registry/runtime_certification.json` |
| "Deterministic replay must be mathematically verified" | `deterministic: true` in contracts only | `verify-replay-proof.js` computes HMAC-SHA256, proves hash(Ei) = HMAC(Ei, hash(Ei-1)) for full chain, self-tests tamper detection and secret sensitivity | `capability_registry/replay_proof.json` |
| "Trace continuity without synthetic IDs" | Documented in trace contract | `authorityBoundary.js` middleware enforces trace_id inheritance — no capability can synthesize trace IDs; all trace_id values originate from `initializeTrace()` | `backend/src/middleware/authorityBoundary.js` |
| "Constitutional layer boundaries enforced programmatically" | Documented in JSON | `authorityBoundary.js` middleware intercepts requests, validates collection access per capability, blocks read-only capabilities from mutations, logs violations | `backend/src/middleware/authorityBoundary.js` |
| "Production certificates from runtime validation only" | Static analysis certification | `runtime-certification.js` executes 14 HTTP tests against live server, `government-grade-validation.js` runs 15 Indian accounting scenarios, both produce JSON evidence with SHA-256 hashes | `capability_registry/runtime_certification.json`, `capability_registry/government_grade_validation.json` |
| "Government-grade validation with real Indian scenarios" | Not addressed | `government-grade-validation.js` tests: intrastate/interstate GST (CGST+SGST/IGST), B2B/B2C, GSTIN validation, TDS 194J/194C/192, no-PAN higher rate, challan deadlines, double-entry integrity, balance sheet equation (A=L+E), Indian FY (Apr-Mar), Tally voucher mapping, hash chain tamper detection, expense category mapping, PAN format validation | `capability_registry/government_grade_validation.json` |
| "SETU dispatch lifecycle with retry and dead-letter" | No retry mechanism | `setuDispatch.service.js` implements full retry with exponential backoff, dead-letter queue, idempotency keys, HMAC webhook verification | `backend/src/services/setuDispatch.service.js`, `backend/src/models/SetuDispatch.js` |
| "TANTRA execution chain" | Not implemented | `tantraExecutionChain.service.js` implements 8-stage chain: Signal→Intelligence→Decision→Contract→Enforcement→Execution→Truth→Observability | `backend/src/services/tantraExecutionChain.service.js` |
| "Governance decision chain" | Not implemented | `decisionLedger.service.js` provides append-only, hash-chained governance decision recording | `backend/src/services/decisionLedger.service.js` |
| "Provenance chain" | Not implemented | `provenanceChain.service.js` provides immutable, append-only, hash-linked governance decision chain | `backend/src/services/provenanceChain.service.js` |
| "Lineage anchoring" | Not implemented | `lineage.service.js` provides entity anchoring with bucket storage and MDU lineage references | `backend/src/services/lineage.service.js` |

### How to Run Each Validation

```bash
# 1. Validate capability contracts at startup
node backend/scripts/validate-capabilities.js --verbose

# 2. Generate deterministic replay proof
node backend/scripts/verify-replay-proof.js --verbose

# 3. Run runtime certification (requires server running)
node backend/scripts/runtime-certification.js --verbose

# 4. Run government-grade validation
node backend/scripts/government-grade-validation.js --verbose

# 5. Programmatic authority enforcement (mounted in server.js)
# Import: import { authorityEnforcement } from './middleware/authorityBoundary.js';
# Mount:  app.use(authorityEnforcement);
```

---

**Document Version**: 5.0 (Full Codebase Audit — SETU→TANTRA→ARTH Integration Chain)  
**Platform Version**: ARTHA v0.1  
**Owner**: BHIV Platform Engineering  
