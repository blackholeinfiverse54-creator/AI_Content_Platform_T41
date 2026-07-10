# ARTHA Layer Classification

## Classification Matrix

| Layer | Component | Authority | Dependencies | Failure Impact |
|-------|-----------|-----------|--------------|----------------|
| **Transaction** | Invoice Service | Business | None | Revenue loss |
| **Transaction** | Expense Service | Business | None | Expense tracking loss |
| **Transaction** | Banking Service | Financial | Ledger, Audit, Traceability | Payment failures |
| **Transaction** | Bank Statement Service | Financial | Reconcile Record | Reconciliation failure |
| **Transaction** | TDS Lifecycle Service | Regulatory | Expense, Ledger | TDS deduction failure |
| **Transaction** | Cost Centre Service | Business | Chart of Accounts | Departmental tracking loss |
| **Ledger** | Ledger Service | Accounting | Chart of Accounts, Account Balance | Accounting integrity loss |
| **Ledger** | Journal Engine | Accounting | None | Double-entry failure |
| **Ledger** | Financial Reports Service | Accounting | Ledger, Invoice, Expense | Reporting failure |
| **Ledger** | Chart of Accounts Service | Accounting | None | Account structure loss |
| **Compliance** | GST Service | Regulatory | Invoice, Ledger | Filing failures |
| **Compliance** | TDS Service | Regulatory | Expense, Ledger | TDS non-compliance |
| **Compliance** | GST Statutory Service | Regulatory | Journal Entry, GST Details | Statutory filing failure |
| **Compliance** | TDS Statutory Service | Regulatory | TDSEntry, TDSChallan | Form 26Q/24Q failure |
| **Compliance** | Compliance Validation Service | Regulatory | Compliance Filing | Validation audit loss |
| **Compliance** | Compliance Signal Service | Regulatory | Compliance Validation Log | Signal emission failure |
| **Audit** | Audit Service | Legal | None | Compliance risk |
| **Audit** | Evidence Service | Operational | Runtime Proof, Unified Trace | Proof generation loss |
| **Audit** | Evidence Automation Service | Operational | Runtime Proof, Unified Trace | Auto-evidence failure |
| **Audit** | CA Workflow Service | Financial | Ledger, Financial Period, Audit | Close procedure failure |
| **Audit** | Financial Period Service | Financial | None | Period management failure |
| **Integration** | TANTRA Service | Ecosystem | None | Ecosystem disconnect |
| **Integration** | TANTRA Execution Chain | Ecosystem | Decision Ledger, Provenance Block | Execution chain failure |
| **Integration** | SETU Pipeline | Government | Compliance, Sampada Adapter | Filing dispatch failure |
| **Integration** | SETU Dispatch Service | Government | SETU Pipeline, SetuDispatch Model | Dispatch lifecycle failure |
| **Integration** | Sampada Adapter | External | None | Envelope mapping failure |
| **Integration** | Tally Service | Business | Chart, Journal, Invoice, Expense | Migration failure |
| **Integration** | Multi-Company Service | Business | Company, Chart of Accounts, CostCentre | Consolidation failure |
| **Governance** | Capability Registry | BHIV | None | Capability boundary loss |
| **Governance** | Policy Engine | BHIV | Capability Registry | Enforcement failure |
| **Governance** | Provenance Chain | BHIV | None | Governance chain loss |
| **Governance** | Decision Ledger | BHIV | None | Decision recording loss |
| **Governance** | Lineage Service | BHIV | Lineage Anchor | Lineage tracking loss |
| **Governance** | Deterministic Replay | BHIV | Provenance Chain | Replay verification loss |
| **Governance** | Circuit Breaker | BHIV | None | Fault isolation loss |
| **Governance** | Independent Verifier | BHIV | Capability Registry | Compliance verification loss |
| **Governance** | Deployment Evidence | BHIV | Runtime Proof | Deployment evidence loss |
| **Governance** | Adversarial Suite | BHIV | None | Security testing loss |
| **Observability** | Health Service | Operations | All components | Monitoring blind spot |
| **Observability** | Metrics Service | Operations | None | Metrics loss |
| **Observability** | Performance Service | Operations | None | Performance monitoring loss |
| **Observability** | Observability Service | Operations | All models | System health loss |
| **Observability** | Traceability Service | Operations | Unified Trace, Runtime Proof | Cross-service trace loss |
| **Infrastructure** | Auth Service | Security | User model | Authentication failure |
| **Infrastructure** | Cache Service | Performance | Redis | Caching degradation |
| **Infrastructure** | Cache Invalidation | Performance | Cache Service | Stale data serving |
| **Infrastructure** | Database Service | Data | MongoDB | Data persistence failure |
| **Infrastructure** | OCR Service | Document | Tesseract.js | Receipt text extraction loss |
| **Infrastructure** | PDF Service | Document | None | PDF generation loss |
| **Infrastructure** | Smart Upload Service | Document | OCR Service | Document processing failure |
| **Infrastructure** | Signal Engine | Intelligence | Ledger balances | Financial intelligence loss |
| **Infrastructure** | Runtime Proof Service | Evidence | Runtime Proof | Evidence capture loss |

## Upstream Systems
- User Input (Invoices, Expenses, Payments)
- Bank Statements (CSV upload, PDF parsing)
- Tally (Import/Export)
- SETU (Government filings)
- TANTRA (Runtime events, execution chain)
- Sampada (External runtime adapter)

## Downstream Systems
- MongoDB (Data persistence, 35 models)
- Redis (Caching with graceful degradation)
- SETU (Filing dispatch with full lifecycle)
- TANTRA (8-stage execution chain)
- Decision Ledger (Append-only governance decisions)
- Provenance Chain (Immutable governance chain)
- Lineage Anchor (Bucket and MDU references)
- PDF Generation (Reports)
- Audit Events (Immutable audit trail)
- Runtime Proof (Verifiable evidence)
- Unified Trace (End-to-end trace)

## Authority Boundaries
1. **Financial**: Ledger Service controls all financial integrity
2. **Compliance**: GST/TDS services control regulatory filings
3. **Audit**: Audit Service controls immutable logging
4. **Operational**: Observability controls health monitoring
5. **Ecosystem**: TANTRA controls runtime participation
6. **Governance**: Capability Registry controls authority boundaries
7. **Security**: Policy Engine controls runtime enforcement
8. **Evidence**: Evidence Automation controls runtime proof generation
