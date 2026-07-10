# ARTHA Ecosystem Map

## System Overview
ARTHAv0.1 is a production-ready, India-compliant accounting system participating in the BHIV TANTRA ecosystem.

## Ecosystem Layers

### Layer 1: Transaction Processing
- **Invoice Management**: Draft → Sent → Partial → Paid lifecycle with auto-journal
- **Expense Management**: Draft → Approved → Recorded with OCR support
- **Banking**: NEFT/RTGS/UPI/IMPS payments with retry and failure recovery
- **Bank Statements**: Upload, parsing, transaction extraction for reconciliation
- **TDS**: Deduction → Deposit → Filing workflow with section-wise tracking
- **Cost Centres**: Cost centre/profit centre tracking for departmental accounting

### Layer 2: Ledger & Accounting
- **Double-Entry Ledger**: HMAC-SHA256 hash-chain verified, tamper-proof
- **SHA-256 Ledger Chain**: Flat debit/credit chain with chain position tracking
- **Chart of Accounts**: 33+ pre-configured Indian accounts
- **Account Balances**: Real-time calculation from posted journal entries
- **Financial Reports**: P&L, Balance Sheet, Cash Flow, Trial Balance, Aged Receivables

### Layer 3: Compliance
- **GST Integration**: GSTR-1, GSTR-3B filing with CGST/SGST/IGST
- **TDS Management**: Section-wise tracking (194A-206AB)
- **Compliance Signals**: 46 signal types for monitoring
- **Filing Pipeline**: Validation → Generation → Evidence Capture
- **TDS Lifecycle**: TDSChallan, TDSQuarterlyGroup, TDSValidationLog
- **GST Returns**: GSTR-1 / GSTR-3B with statutory validation

### Layer 4: Audit & Evidence
- **Immutable Audit Trail**: Hash-chain verified audit events
- **Audit Events**: Before/after state with hash chain reconstruction
- **Runtime Proof**: API responses, DB states, chain verification captured
- **Unified Trace**: End-to-end lineage for every transaction
- **CA Workflow**: Month/Quarter/Annual close procedures
- **Financial Periods**: Period management with close checklists

### Layer 5: Integration
- **TANTRA Runtime**: Health, events, lifecycle participation
- **TANTRA Execution Chain**: Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
- **SETU Pipeline**: Normalizer → Validator → Mapper → Serializer → Dispatch → Ack → Retry → Evidence
- **SETU Dispatch**: Full lifecycle with HMAC webhook verification, idempotency, dead-letter
- **Sampada Adapter**: Artha signal → Sampada SetuSignalIngest envelope mapping
- **Tally Compatibility**: Import/Export vouchers, masters, opening balances
- **Multi-Company**: Consolidated reporting, branch accounting, CostCentre tracking

### Layer 6: Governance
- **Capability Registry**: 10 capability contracts, 34 route prefixes mapped
- **Policy Engine**: Runtime enforcement with deterministic ALLOW/DENY decisions
- **Provenance Chain**: Immutable, append-only, hash-linked governance decision chain
- **Decision Ledger**: Append-only governance decisions with hash chain
- **Lineage Anchoring**: Bucket storage and MDU lineage references
- **Deterministic Replay**: SHA-256 hash-verified replay of all operations
- **Circuit Breakers**: 6 configurable breakers with fault isolation
- **Independent Verification**: 10 BHIV compliance verification tests
- **Adversarial Testing**: 12 adversarial attack vectors

### Layer 7: Observability
- **Health Endpoints**: Liveness, readiness, detailed health
- **Metrics**: Prometheus-compatible metrics
- **Dashboard**: Real-time system health visualization
- **Evidence Automation**: Auto-generated runtime evidence
- **Traceability**: Cross-service trace reconstruction

## Data Flow
```
Transaction → Journal Entry → Ledger Entry → Hash Chain → Audit Event → Runtime Proof
     ↓              ↓              ↓              ↓              ↓              ↓
  Trace Init    Validation    Balance Update   Integrity    Immutable Log   Evidence
                                                                 ↓
                                                      SETU Pipeline → TANTRA Chain
                                                                 ↓
                                                     Decision Ledger + Provenance
                                                                 ↓
                                                     Unified Trace + Runtime Proof
```

## Service Dependencies
- **Ledger Service** → Chart of Accounts, Account Balance, Journal Entry, Ledger Entry, Cache Service
- **Invoice Service** → Ledger Service, GST Engine, Cache Service
- **Expense Service** → Ledger Service, GST Engine, Cache Service
- **Banking Service** → Ledger Service, Audit Service, Traceability
- **BankStatement Service** → Reconcile Record, Ledger Service
- **CA Workflow Service** → Ledger Service, Financial Period, Audit Service
- **Tally Service** → Chart of Accounts, Journal Entry, Invoice, Expense
- **Multi-Company Service** → Company, Chart of Accounts, Account Balance, CostCentre
- **TANTRA Service** → Unified Trace, Runtime Proof, Compliance Signal
- **TANTRA Execution Chain** → Decision Ledger, Provenance Block, Lineage Anchor
- **SETU Dispatch Service** → SETU Pipeline, Sampada Adapter, SetuDispatch Model
- **SETU Pipeline** → Normalizer → Validator → Mapper → Serializer (pure functions)
- **Observability Service** → All models for health checks
- **Evidence Service** → Runtime Proof, Unified Trace
- **Performance Service** → Request timing, memory monitoring
- **Cache Service** → Redis with graceful degradation
- **Database Service** → Connection management, query optimization
- **OCR Service** → Tesseract.js for receipt text extraction
- **PDF Service** → PDF generation for reports and invoices
- **Signal Engine** → Ledger balances for financial intelligence
- **Smart Upload** → Document upload with OCR
- **Traceability Service** → Cross-service trace reconstruction
- **Capability Registry** → 10 capability contracts
- **Policy Engine** → Runtime enforcement
- **Provenance Chain** → Immutable governance decisions
- **Deterministic Replay** → SHA-256 hash verification
- **Circuit Breaker** → Fault isolation
- **Independent Verifier** → BHIV compliance verification
- **Deployment Evidence** → Evidence generation for deployment scenarios
- **Adversarial Suite** → Security attack vectors
- **Decision Ledger** → Append-only governance decisions
- **Lineage Service** → Entity anchoring, bucket/MDU references

## External Integrations
- **SETU**: Government compliance dispatch with full lifecycle (normalize → validate → map → dispatch → ack → retry → evidence)
- **TANTRA**: Runtime ecosystem participation with 8-stage execution chain
- **Sampada**: External runtime adapter (SetuSignalIngest envelope)
- **Tally**: Accounting software interoperability (import/export)
- **Payment Gateways**: NEFT/RTGS/UPI/IMPS processing
- **MongoDB 7+**: Primary data store with optional replica set
- **Redis 7+**: Optional caching with graceful degradation
