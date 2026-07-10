# ARTHA v0.1 - BHIV Ecosystem Production Runtime Participant

[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18+-blue.svg)](https://reactjs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7+-green.svg)](https://www.mongodb.com/)
[![Integrity](https://img.shields.io/badge/Integrity-Verified-brightgreen.svg)]()
[![Governance](https://img.shields.io/badge/Governance-Enforced-blue.svg)]()
[![BHIV](https://img.shields.io/badge/BHIV-Ecosystem-Integrated-green.svg)]()

**ARTHA** is a comprehensive, India-compliant accounting and financial management system built on modern web technologies with full double-entry bookkeeping integrity. It operates as a governed runtime participant within the BHIV ecosystem with deterministic execution, replayability, observability, and authority enforcement.

## 🎯 Key Features

### ✅ Core Accounting
- **Double-Entry Ledger**: HMAC-chain verified, tamper-proof ledger system with Decimal.js precision
- **Hash-Chain Verification**: Full ledger integrity checking with entry-by-entry verification
- **Financial Reports**: P&L with monthly trends, Balance Sheet, Cash Flow, Trial Balance, Aged Receivables
- **Dashboard**: Real-time KPIs with Revenue vs Expenses charts and Expense Breakdown
- **Chart of Accounts**: 33 pre-configured accounts following Indian accounting standards
- **Account Balances**: Real-time balance calculation from posted journal entries

### ✅ India Compliance
- **GST Integration**:
  - Real-time GST dashboard with 6-month trends
  - GSTR-1 filing packet (outward supplies)
  - GSTR-3B filing packet (tax summary & reconciliation)
  - IGST / CGST+SGST calculation
  - B2B/B2C categorization
  - Filing-ready JSON/CSV export
  - Quarterly due date tracking

- **TDS Management**:
  - Section-wise tracking (194A, 194C, 194H, 194I, 194J, 192, 194Q)
  - Quarterly dashboard with Form 24Q/26Q/27Q status
  - Automatic journal entry creation on deduction
  - Challan recording and reconciliation
  - Status workflow: Pending → Deducted → Deposited → Filed

- **Multi-Year Support**: Multiple financial years with FY-based reporting

### ✅ Invoice Management
- Invoice lifecycle: Draft → Sent → Partial → Paid → Cancelled
- Automatic journal entry creation on send:
  - DR Accounts Receivable (1100)
  - CR Revenue (4000)
  - CR GST Payable (2200)
- Payment recording with automatic journal entries:
  - DR Cash/Bank (1010)
  - CR Accounts Receivable (1100)
- Tax calculation per line item with IGST/CGST+SGST support
- Payment tracking with partial payment support
- Customer GSTIN validation for B2B transactions

### ✅ Expense Management
- Expense approval workflow: Pending → Approved → Recorded → Rejected
- **OCR Receipt Scanning**: Extract vendor, date, amount, tax from receipt images
- Automatic expense-to-ledger posting:
  - DR Expense Account (6xxx)
  - CR Cash/Bank (1010)
- Category tracking with real-time breakdown charts
- Multi-receipt upload support
- Input GST credit tracking

### ✅ Production Features
- **Hash-Chain Ledger**: Every entry linked with HMAC-SHA256 for audit trail
- **Accounting Integrity**: Verified double-entry system (Debits = Credits)
- **Real-time Calculations**: All reports calculated from posted journal entries
- **Redis Caching**: Response caching and session management
- **Docker Deployment**: Multi-container production setup
- **Health Checks**: Liveness, readiness, and detailed health endpoints
- **Backup & Restore**: Automated MongoDB backups with recovery scripts
- **Monitoring**: Real-time system health dashboard
- **Performance Optimization**: Database indexing and query optimization

### ✅ BHIV Ecosystem Integration
- **Capability Registry**: Canonical single source of truth for capability contracts (10 capability contracts)
- **Policy Engine**: Runtime enforcement with deterministic ALLOW/DENY decisions
- **Provenance Chain**: Immutable, append-only, hash-linked governance decision chain
- **Deterministic Replay**: Replay system with SHA-256 hash verification for 100% reproducibility
- **Circuit Breakers**: 6 configurable breakers (mongodb, redis, setu_api, tantra_runtime, ocr_service, evidence_pipeline)
- **Independent Verification**: 10 independent verification tests for BHIV compliance
- **Deployment Evidence**: Complete evidence generation for 9 deployment scenarios
- **Adversarial Testing**: 12 genuine adversarial attack vectors for security validation
- **Decision Ledger**: Append-only, hash-chained governance decision recording
- **Lineage Anchoring**: Bucket storage and MDU lineage references
- **Governance API**: 30+ endpoints under `/api/v1/governance/`

### ✅ SETU & TANTRA Integration
- **SETU Pipeline**: Signal normalization, validation, mapping, serialization, dispatch, acknowledgement, retry
- **Sampada Adapter**: Artha signal → Sampada SetuSignalIngest envelope mapping
- **TANTRA Execution Chain**: Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
- **TANTRA Runtime**: Registration, heartbeat, event emission, health monitoring
- **SETU Dispatch**: Full lifecycle with retry, dead-letter, idempotency, HMAC webhook verification

### ✅ Security
- JWT authentication with refresh tokens
- Role-based access control (admin, accountant, user, viewer)
- Audit logging for all actions
- Input validation and sanitization
- CORS protection
- Helmet security headers
- Rate limiting
- Non-root Docker containers

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- MongoDB 7+
- Redis 7+

### Development Setup

1. **Clone repository**:
```bash
git clone <repo-url>
cd artha
```

2. **Setup environment**:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

3. **Start development stack**:
```bash
docker-compose -f docker-compose.dev.yml up -d
```

4. **Seed database**:
```bash
cd backend
node scripts/seed.js
node scripts/seed-tds.js
```

5. **Verify integrity**:
```bash
node scripts/verify-integrity.js
```

6. **Git Commands**:
```bash
git status
git add -A
git commit -m "your message"
git pull origin main && git pull collaborator main
git push origin main && git push collaborator main
```

7. **Access application**:
- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- Adminer: http://localhost:8080

### Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.

For Pravah deployment, see [docs/PRAVAH_DEPLOYMENT.md](docs/PRAVAH_DEPLOYMENT.md).

## 📊 API Documentation

### Authentication
```bash
# Register
POST /api/v1/auth/register
Body: { email, password, name }

# Login
POST /api/v1/auth/login
Body: { email, password }

# Refresh Token
POST /api/v1/auth/refresh
Body: { refreshToken }
```

### Ledger
```bash
# Get all entries
GET /api/v1/ledger/entries

# Create entry
POST /api/v1/ledger/entries
Body: { date, description, lines }

# Verify chain integrity
GET /api/v1/ledger/verify-chain

# Verify single entry
GET /api/v1/ledger/entries/:id/verify

# Get chain segment
GET /api/v1/ledger/chain-segment?startPosition=0&endPosition=100
```

### Invoices
```bash
# Get all invoices
GET /api/v1/invoices

# Create invoice
POST /api/v1/invoices
Body: { invoiceDate, dueDate, customerName, lines }

# Send invoice
POST /api/v1/invoices/:id/send

# Record payment
POST /api/v1/invoices/:id/payment
Body: { amount, paymentMethod, reference }
```

### Expenses
```bash
# Get all expenses
GET /api/v1/expenses

# Create expense
POST /api/v1/expenses
Body: { date, vendor, category, amount, taxAmount }

# Process OCR
POST /api/v1/expenses/ocr
Body: FormData with receipt file

# Approve expense
POST /api/v1/expenses/:id/approve

# Record expense
POST /api/v1/expenses/:id/record
```

### GST Filing
```bash
# Get GST summary
GET /api/v1/gst/summary?period=2025-02

# Get GSTR-1 packet
GET /api/v1/gst/filing-packet/gstr-1?period=2025-02

# Get GSTR-3B packet
GET /api/v1/gst/filing-packet/gstr-3b?period=2025-02

# Export filing packet
GET /api/v1/gst/filing-packet/export?type=gstr-1&period=2025-02
```

### TDS Management
```bash
# Get TDS Dashboard
GET /api/v1/tds/dashboard?quarter=Q4&financialYear=FY2025-26

# Get TDS Entries
GET /api/v1/tds/entries?quarter=Q4&financialYear=FY2025-26

# Create TDS Entry
POST /api/v1/tds/entries
Body: { deductee: { name, pan }, section, paymentAmount, tdsRate }

# Record TDS Deduction
POST /api/v1/tds/entries/:id/deduct

# Record Challan
POST /api/v1/tds/entries/:id/challan
Body: { challanNumber, challanDate, bankBSR }

# Generate Form 26Q
GET /api/v1/tds/form26q?quarter=Q4&financialYear=FY2025-26

# Calculate TDS
POST /api/v1/tds/calculate
Body: { amount, section, customRate }
```

### Reports
```bash
# Profit & Loss
GET /api/v1/reports/profit-loss?startDate=2025-01-01&endDate=2025-12-31

# Balance Sheet
GET /api/v1/reports/balance-sheet?asOfDate=2025-12-31

# Cash Flow
GET /api/v1/reports/cash-flow?startDate=2025-01-01&endDate=2025-12-31

# Trial Balance
GET /api/v1/reports/trial-balance?asOfDate=2025-12-31

# Aged Receivables
GET /api/v1/reports/aged-receivables?asOfDate=2025-12-31

# Dashboard Summary
GET /api/v1/reports/dashboard

# Revenue vs Expenses Chart
GET /api/v1/reports/revenue-expenses-chart?year=2025

# Expense Breakdown
GET /api/v1/reports/expense-breakdown?startDate=2025-01-01&endDate=2025-12-31
```

### Health & Monitoring
```bash
# Basic health
GET /health

# Detailed health
GET /health/detailed

# Readiness probe
GET /ready

# Liveness probe
GET /live
```

### BHIV Governance API (30+ Endpoints)
```bash
# Capability Registry
GET    /api/v1/governance/capabilities                  # List all capabilities
GET    /api/v1/governance/capabilities/:capabilityId    # Get specific capability
GET    /api/v1/governance/capabilities/verify           # Verify all contracts
GET    /api/v1/governance/capabilities/resolve          # Resolve route to capability

# Provenance Chain
GET    /api/v1/governance/provenance/status             # Get chain state + integrity
GET    /api/v1/governance/provenance/verify             # Verify chain integrity

# Deterministic Replay
GET    /api/v1/governance/replay/statistics             # Get replay statistics
GET    /api/v1/governance/replay/:replayId              # Get replay data
GET    /api/v1/governance/replay/:replayId/proof        # Generate replay proof
POST   /api/v1/governance/replay/:replayId/verify       # Verify replay
GET    /api/v1/governance/replay/distributed/:replayId  # Get distributed replay
POST   /api/v1/governance/replay/distributed/:replayId/verify  # Verify distributed

# Circuit Breakers
GET    /api/v1/governance/circuit-breakers              # Get all breaker states
POST   /api/v1/governance/circuit-breakers/:name/reset  # Reset breaker

# Independent Verification
GET    /api/v1/governance/verification/run              # Run verification suite
GET    /api/v1/governance/verification/history          # Get verification history

# Adversarial Testing
GET    /api/v1/governance/adversarial/run               # Run adversarial suite
GET    /api/v1/governance/adversarial/history           # Get test history

# Deployment Evidence
GET    /api/v1/governance/evidence/manifest             # Generate manifest
GET    /api/v1/governance/evidence/:category            # Get evidence by category

# Decision Ledger
GET    /api/v1/governance/decision-ledger/history       # Decision history
GET    /api/v1/governance/decision-ledger/stats         # Decision statistics
GET    /api/v1/governance/decision-ledger/verify        # Verify chain integrity

# Lineage
GET    /api/v1/governance/lineage/stats                 # Lineage statistics
GET    /api/v1/governance/lineage/entity/:type/:id      # Entity lineage
GET    /api/v1/governance/lineage/trace/:traceId        # Trace lineage
GET    /api/v1/governance/lineage/verify/:traceId       # Verify trace lineage

# SETU Dispatch
GET    /api/v1/governance/setu/stats                    # Dispatch statistics
GET    /api/v1/governance/setu/dispatch/:dispatchId     # Get dispatch
GET    /api/v1/governance/setu/trace/:traceId           # Get dispatches by trace
POST   /api/v1/governance/setu/retry/:dispatchId        # Retry dispatch

# System Status
GET    /api/v1/governance/status                        # Comprehensive governance status
```

## 🔄 Data Flow & Integrity

### Transaction → Signal → SETU Chain
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
ComplianceSignal (emitted)
  │  SignalEngineService evaluates ledger snapshot
  │  → SIG_CASHFLOW_NEGATIVE, SIG_INVOICE_OVERDUE, etc.
  ▼
SETU Pipeline (setu.pipeline.js)
  │  Normalizer → Validator → Mapper → Serializer
  │  → setuDispatch.service.js dispatches signal
  │  → SetuDispatch record created (INITIATED → SENT → ACCEPTED/REJECTED)
  │  → Retry with exponential backoff (max 3 attempts)
  │  → Dead letter on exhausted retries
  ▼
TANTRA Execution Chain (tantraExecutionChain.service.js)
  │  Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
  │  → provenanceChain.recordDeployment()
  │  → decisionLedger.recordDecision()
  │  → lineage.anchorToBucket()
  ▼
UnifiedTrace (end-to-end)
  │  stages: TRANSACTION_CREATED → JOURNAL_CREATED → JOURNAL_VALIDATED → JOURNAL_POSTED
  │          → SIGNAL_GENERATED → FILING_CREATED → SETU_DISPATCHED → SETU_ACKNOWLEDGED → CONFIRMED
  ▼
RuntimeProof (evidence capture)
  │  API responses, DB states, chain verification, SETU dispatch attempts
  ▼
ProvenanceBlock (governance chain)
  │  hash-linked, append-only governance decision record
```

## ✅ Integrity Verification

Run the integrity verification script:
```bash
cd backend
node scripts/verify-integrity.js
```

This verifies:
- ✓ All sent invoices have journal entries
- ✓ All paid invoices have payment entries
- ✓ Accounting equation: Debits = Credits
- ✓ Account balances match journal entries
- ✓ GST calculations match invoice data
- ✓ Reports pull from real-time data

## 🏗️ Architecture

### Backend Stack
- **Node.js 18+** with Express.js
- **MongoDB 7+** with Mongoose ODM (35 models)
- **Redis 7+** for caching
- **Decimal.js** for precise financial calculations
- **HMAC-SHA256** for ledger hash-chain
- **JWT** for authentication
- **47 Services** — Core accounting, compliance, BHIV governance, integration, runtime, infrastructure
- **26 Controllers** — Request handlers for all API endpoints
- **27 Route Files** — RESTful API routing
- **11 Middleware** — Auth, authority enforcement, policy engine, security, monitoring, caching

### Frontend Stack
- **React 18+** with Vite
- **Recharts** for data visualization
- **Tailwind CSS** for styling
- **React Router** for navigation
- **Axios** for API calls

### Database Models (35)

**Core Accounting (8):**
1. User — Authentication, roles (admin/accountant/viewer), bcrypt passwords
2. ChartOfAccounts — Account hierarchy (Asset/Liability/Equity/Income/Expense), 33+ pre-seeded
3. JournalEntry — Double-entry with HMAC-SHA256 hash-chain, audit trail, GST details
4. LedgerEntry — Flat debit/credit lines with SHA-256 chain linking
5. AccountBalance — Running balance per account (debitTotal, creditTotal, balance)
6. Invoice — Full lifecycle: draft→sent→partial→paid→cancelled, GST breakdown
7. Expense — Approval workflow: pending→approved→recorded, OCR receipt support
8. Payment — NEFT/RTGS/UPI/IMPS with retry, reconciliation, bank details

**Compliance (7):**
9. TDSEntry — TDS deduction tracking (194A/C/H/I/J/Q, 192), challan, Form 26AS
10. TDSChallan — TDS deposit challan records
11. TDSQuarterlyGroup — Quarterly TDS grouping for Form 26Q/24Q
12. TDSValidationLog — TDS filing validation audit
13. GSTReturn — GSTR-1/GSTR-3B filing records
14. ComplianceFiling — Structured filing packets with sourceTransactions[]
15. ComplianceValidationLog — Per-filing validation errors with severity

**Audit & Traceability (4):**
16. AuditLog — Action audit trail
17. AuditEvent — Hash-chained audit events with before/after state
18. UnifiedTrace — End-to-end trace: TRANSACTION_CREATED → SETU_DISPATCHED → CONFIRMED
19. RuntimeProof — Verifiable evidence: API responses, DB states, chain verification

**BHIV Governance (4):**
20. ProvenanceBlock — Immutable governance decision chain (hash-linked)
21. DecisionLedger — Append-only governance decisions (ALLOW/DENY/WARN/BLOCK)
22. LineageAnchor — Bucket storage and MDU lineage references
23. ComplianceSignal — Persisted compliance signal records

**Integration (6):**
24. SetuDispatch — SETU dispatch lifecycle: pipeline→dispatch→ack→retry→evidence
25. BankStatement — Uploaded bank statements with parsed transactions
26. ReconcileRecord — Bank reconciliation records
27. Company — Multi-company: GSTIN, PAN, TAN, branch, consolidation
28. CompanySettings — Singleton company configuration
29. CostCentre — Cost centre/profit centre tracking

**Financial Period & Tally (3):**
30. FinancialPeriod — Month/quarter/year periods with close checklist
31. TallyExport — Tally ERP export records
32. TallyImport — Tally ERP import records

**Analytics (3):**
33. RLExperience — InsightFlow reinforcement learning buffer
34. InsightFlowExperience — User behavior analytics
35. JournalLine — (embedded in JournalEntry) individual debit/credit lines

### Key Services (47)

**Core Accounting (10):**
- Authentication Service — JWT login/signup, password hashing
- Ledger Service — Journal lifecycle, hash-chain, account balance updates, void/reversal
- Invoice Service — Invoice lifecycle → ledger posting with GST
- Expense Service — Expense lifecycle → ledger posting with approval
- TDS Service — TDS lifecycle → ledger posting, Form 26Q generation
- GST Engine Service — Pure GST calculation (IGST/CGST+SGST split)
- GST Service — GSTR-1/GSTR-3B generation (legacy)
- GST Filing Service — Statutory filing from journal gstDetails
- Financial Reports Service — P&L, Balance Sheet, Cash Flow, Trial Balance, Aged Receivables
- Chart of Accounts Service — Account management

**Compliance (5):**
- GST Statutory Service — GSTR-1/GSTR-3B from JournalEntry.gstDetails
- TDS Statutory Service — Form 26Q/Form 24Q from TDSEntry
- TDS Lifecycle Service — TDS deduction → deposit → filing workflow
- Compliance Validation Service — Filing validation → ComplianceValidationLog
- Compliance Signal Service — Signal emission from compliance checks

**BHIV Governance (9):**
- Capability Registry Service — Canonical capability contracts, route resolution
- Provenance Chain Service — Immutable governance decision chain
- Deterministic Replay Service — SHA-256 hash-verified replay system
- Circuit Breaker Service — 6 configurable breakers (CLOSED/OPEN/HALF_OPEN)
- Independent Verifier Service — 10 BHIV compliance verification tests
- Deployment Evidence Service — Evidence generation for 9 deployment scenarios
- Adversarial Suite Service — 12 adversarial attack vectors
- Decision Ledger Service — Append-only governance decision recording
- Lineage Service — Entity anchoring, bucket/MDU references, trace lineage

**Integration (11):**
- Banking Service — Bank data import and processing
- Bank Statement Service — Statement upload, parsing, transaction extraction
- Audit Service — Immutable audit event recording with hash-chain
- CA Workflow Service — Month/Quarter/Annual close procedures
- Tally Compatibility Service — Tally ERP import/export
- Multi-Company Service — Consolidated reporting, branch accounting
- Observability Service — System health, metrics, Prometheus
- Traceability Service — Cross-service trace reconstruction
- Evidence Automation Service — Auto-generated runtime evidence
- SETU Dispatch Service — Signal → normalize → validate → dispatch → ack → retry
- SETU Pipeline — Pure functions: Normalizer → Validator → Mapper → Serializer

**Runtime (6):**
- TANTRA Service — Registration, heartbeat, event emission
- TANTRA Execution Chain Service — Signal → Intelligence → Decision → Contract → Enforcement → Execution → Truth → Observability
- Sampada Adapter — Artha signal → Sampada SetuSignalIngest envelope
- Signal Engine Service — Ledger-based signal snapshot
- Smart Upload Service — Document upload with OCR
- Runtime Proof Service — Verifiable evidence capture

**Infrastructure (6):**
- Health Service — System health checks
- Performance Service — Request timing, memory monitoring
- Cache Service — Redis caching with invalidation
- Cache Invalidation Service — Targeted cache invalidation
- Database Service — Connection management, query optimization
- Export Service — PDF/Excel/CSV export

**Media (2):**
- OCR Service — Receipt image text extraction (Tesseract.js)
- PDF Service — PDF generation for reports and invoices

## 📊 Sample Data

After seeding, you'll have:
- **33 Chart of Accounts** (Assets, Liabilities, Equity, Income, Expenses)
- **Sample Invoices** with automatic journal entries
- **Sample Expenses** with approval workflow
- **6 TDS Entries** (Q4 FY2025-26)
- **Posted Journal Entries** maintaining double-entry integrity

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run specific tests
npm run test:ledger
npm run test:invoice
npm run test:gst
```

## 📝 License

Proprietary - BHIV Inc.

## 👥 Contributors

- **Nilesh** - Architecture & Coordination
- **Ishan** - InsightFlow & Compliance
- **Akash** - APIs & Integration
- **Development Team** - Full Stack Implementation

## 📞 Support

For issues and support:
- Create an issue on GitHub
- Email: support@artha.bhiv.in

---

**Last Updated**: July 10, 2026  
**Version**: 0.1  
**Status**: BHIV Ecosystem Production Participant ✓  
**Integrity**: Verified ✓  
**Governance**: Enforced ✓  
**BHIV Integration**: Complete ✓  
**SETU Pipeline**: Operational ✓  
**TANTRA Chain**: Operational ✓  
**Models**: 35 ✓  
**Services**: 47 ✓  
**Routes**: 27 ✓  
**Governance Endpoints**: 30+ ✓
