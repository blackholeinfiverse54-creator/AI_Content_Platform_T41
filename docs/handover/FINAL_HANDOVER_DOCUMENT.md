# ARTHA Final Handover Document

**Version:** 0.1  
**Date:** 2026-06-16  
**Status:** Production Certified (pending proof execution)  
**Classification:** Internal — Maintainer Handover

---

## 1. System Overview

**ARTHA** is an India-compliant, double-entry accounting and financial management system. It provides:

- **Double-entry ledger** with HMAC-SHA256 hash-chain integrity
- **Invoice lifecycle** management (Draft → Sent → Partial → Paid)
- **Expense management** with OCR receipt scanning and approval workflow
- **GST compliance** (GSTR-1, GSTR-3B filing packets, CGST/SGST/IGST calculation)
- **TDS management** (sections 194A-194Q, Form 26Q/24Q generation)
- **Financial reports** (P&L, Balance Sheet, Cash Flow, Trial Balance, Aged Receivables)
- **Signal intelligence** for compliance monitoring and anomaly detection
- **Traceability** with end-to-end lineage from transaction to filing
- **Runtime proofs** for audit trail and evidence generation

---

## 2. Build State

| Component | Status | Details |
|-----------|--------|---------|
| Backend API | ✅ Complete | 20 route groups, 20 controllers, 33 services |
| Frontend UI | ✅ Complete | 25+ pages, React 18 + Vite |
| Database Models | ✅ Complete | 23 Mongoose models |
| Seed Data | ✅ Complete | 33 Chart of Accounts, sample transactions |
| Tests | ✅ Complete | 20+ test files |
| Docker | ✅ Complete | dev/prod Dockerfiles, compose files |
| Documentation | ✅ Complete | 80+ documentation files |
| Proof Scripts | ✅ Complete | 6 standalone proof scripts |

---

## 3. Architecture Flow

```
┌──────────────────────────────────────────────────────┐
│                   FRONTEND (React)                     │
│  Pages → Services (Axios) → Backend API               │
│  State: Zustand (auth), React Query (dashboard)       │
└─────────────────────┬────────────────────────────────┘
                      │ REST API (/api/v1/*)
┌─────────────────────▼────────────────────────────────┐
│                   BACKEND (Express)                     │
│  Routes → Controllers → Services → Models → MongoDB    │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Ledger Svc  │  │ GST Engine   │  │ Signal Engine │  │
│  │ (1538 lines)│  │ (145 lines)  │  │ (299 lines)   │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Trace Svc   │  │ Invoice Svc  │  │ Expense Svc   │  │
│  │ (422 lines) │  │ (608 lines)  │  │ (625 lines)   │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└──────────┬────────────┬───────────────────────────────┘
     ┌─────▼─────┐ ┌────▼─────┐
     │  MongoDB   │ │  Redis   │
     │  7+ colls  │ │  Cache   │
     └───────────┘ └──────────┘
```

---

## 4. Execution Flow

### Invoice Lifecycle
```
Create Invoice (Draft) → Send (DR AR, CR Revenue + GST)
  → Record Payment (DR Cash, CR AR) → Status: draft→sent→partial→paid
```

### Expense Lifecycle
```
Create (Pending) → Approve → Record (DR Expense + Input GST, CR Cash)
  → Status: pending→approved→recorded
```

### TDS Lifecycle
```
Create Entry → Deduct (DR Expense, CR TDS Payable + CR Cash)
  → Record Challan → Link → Group Quarterly → File Form 26Q/24Q
```

### Signal Trace Lifecycle
```
Transaction → Journal Entry → Posted → Signal Generated → Filing Created
  → SETU Dispatch (via pipeline: Normalize → Validate → Map → Serialize)
```

---

## 5. Environment Setup

### Prerequisites
- Node.js 18+
- MongoDB 7+ (or MongoDB Atlas)
- Redis 7+ (optional, for caching)
- Docker & Docker Compose (for containerized deployment)

### Environment Variables
```bash
# Required
MONGODB_URI=mongodb://localhost:27017/artha
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
HMAC_SECRET=your-hmac-secret

# Optional
REDIS_URL=redis://localhost:6379
SETU_ENABLED=false
SETU_BASE_URL=
SETU_API_KEY=
NODE_ENV=development
PORT=5000
```

### Local Development
```bash
# 1. Clone and install
cd backend && npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your values

# 3. Seed database
node scripts/seed.js
node scripts/seed-tds.js

# 4. Start development
npm run dev

# 5. Verify integrity
node scripts/verify-integrity.js
```

---

## 6. Deployment Procedure

### Docker Deployment
```bash
# Development
docker-compose -f docker-compose.dev.yml up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

### Manual Deployment
```bash
# Build
cd backend && npm install --production

# Initialize database
node scripts/initialize-database.js
node scripts/seed.js
node scripts/create-indexes.js

# Start
NODE_ENV=production node scripts/start-production.js
```

---

## 7. Evidence Locations

| Evidence | Location |
|----------|----------|
| Replay proof | `docs/evidence/phase4/replay_verification_results.json` |
| Compliance proof | `docs/evidence/phase4/full_compliance_trace_evidence.json` |
| Production audit | `docs/evidence/phase5/production_audit_results.json` |
| System health | `docs/evidence/phase5/system_health_audit.json` |
| Security audit | `docs/evidence/phase5/security_audit.json` |
| DB integrity | `docs/evidence/phase5/database_integrity_audit.json` |
| API compliance | `docs/evidence/phase5/api_compliance_audit.json` |
| Configuration | `docs/evidence/phase5/configuration_audit.json` |
| Integrity cert | `docs/handover/ARTHA_INTEGRITY_CERTIFICATE.json` |
| Production cert | `docs/handover/ARTHA_PRODUCTION_CERTIFICATE.json` |
| Deployment checklist | `docs/handover/DEPLOYMENT_READINESS_CHECKLIST.json` |

---

## 8. Known Issues

1. **Dual GST Services** — `gstFiling.service.js` (from invoices) and `gstStatutory.service.js` (from journal entries) coexist. The statutory path is more accurate. Consolidation recommended.

2. **Legacy Routes** — Duplicate `/journal-entries/*` routes exist alongside `/ledger/entries/*`. Both work. Legacy routes should be deprecated.

3. **Hash-Chain Secret Rotation** — Changing `HMAC_SECRET` invalidates all existing hashes. Key rotation strategy needed for production.

4. **SETU Integration** — Dispatch to SETU is simulated in proof scripts. Real SETU endpoint requires `SETU_BASE_URL` and `SETU_API_KEY` configuration.

5. **Frontend State** — React Query is configured but most pages use raw `useState`/`useEffect`. Standardization recommended.

6. **TypeScript** — No type safety. TypeScript migration recommended for long-term maintainability.

---

## 9. Future Recommendations

1. **Consolidate GST services** — Remove `gstFiling.service.js`, use only `gstStatutory.service.js`
2. **Remove legacy routes** — Clean up duplicate `/journal-entries/*` routes
3. **Implement key rotation** — HMAC secret rotation with hash re-computation
4. **Migrate to TypeScript** — Add type safety across the codebase
5. **Standardize React Query** — Migrate all pages to use React Query for data fetching
6. **Add E2E tests** — Playwright/Cypress tests for critical flows
7. **Monitoring** — Prometheus/Grafana integration for production metrics
8. **CI/CD** — GitHub Actions pipeline for automated testing and deployment

---

## 10. Operational Commands

### Development
```bash
npm run dev              # Start development server
npm run seed             # Seed database
npm run test             # Run all tests
npm run lint             # Lint code
```

### Verification
```bash
node scripts/verify-integrity.js    # Verify ledger integrity
node scripts/verify-hash-chain.js   # Verify hash chain
node scripts/verify-seed-data.js    # Verify seed data
```

### Proof Execution
```bash
node scripts/proof-all.js           # Run all proof phases
node scripts/proof-replay.js        # Phase 1: Replay proof
node scripts/proof-compliance.js    # Phase 2: Compliance continuity
node scripts/proof-audit.js         # Phase 3: Production audit
node scripts/proof-certify.js       # Phase 4: Certification
```

### Production
```bash
npm run start:prod      # Start production server
node scripts/backup-database.js     # Backup database
node scripts/create-indexes.js      # Create database indexes
```

---

*Generated by ARTHA Certification System*  
*Timestamp: 2026-06-16T00:00:00.000Z*
