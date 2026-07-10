# CURRENT_STATE.md — Artha Platform v0.1

## 1. What Artha Is Today

Artha is a financial intelligence and compliance platform built around
double-entry accounting, GST/TDS compliance, audit traceability,
and signal generation for Indian businesses.

Core pillars:

- **Ledger Integrity** — HMAC-SHA256 hash-chained journal entries + SHA-256 hash-chained ledger entries
- **Compliance Validation** — GST (GSTR-1, GSTR-3B) and TDS (Form 24Q, Form 26Q) filing generation with validation
- **Filing Readiness** — Structured JSON filing packets with `ComplianceFiling` records and `ComplianceValidationLog` audit
- **Financial Intelligence** — Signal engine reading ledger balances, dashboard with health score and risk signals
- **Audit Reconstruction** — Every journal entry carries `trace_id`, `auditTrace`, `auditTrail[]`, `prevHash`, `hash`, `chainPosition`
- **BHIV Governance** — Capability registry, policy engine, provenance chain, deterministic replay, circuit breakers
- **SETU Integration** — Full dispatch lifecycle: normalize → validate → map → serialize → dispatch → ack → retry → evidence
- **TANTRA Execution** — Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability

---

## 2. Architecture Overview

```
Browser (React 18 + Vite + Zustand + Recharts)

  │
  │  Authorization: Bearer <JWT>
  ▼
Express API  (Node.js 18, port 5000)
  │
  ├── /api/v1/auth          → auth.controller       → User model (bcrypt + JWT)
  ├── /api/v1/ledger        → ledger.controller     → LedgerService
  ├── /api/v1/invoices      → invoice.controller    → InvoiceService
  ├── /api/v1/expenses      → expense.controller    → ExpenseService
  ├── /api/v1/tds           → tds.controller        → TDSService
  ├── /api/v1/gst           → gst.controller        → GSTService / GSTStatutoryService
  ├── /api/v1/compliance    → compliance.controller → ComplianceValidationService
  ├── /api/v1/reports       → reports.controller    → FinancialReportsService
  ├── /api/v1/signals       → signal.controller     → SignalEngineService
  ├── /api/v1/settings      → settings routes       → CompanySettings model
  ├── /api/v1/banking       → banking.controller    → BankingService
  ├── /api/v1/audit         → audit.controller      → AuditService
  ├── /api/v1/ca-workflow   → caWorkflow.controller → CAWorkflowService
  ├── /api/v1/tally         → tally.controller      → TallyCompatibilityService
  ├── /api/v1/multi-company → multiCompany.controller → MultiCompanyService
  ├── /api/v1/tantra        → tantra.controller     → TantraService
  ├── /api/v1/governance    → governance.routes     → 30+ governance endpoints
  ├── /api/v1/setu/callback → SETU webhook          → SetuDispatchService
  ├── /api/v1/setu/dispatch → SETU dispatch         → SetuDispatchService
  ├── /api/v1/statements    → bankStatement.controller → BankStatementService
  ├── /api/v1/upload        → smartUpload.controller → SmartUploadService
  ├── /api/v1/signals       → signal.controller     → SignalEngineService
  ├── /api/v1/runtime       → runtime.routes        → ObservabilityService
  ├── /api/v1/trace         → trace.routes          → TraceabilityService
  │
  ▼
Middleware Stack
  ├── authorityEnforcement  → capability boundary from JSON contracts
  ├── policyEnforcement     → runtime policy engine
  ├── protect               → JWT verification (Bearer token)
  ├── authorize             → role-based access (admin/accountant/viewer)
  ├── security              → helmet, rate limiting, sanitization
  ├── monitoring            → request logging, performance tracking
  └── cache                 → Redis response caching
  │
  ▼
Services Layer (47 Services)
  │
  Core Accounting (10):
  ├── ledger.service.js          — journal lifecycle, hash chain, account balance updates
  ├── invoice.service.js         — invoice lifecycle → ledger posting with GST
  ├── expense.service.js         — expense lifecycle → ledger posting with approval
  ├── tds.service.js             — TDS lifecycle → ledger posting, Form 26Q
  ├── gstEngine.service.js       — pure GST calculation (IGST / CGST+SGST split)
  ├── gst.service.js             — GSTR-1 / GSTR-3B generation (legacy)
  ├── financialReports.service.js — P&L, Balance Sheet, Cash Flow, Trial Balance, Aged Receivables
  ├── chartOfAccounts.service.js — account management
  ├── export.service.js          — PDF/Excel/CSV export
  └── health.service.js          — system health checks
  │
  Compliance (5):
  ├── compliance/gstStatutory.service.js   — GSTR-1 / GSTR-3B from JournalEntry.gstDetails
  ├── compliance/tdsStatutory.service.js   — Form 26Q / Form 24Q from TDSEntry
  ├── compliance/tdsLifecycle.service.js   — TDS deduction → deposit → filing workflow
  ├── compliance/validation.service.js     — filing validation → ComplianceValidationLog
  └── compliance/signal.service.js         — signal emission from compliance checks
  │
  BHIV Governance (9):
  ├── capabilityRegistry.service.js   — canonical capability contracts, route resolution
  ├── provenanceChain.service.js      — immutable governance decision chain
  ├── deterministicReplay.service.js  — SHA-256 hash-verified replay system
  ├── circuitBreaker.service.js       — 6 configurable breakers (CLOSED/OPEN/HALF_OPEN)
  ├── independentVerifier.service.js  — 10 BHIV compliance verification tests
  ├── deploymentEvidence.service.js   — evidence generation for 9 deployment scenarios
  ├── adversarialSuite.service.js     — 12 adversarial attack vectors
  ├── decisionLedger.service.js       — append-only governance decision recording
  └── lineage.service.js              — entity anchoring, bucket/MDU references
  │
  Integration (11):
  ├── banking.service.js              — bank data import and processing
  ├── bankStatement.service.js        — statement upload, parsing, transaction extraction
  ├── audit.service.js                — immutable audit event recording with hash-chain
  ├── caWorkflow.service.js           — month/quarter/year close procedures
  ├── tallyCompatibility.service.js   — Tally ERP import/export
  ├── multiCompany.service.js         — consolidated reporting, branch accounting
  ├── observability.service.js        — system health, metrics, Prometheus
  ├── traceability.service.js         — cross-service trace reconstruction
  ├── evidenceAutomation.service.js   — auto-generated runtime evidence
  ├── setuDispatch.service.js         — signal → normalize → validate → dispatch → ack → retry
  └── setu.pipeline.js               — pure functions: Normalizer → Validator → Mapper → Serializer
  │
  Runtime (6):
  ├── tantra.service.js               — registration, heartbeat, event emission
  ├── tantraExecutionChain.service.js — Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
  ├── sampadaAdapter.js               — Artha signal → Sampada SetuSignalIngest envelope
  ├── signalEngine.service.js         — ledger-based signal snapshot
  ├── smartUpload.service.js          — document upload with OCR
  └── runtimeProof.service.js         — verifiable evidence capture
  │
  Infrastructure (6):
  ├── performance.service.js          — request timing, memory monitoring
  ├── cache.service.js                — Redis caching with invalidation
  ├── cacheInvalidation.service.js    — targeted cache invalidation
  ├── database.service.js             — connection management, query optimization
  ├── ocr.service.js                  — receipt image text extraction (Tesseract.js)
  └── pdf.service.js                  — PDF generation for reports and invoices
  │
  ▼
Data Layer (MongoDB 7+)
  │
  Core Accounting (8):
  ├── User             — auth, roles: admin / accountant / viewer
  ├── ChartOfAccounts  — 33+ pre-seeded accounts (Indian standards)
  ├── JournalEntry     — double-entry with HMAC hash chain
  ├── LedgerEntry      — flat debit/credit with SHA-256 hash chain
  ├── AccountBalance   — running balance per ChartOfAccounts entry
  ├── Invoice          — lifecycle: draft → sent → partial → paid → cancelled
  ├── Expense          — lifecycle: pending → approved → recorded → rejected
  └── Payment          — NEFT/RTGS/UPI/IMPS with retry, reconciliation
  │
  Compliance (7):
  ├── TDSEntry              — lifecycle: pending → deducted → deposited → filed
  ├── TDSChallan            — TDS deposit challan records
  ├── TDSQuarterlyGroup     — quarterly TDS grouping for Form 26Q/24Q
  ├── TDSValidationLog      — TDS filing validation audit
  ├── GSTReturn             — GSTR-1 / GSTR-3B records
  ├── ComplianceFiling      — structured filing packets with sourceTransactions[]
  └── ComplianceValidationLog — per-filing validation errors with severity
  │
  Audit & Traceability (4):
  ├── AuditLog         — action audit trail
  ├── AuditEvent       — hash-chained audit events with before/after state
  ├── UnifiedTrace     — end-to-end trace: TRANSACTION_CREATED → SETU_DISPATCHED → CONFIRMED
  └── RuntimeProof     — verifiable evidence: API responses, DB states, chain verification
  │
  BHIV Governance (4):
  ├── ProvenanceBlock  — immutable governance decision chain (hash-linked)
  ├── DecisionLedger   — append-only governance decisions (ALLOW/DENY/WARN/BLOCK)
  ├── LineageAnchor    — bucket storage and MDU lineage references
  └── ComplianceSignal — persisted compliance signal records
  │
  Integration (6):
  ├── SetuDispatch     — SETU dispatch lifecycle: pipeline → dispatch → ack → retry → evidence
  ├── BankStatement    — uploaded bank statements (augment P&L and Cash Flow)
  ├── ReconcileRecord  — bank reconciliation records
  ├── Company          — multi-company: GSTIN, PAN, TAN, branch, consolidation
  ├── CompanySettings  — singleton (_id: 'company_settings'), required for GST
  └── CostCentre       — cost centre/profit centre tracking
  │
  Financial Period & Tally (3):
  ├── FinancialPeriod  — month/quarter/year periods with close checklist
  ├── TallyExport      — Tally ERP export records
  └── TallyImport      — Tally ERP import records
  │
  Analytics (3):
  ├── RLExperience             — InsightFlow reinforcement learning buffer
  ├── InsightFlowExperience    — user behavior analytics
  └── JournalLine              — (embedded in JournalEntry) individual debit/credit lines
  │
  ▼
Cache Layer (Redis 7+ — optional, graceful degradation)
  └── Ledger summary, invoice stats, expense stats
```

---

## 3. Data Flow: Transaction → Signal

```
Invoice Created (draft)
  │  no ledger impact
  ▼
Invoice Sent
  │  InvoiceService.sendInvoice()
  │  → gstEngine.calculateGSTBreakdown() per line
  │  → LedgerService.createJournalEntry()   [status: DRAFT]
  │  → LedgerService.validateJournalEntry() [status: VALIDATED]
  │     validates: line integrity, double-entry balance,
  │                account existence, GST compliance, TDS compliance,
  │                audit trace presence
  │  → LedgerService.postJournalEntry()     [status: POSTED]
  │     verifies HMAC hash, writes LedgerEntries (SHA-256 chain),
  │     updates AccountBalance, invalidates Redis cache
  ▼
JournalEntry (POSTED)
  │  fields: entryNumber, date, description, lines[], gstDetails[],
  │           prevHash, hash, chainPosition, trace_id, auditTrail[]
  ▼
LedgerEntry (per debit/credit line)
  │  fields: journal_id, account_id, type, amount, prev_hash, hash, timestamp
  ▼
AccountBalance (updated in-place)
  │  fields: account, balance, debitTotal, creditTotal, lastUpdated
  ▼
SignalEngineService.getSignalSnapshot()
  │  reads LedgerEntry for accounts: 1000/1010 (cash), TDS Payable, Output CGST/SGST
  │  returns: { cashFlow, tdsPayable, outputCGST, outputSGST }
  ▼
SETU Pipeline (setu.pipeline.js)
  │  Pure functions: Normalizer → Validator → Mapper → Serializer
  │  SampadaAdapter: Artha signal → Sampada SetuSignalIngest envelope
  ▼
SetuDispatchService (setuDispatch.service.js)
  │  normalize → validate → map → serialize → dispatch → ack → retry → evidence
  │  HMAC webhook verification, idempotency keys, dead-letter tracking
  ▼
ComplianceValidationService (on filing generation)
  │  validates GSTR-1 / GSTR-3B / Form 26Q / Form 24Q
  │  writes ComplianceValidationLog
  ▼
ComplianceFiling (persisted)
  │  fields: filingId, filingType, traceId, sourceTransactions[], jsonData
  ▼
TANTRA Execution Chain (tantraExecutionChain.service.js)
  │  Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
  │  DecisionLedger records ALLOW/DENY/WARN/BLOCK decisions
  │  ProvenanceBlock stores immutable chain link
  │  LineageAnchor references bucket and MDU lineage
  ▼
UnifiedTrace + RuntimeProof (persisted)
```

---

## 4. Key Account Codes

| Code | Name | Type | Role |
|------|------|------|------|
| 1010 | Cash/Bank | Asset | All cash movements |
| 1100 | Accounts Receivable | Asset | Invoice AR |
| 2000 | Accounts Payable | Liability | Vendor payables |
| 2300 | TDS Payable | Liability | TDS deductions |
| 2301 | Input CGST | Asset | GST input credit |
| 2302 | Input SGST | Asset | GST input credit |
| 2303 | Input IGST | Asset | GST input credit |
| 2311 | Output CGST | Liability | GST output liability |
| 2312 | Output SGST | Liability | GST output liability |
| 2313 | Output IGST | Liability | GST output liability |
| 4000 | Revenue | Income | Sales revenue |
| 6xxx | Expense accounts | Expense | Operating expenses |

---

## 5. Major Maturity Improvements (vs. earlier versions)

### Ledger
| Before | Now |
|--------|-----|
| Journal entries only | Journal chain (HMAC-SHA256) + Ledger chain (SHA-256) + AccountBalance snapshots |
| No tamper detection | `verifyHash()` on every post, `verifyLedgerChain()` endpoint |
| No chain position | `chainPosition` field, ordered verification |

### Compliance
| Before | Now |
|--------|-----|
| Basic GST calculation | Full GST engine: IGST/CGST+SGST split, rate validation [0,5,12,18,28], interstate detection |
| No TDS tracking | TDS lifecycle with section-wise tracking (194A/C/H/I/J/192/194Q) |
| No filing packets | `ComplianceFiling` model with `sourceTransactions[]` for full traceability |
| No validation logs | `ComplianceValidationLog` per filing with error codes and severity |

### Audit
| Before | Now |
|--------|-----|
| CRUD history | Hash chain reconstructability — every entry has `trace_id`, `auditTrace`, `auditTrail[]` |
| No chain verification | `GET /api/v1/ledger/verify-chain` endpoint |

---

## 6. Current Limitations

### Signal Layer — PARTIALLY RESOLVED
- `ComplianceSignal` model exists but is **not written to** by any service
- Signal contracts are not formalized — no `signal_id` format, no severity enum enforcement
- `SignalEngineService` only reads ledger balances; does not evaluate compliance state
- No signals generated from: GST mismatch, TDS missing deduction, invoice overdue, ledger imbalance
- Dashboard falls back to `MOCK_SIGNALS` when `/signals/snapshot` returns empty data

### SETU Integration — RESOLVED
- ✅ SETU payload format defined via SampadaAdapter
- ✅ SETU pipeline implemented: setu.pipeline.js (Normalizer → Validator → Mapper → Serializer)
- ✅ SETU dispatch service: setuDispatch.service.js with full lifecycle (retry, dead-letter, idempotency)
- ✅ SETU dispatch model: SetuDispatch model tracks dispatch state
- ✅ SETU dispatch controller: SetuDispatch in governance routes (POST /api/v1/setu/dispatch)
- ✅ SETU callback webhook: HMAC verification (SetuDispatch in routes)
- ✅ SETU retry with exponential backoff and dead-letter queue

### Signal Lifecycle — RESOLVED
- ✅ TANTRA Execution Chain: Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
- ✅ Decision Ledger: append-only, hash-chained governance decision recording
- ✅ Provenance Chain: immutable governance decision chain (hash-linked)
- ✅ Lineage Anchoring: bucket storage and MDU lineage references

### Multi-Company — RESOLVED
- ✅ Company model with GSTIN, PAN, TAN, branch, consolidation support
- ✅ MultiCompanyService: consolidated reporting, branch accounting
- ✅ CostCentre model for cost centre/profit centre tracking

### Banking — RESOLVED
- ✅ BankingService: bank data import and processing
- ✅ BankStatement model for uploaded bank statements
- ✅ BankStatementService: statement upload, parsing, transaction extraction
- ✅ ReconcileRecord model for bank reconciliation

### Audit Trail — RESOLVED
- ✅ AuditService: immutable audit event recording with hash-chain
- ✅ AuditEvent model: before/after state, hash chain reconstruction
- ✅ RuntimeProof model: verifiable evidence capture

### Filing
- `gst.service.js` (legacy) and `gstStatutory.service.js` (new) both exist — dual paths for GSTR-1/3B
- `GSTReturn` model (legacy) and `ComplianceFiling` model (new) both used — inconsistent
- GSTR-3B ITC calculation uses only journal `gstDetails` — does not cross-reference `Expense` model

### Cross-System Traceability
- `ComplianceFiling.sourceTransactions[]` links filings to JournalEntry/TDSEntry IDs
- But no reverse lookup: given a JournalEntry, cannot find which filings reference it
- `trace_id` on JournalEntry is not propagated to ComplianceFiling.traceId (separate UUIDs)

### Transactions
- MongoDB transactions only available when replica set is configured
- Without replica set: all multi-step operations (create → validate → post) run without ACID guarantees
- `approveExpense()` auto-calls `recordExpense()` but swallows ledger errors (only logs, does not re-throw)

### Authentication
- New users default to `viewer` role — cannot create invoices or expenses without admin role upgrade
- No refresh token endpoint implemented (listed in README but not in code)
- `routes/index.js` is dead code — never imported in `server.js`

---

## 7. BHIV Ecosystem Integration (Complete)

### Runtime Convergence
- **Capability Registry**: Canonical single source of truth for capability contracts
- **Policy Engine**: Runtime enforcement with deterministic ALLOW/DENY decisions
- **Route Mapping**: Capability route map updated to v1.1.0 with governance route mapping

### Provenance & Replay
- **Provenance Chain**: Immutable, append-only, hash-linked governance decision chain
- **Deterministic Replay**: Replay system with SHA-256 hash verification for 100% reproducibility
- **Genesis Block**: Initialized at startup with timestamp, hash, and metadata

### Resilience
- **Circuit Breakers**: 6 configurable breakers (mongodb, redis, setu_api, tantra_runtime, ocr_service, evidence_pipeline)
- **Thresholds**: mongodb(3/30s), redis(3/30s), setu_api(3/120s)
- **States**: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery)

### Evidence & Verification
- **Independent Verifier**: 10 BHIV compliance verification tests
- **Deployment Evidence**: Evidence generation for 9 deployment scenarios
- **Adversarial Suite**: 12 adversarial attack vectors for security validation

### Governance API (30+ Endpoints)
```
GET    /api/v1/governance/capabilities
GET    /api/v1/governance/capabilities/:id
POST   /api/v1/governance/policy/evaluate
GET    /api/v1/governance/policy/status
GET    /api/v1/governance/provenance
GET    /api/v1/governance/provenance/verify
POST   /api/v1/governance/replay/deterministic
GET    /api/v1/governance/replay/status
GET    /api/v1/governance/circuit-breakers
POST   /api/v1/governance/circuit-breakers/:service/reset
POST   /api/v1/governance/verify/independent
GET    /api/v1/governance/verify/results
POST   /api/v1/governance/deployment/evidence
GET    /api/v1/governance/deployment/history
POST   /api/v1/governance/security/adversarial
GET    /api/v1/governance/security/results
GET    /api/v1/governance/status
GET    /api/v1/governance/health
POST   /api/v1/governance/lineage/anchor
GET    /api/v1/governance/lineage/:entityId
POST   /api/v1/governance/lineage/bucket/:bucketId
GET    /api/v1/governance/decision-ledger
POST   /api/v1/governance/decision-ledger/:id/verify
GET    /api/v1/governance/decision-ledger/:entityId/history
GET    /api/v1/governance/tantra/registration
POST   /api/v1/governance/tantra/heartbeat
POST   /api/v1/governance/tantra/emit-event
GET    /api/v1/governance/tantra/health
GET    /api/v1/governance/tantra/events
GET    /api/v1/governance/observability/metrics
GET    /api/v1/governance/observability/health
GET    /api/v1/governance/observability/system
POST   /api/v1/governance/evidence/capture
POST   /api/v1/governance/evidence/:proofId/verify
GET    /api/v1/governance/evidence/:proofId
POST   /api/v1/governance/setu/dispatch
POST   /api/v1/governance/setu/callback
POST   /api/v1/governance/setu/dispatch/:dispatchId/retry
GET    /api/v1/governance/setu/dispatch/:dispatchId
POST   /api/v1/governance/trace/capture
GET    /api/v1/governance/trace/:traceId
POST   /api/v1/governance/trace/:traceId/verify
GET    /api/v1/governance/trace/:traceId/evidence
POST   /api/v1/governance/execute
POST   /api/v1/governance/execute/test
POST   /api/v1/governance/generate-evidence
POST   /api/v1/governance/verify/evidence
POST   /api/v1/governance/verify/replay
POST   /api/v1/governance/verify/hash
POST   /api/v1/governance/verify/independent
POST   /api/v1/governance/verify/deployment
POST   /api/v1/governance/verify/adversarial
```

### SETU & TANTRA Integration Services
1. **setu.pipeline.js** — Pure functions: Normalizer → Validator → Mapper → Serializer
2. **setuDispatch.service.js** — SETU dispatch lifecycle with retry, dead-letter, idempotency
3. **sampadaAdapter.js** — Artha signal → Sampada SetuSignalIngest envelope mapping
4. **tantra.service.js** — Registration, heartbeat, event emission, health monitoring
5. **tantraExecutionChain.service.js** — 8-stage TANTRA execution chain
6. **lineage.service.js** — Entity anchoring, bucket/MDU references
7. **decisionLedger.service.js** — Append-only governance decision recording
8. **runtimeProof.service.js** — Verifiable evidence capture
9. **observability.service.js** — System health, metrics, Prometheus
10. **traceability.service.js** — Cross-service trace reconstruction
11. **evidenceAutomation.service.js** — Auto-generated runtime evidence

### Integration Points
- **File**: `backend/src/server.js`
- **Additions**: service initialization, policy engine middleware, governance routes, deployment evidence recording
- **Capability Contract**: `contracts/capability_contracts/capability_route_map.json` — 34 route prefixes mapped to 8 capabilities
