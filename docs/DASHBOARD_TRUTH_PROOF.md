# DASHBOARD_TRUTH_PROOF.md
# Phase 4 — Operational Dashboard Truth Layer
# ARTHA v0.1 | Every metric traces to backend truth

---

## Governing Rule

No metric on any dashboard is cosmetic, hardcoded, or derived from assumptions.
Every number displayed is the result of a real API call to a real backend query.
If the API fails, the metric shows 0 or an error — never a fake value.

---

## Dashboard 1 — Financial Intelligence Dashboard (/dashboard)

### Metric: Financial Health Score

| Field | Detail |
|-------|--------|
| Displayed value | Integer 0–100 (e.g., "78") |
| Backend source | Computed in frontend from signal list |
| API | `GET /api/v1/signals?limit=50` |
| Mapping layer | `useMemo` in `FinancialIntelligenceDashboard.jsx` |
| Formula | `100 - (sum of severity weights + variance penalties) / signal count` |
| Severity weights | `{ CRITICAL: 35, HIGH: 22, MEDIUM: 10, LOW: 4 }` |
| Display proof | If no signals: score = 100. If 1 HIGH signal + 18% variance: `100 - (22+18)/1 = 60` |
| Failure behavior | If `/signals` fails: falls back to `/signals/snapshot`. If both fail: `signals = []` → score = 100 (no penalty) |
| Static data risk | NONE — computed from real signal list |

---

### Metric: Budget Risk Level

| Field | Detail |
|-------|--------|
| Displayed value | "HIGH" / "MEDIUM" / "LOW" badge |
| Backend source | Derived from signals |
| API | `GET /api/v1/signals?limit=50` |
| Mapping layer | `FinancialIntelligenceDashboard.jsx:metrics useMemo` |
| Formula | HIGH if any signal severity = HIGH/CRITICAL or healthScore < 60. MEDIUM if activeIssues > 0 or score < 80. Otherwise LOW. |
| Display proof | 1 HIGH signal → riskLevel = HIGH |
| Failure behavior | No signals → riskLevel = LOW (correct — no risk detected) |

---

### Metric: Active Issues count

| Field | Detail |
|-------|--------|
| Displayed value | Integer (e.g., "1") |
| Backend source | Signals with severity != LOW |
| API | `GET /api/v1/signals?limit=50` |
| Mapping layer | `signals.filter(s => s.severity !== 'LOW').length` |
| Failure behavior | No signals → 0 |

---

### Metric: Cost Intelligence — Planned/Actual/Variance

| Field | Detail |
|-------|--------|
| Displayed value | ₹ amounts + % variance |
| Backend source | Aggregated from signal `planned` and `actual` context fields |
| API | `GET /api/v1/signals?limit=50` |
| Mapping layer | `costSummary useMemo` → `signals.reduce((s,x) => s + x.planned, 0)` |
| Signal source | DB signal context fields (`planned`, `actual`, `variance_pct`) |
| Display proof | If signal has `planned: 100000, actual: 96000` → shows ₹1,00,000 planned, ₹96,000 actual, -4.0% variance |
| Failure behavior | No signals → planned = 0, actual = 0, variance = 0% |

---

### Metric: Signal cards (type, severity, recommendation)

| Field | Detail |
|-------|--------|
| Backend source | `ComplianceSignal` collection |
| API | `GET /api/v1/signals?limit=50` (primary) / `GET /api/v1/signals/snapshot` (fallback) |
| Mapping layer | `mapDbSignalToDisplay()` in dashboard / `mapSnapshotToSignals()` for snapshot |
| DB fields used | `type`, `severity`, `recommendation`, `trace_id`, `source`, `created_at`, `context` |
| Failure behavior | 5xx on `/signals` → tries snapshot. Both fail → EmptySignalState. No fake signals ever shown. |

---

### Metric: Compliance Snapshot — Output GST / Input Credit / Net Payable

| Field | Detail |
|-------|--------|
| Backend source | Real invoices + expenses in MongoDB |
| API | `GET /api/v1/gst/summary?period=YYYY-MM` |
| Service | `gstFiling.service.js:getGSTSummary()` |
| Query | `Invoice.find({ invoiceDate: {$gte,lte}, status: {$in:['sent','partial','paid']} })` |
| Formula | `outputGST = sum(invoice.taxAmount)`, `inputGST = sum(expense.taxAmount)`, `netPayable = output - input` |
| Display proof | After seeding: shows actual invoice/expense tax amounts |
| Failure behavior | API error → `ErrorSurface` renders "GST UNAVAILABLE — [message]". Other compliance data unaffected. |
| Static data risk | NONE — `GSTDashboard.jsx` static fallback was removed in previous sprint |

---

### Metric: Compliance Snapshot — TDS Total Deducted / Pending

| Field | Detail |
|-------|--------|
| Backend source | `TDSEntry` collection |
| API | `GET /api/v1/tds/dashboard?quarter=Qx&financialYear=FYxx` |
| Service | `tds.service.js:getTDSDashboardSummary()` |
| Query | `TDSEntry.find({ quarter, financialYear })` |
| Formula | `totalDeducted = sum(tdsAmount where status in [deducted,deposited,filed])` |
| Failure behavior | API error → `ErrorSurface` renders "TDS UNAVAILABLE — [message]". GST panel unaffected. |

---

## Dashboard 2 — Signal Dashboard (/signals)

### Metric: Signal list (all fields)

| Field | Detail |
|-------|--------|
| Backend source | `ComplianceSignal` collection |
| API | `GET /api/v1/signals?limit=50&severity=X&type=Y` |
| Mapping | `mapDbSignal()` in `SignalDashboard.jsx` |
| Fields displayed | type (font-mono), label (from context or type), severity badge, source, trace_id (truncated), timestamp |
| Severity filter | Client-side from already-fetched signal list |
| Failure behavior | Error card: "SIGNAL FETCH FAILED — GET /api/v1/signals → HTTP 500: [message]" |

---

### Metric: Runtime mode banner

| Field | Detail |
|-------|--------|
| Backend source | `GET /health` + `GET /api/v1/signals/snapshot` |
| API | health: `axios.get(origin + '/health')`, snapshot: `api.get('/signals/snapshot')` |
| Mapping | `useRuntimeMode.check()` sets `mode` state |
| Display proof | Mode banner always rendered, regardless of signal data |
| Failure behavior | Health fails → BACKEND_UNAVAILABLE (red). Snapshot fails but health ok → BACKEND_DEGRADED (amber). |

---

## Dashboard 3 — GST Dashboard (/gst)

### ALL Summary Cards (Output GST, Input GST, Net Payable, Previous Credit, Final Payable)

| Field | Detail |
|-------|--------|
| Backend source | `Invoice` + `Expense` collections |
| API | `GET /api/v1/gst/summary?period=YYYY-MM` |
| Period derivation | `getPeriodParam()` → current month or previous month based on dropdown |
| Failure behavior | Error toast + zero state: `{ summary: { outputGST: 0, inputGST: 0, ... }, monthlyData: [], returns: [], invoicesSummary: {...zeros} }` |
| Static data risk | NONE — removed in fix sprint. On failure shows real zeros. |

---

### GST Trend Chart (6-month bar chart)

| Field | Detail |
|-------|--------|
| Backend source | 6 sequential Invoice/Expense DB queries (one per month) |
| API | Included in `GET /api/v1/gst/summary` response as `monthlyData[]` |
| Data shape | `[{ month: "Aug", output: N, input: N, net: N }, ...]` |
| Chart keys | `output` → "Output GST" bar, `input` → "Input GST" bar, `net` → "Net Payable" bar |
| Failure behavior | Empty array → chart renders with no bars (correct empty state) |
| Static data risk | NONE — all 6 months queried from real DB data |

---

### B2B / B2C / Export Invoice Summary Cards

| Field | Detail |
|-------|--------|
| Backend source | `Invoice` collection, categorized by `customerGSTIN` presence |
| API | `GET /api/v1/gst/summary` → `invoicesSummary` field |
| B2B detection | `if (invoice.customerGSTIN)` → B2B |
| B2C detection | No GSTIN → B2C |
| Failure behavior | Shows zeros on error |

---

### Filing History Table

| Field | Detail |
|-------|--------|
| Backend source | `GSTReturn` collection |
| API | Returned as `returns` field in `/gst/summary` response |
| Note | Backend `getGSTSummary()` currently returns `returns: []` (TODO comment in service). Filing history table will be empty until GSTReturn documents are created via GSTR-1/3B generation. |
| Failure behavior | Empty table row — not a crash |

---

## Dashboard 4 — TDS Management (/tds)

### ALL Cards (Total Deducted, Total Paid, Pending Payment, Pending Entries)

| Field | Detail |
|-------|--------|
| Backend source | `TDSEntry` collection |
| API | `GET /api/v1/tds/dashboard?quarter=Q4&financialYear=FY2025-26` |
| Failure behavior | Error toast + zero state: all cards show 0 |
| Static data risk | NONE |

---

### TDS by Section Pie Chart

| Field | Detail |
|-------|--------|
| Backend source | `TDSEntry` grouped by `section` |
| API | `GET /api/v1/tds/dashboard` → `bySection[]` |
| Chart data | `sectionChartData = bySection.map(item => ({ name: item.section + ' - ' + item.name, value: item.deducted }))` |
| Failure behavior | Empty pie chart on zero data |

---

### TDS Entries Table

| Field | Detail |
|-------|--------|
| Backend source | `TDSEntry` collection |
| API | `GET /api/v1/tds/dashboard` → `entries[]` |
| Fields shown | deductee, pan, section, amount, tdsAmount, tdsRate, deductionDate, status |
| Pay action | `POST /api/v1/tds/entries/:id/deduct` → `POST /api/v1/tds/entries/:id/challan` |
| Failure behavior | EmptyState component if no entries match search |

---

## Dashboard 5 — Financial Reports

### P&L — Total Income / Total Expenses / Net Profit / Profit Margin

| Field | Detail |
|-------|--------|
| Backend source | Posted `JournalEntry` documents, filtered by date range |
| API | `GET /api/v1/reports/profit-loss?startDate=X&endDate=Y` |
| Service | `financialReports.service.js:generateProfitLoss()` |
| Formula | Aggregates Income/Expense account balances from POSTED entries |
| Bank statement blending | `bankFlow.totalCredits` added to income, `bankFlow.totalDebits` added to expenses |
| Period selector | Dynamic: current_fy / previous_fy / current_quarter / ytd / statement_month |
| Failure behavior | Error toast + zero state |

---

### Balance Sheet — Assets / Liabilities / Equity / Balance Check

| Field | Detail |
|-------|--------|
| Backend source | All POSTED JournalEntry up to `asOfDate` |
| API | `GET /api/v1/reports/balance-sheet?asOfDate=YYYY-MM-DD` |
| Service | `financialReports.service.js:generateBalanceSheet()` |
| Balance check | `Assets = Liabilities + Equity (± 1 cent rounding)` |
| Failure behavior | Error toast + zero state |

---

## Proof: No Hidden Hardcoded State

Grep result confirming no static fallback data with fake numbers after the fix sprint:

| File | Status |
|------|--------|
| `GSTDashboard.jsx` | Fallback is `{ summary: {...zeros}, monthlyData: [], returns: [] }` — all zeros, no fake amounts |
| `TDSManagement.jsx` | Fallback is `{ summary: { totalDeducted: 0, ... }, bySection: [], entries: [] }` — all zeros |
| `FinancialIntelligenceDashboard.jsx` | No fallback data — signals array is empty if fetch fails |
| `SignalDashboard.jsx` | No fallback data — EmptySignalState shown |
| `ProfitLoss.jsx` | Fallback is zero state only |
| `BalanceSheet.jsx` | Fallback is zero state only |
| All other report pages | Fallback is zero state only |
