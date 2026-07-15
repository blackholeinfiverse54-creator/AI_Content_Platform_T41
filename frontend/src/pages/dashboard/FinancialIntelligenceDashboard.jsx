/**
 * FinancialIntelligenceDashboard.jsx
 *
 * Professional financial dashboard with real data from /api/v1/reports/dashboard.
 * Shows: Revenue, Expenses, Net Income, Outstanding, Bank Flow, Recent Activity.
 * Signal panel is a compact alert sidebar — not the main focus.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Receipt,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  WifiOff,
  Wallet,
  FileText,
  Clock,
  IndianRupee,
  CreditCard,
  PiggyBank,
} from 'lucide-react';
import { Card, Loading } from '../../components/common';
import SignalStackPanel from '../../components/intelligence/SignalStackPanel';
import SignalDetailEngine from '../../components/intelligence/SignalDetailEngine';
import RuntimeModeBanner from '../../components/intelligence/RuntimeModeBanner';
import { useRuntimeMode, RUNTIME_MODES } from '../../hooks/useRuntimeMode';
import { useSignals, SIGNAL_SOURCE } from '../../hooks/useSignals';
import { dashboardService } from '../../services';

// ─── Format currency ─────────────────────────────────────────────────────────
const fmt = (n) => {
  const num = Number(n || 0);
  if (Math.abs(num) >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
  if (Math.abs(num) >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const fmtFull = (n) => {
  const num = Number(n || 0);
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

// ─── Map DB signals for display (deduplicated by type) ───────────────────────
function mapDbSignals(rawSignals) {
  if (!rawSignals.length) return [];
  const seen = new Set();
  return rawSignals
    .filter(sig => {
      const type = sig.type || sig.signal_type;
      if (seen.has(type)) return false;
      seen.add(type);
      return true;
    })
    .map((sig, i) => ({
      id: sig.signal_id || sig._id || `db_${i}`,
      signal_id: sig.signal_id,
      signal_type: sig.type || sig.signal_type || 'UNKNOWN',
      type: sig.type || sig.signal_type,
      label: sig.context?.label || sig.type?.replace(/_/g, ' ').toLowerCase() || 'Signal',
      severity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(sig.severity) ? sig.severity : 'LOW',
      reason: sig.context?.reason || sig.recommendation || '',
      recommendation: typeof sig.recommendation === 'string'
        ? sig.recommendation.replace(/^\[[^\]]+\]\s*/, '')
        : '',
      variance_pct: Number(sig.context?.variance_pct || 0),
      trace_id: sig.trace_id,
      created_at: sig.created_at,
      context: sig.context,
    }));
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, subValue, trend, color = 'primary' }) => (
  <Card className="p-4 hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
        {subValue && (
          <p className="text-xs text-muted-foreground">{subValue}</p>
        )}
      </div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-${color}/10`}>
        <Icon className={`w-5 h-5 text-${color}`} />
      </div>
    </div>
    {trend !== undefined && (
      <div className="mt-3 flex items-center gap-1.5">
        {trend > 0
          ? <ArrowUpRight className="w-3.5 h-3.5 text-success" />
          : trend < 0
            ? <ArrowDownRight className="w-3.5 h-3.5 text-destructive" />
            : <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
        }
        <span className={`text-xs font-medium ${trend > 0 ? 'text-success' : trend < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
          {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">vs last month</span>
      </div>
    )}
  </Card>
);

// ─── BackendUnavailableState ─────────────────────────────────────────────────
const BackendUnavailableState = ({ onRetry }) => (
  <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
    <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
      <WifiOff className="w-8 h-8 text-destructive" />
    </div>
    <div className="text-center">
      <p className="text-base font-semibold text-foreground">Backend Unavailable</p>
      <p className="text-sm text-muted-foreground mt-1">
        Cannot reach the Artha API. Check that the backend is running.
      </p>
    </div>
    <button
      onClick={onRetry}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
    >
      <RefreshCw className="w-4 h-4" />
      Retry Connection
    </button>
  </div>
);

// ─── Main Dashboard ──────────────────────────────────────────────────────────
const FinancialIntelligenceDashboard = () => {
  const { mode, lastChecked, recheck } = useRuntimeMode();
  const { signals: rawSignals, source, loading: signalsLoading, error: signalsError, fetchSignals } = useSignals();
  const [selectedSignal, setSelectedSignal] = useState(null);

  const [dashboardData, setDashboardData] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState(null);

  // Fetch real financial data
  useEffect(() => {
    if (mode === RUNTIME_MODES.BACKEND_CONNECTED || mode === RUNTIME_MODES.BACKEND_DEGRADED) {
      setDashLoading(true);
      dashboardService.getStats()
        .then(res => {
          setDashboardData(res.data?.data || res.data);
          setDashError(null);
        })
        .catch(err => {
          setDashError(err.message);
        })
        .finally(() => setDashLoading(false));

      fetchSignals();
    }
  }, [mode, fetchSignals]);

  // Map signals (deduplicated)
  const signals = useMemo(() => {
    if (!rawSignals.length) return [];
    if (source === SIGNAL_SOURCE.LIVE_LIST) return mapDbSignals(rawSignals);
    return [];
  }, [rawSignals, source]);

  const groupedSignals = useMemo(() => {
    const groups = { HIGH: [], MEDIUM: [], LOW: [] };
    signals.forEach(s => {
      const bucket = s.severity === 'CRITICAL' ? 'HIGH' : s.severity;
      if (groups[bucket]) groups[bucket].push(s);
    });
    return groups;
  }, [signals]);

  // Auto-select first signal
  useEffect(() => {
    if (signals.length && !selectedSignal) {
      setSelectedSignal(signals[0]);
    }
  }, [signals]);

  const d = dashboardData;
  const isLoading = dashLoading && mode !== RUNTIME_MODES.CHECKING;

  // ── Render: checking ──
  if (mode === RUNTIME_MODES.CHECKING) {
    return (
      <div className="space-y-4">
        <RuntimeModeBanner mode={mode} />
        <Loading.Page />
      </div>
    );
  }

  // ── Render: backend unavailable ──
  if (mode === RUNTIME_MODES.BACKEND_UNAVAILABLE) {
    return (
      <div className="space-y-4">
        <RuntimeModeBanner mode={mode} lastChecked={lastChecked} onRecheck={recheck} />
        <BackendUnavailableState onRetry={recheck} />
      </div>
    );
  }

  // ── Render: mock mode ──
  if (mode === RUNTIME_MODES.MOCK_MODE) {
    return (
      <div className="space-y-4">
        <RuntimeModeBanner mode={mode} />
        <Card className="p-6 border-secondary/30 bg-secondary/5">
          <p className="text-sm font-semibold text-secondary">MOCK DEVELOPMENT MODE</p>
          <p className="text-xs text-muted-foreground mt-1">
            Set VITE_MOCK_MODE=false in frontend/.env to connect to the real backend.
          </p>
        </Card>
      </div>
    );
  }

  // ── Render: connected or degraded ──
  return (
    <div className="space-y-5 animate-fadeIn">
      <RuntimeModeBanner mode={mode} lastChecked={lastChecked} onRecheck={recheck} />

      {/* Error surface */}
      {(signalsError || dashError) && (
        <Card className="p-3 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-destructive">DATA FETCH ERROR</p>
              <p className="text-xs text-muted-foreground">{signalsError?.message || dashError}</p>
            </div>
          </div>
        </Card>
      )}

      {/* KPI Row — Real Financial Data */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="p-4"><Loading size="sm" /></Card>
          ))}
        </div>
      ) : d ? (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={IndianRupee}
            label="Revenue (Month)"
            value={fmt(d.profitLoss?.income)}
            subValue={`${fmt(d.yearToDate?.income)} YTD`}
            trend={Number(d.summary?.revenueChange) || undefined}
            color="success"
          />
          <KpiCard
            icon={Receipt}
            label="Expenses (Month)"
            value={fmt(d.profitLoss?.expenses)}
            subValue={`${fmt(d.yearToDate?.expenses)} YTD`}
            trend={Number(d.summary?.expenseChange) || undefined}
            color="destructive"
          />
          <KpiCard
            icon={Wallet}
            label="Net Income"
            value={fmt(d.profitLoss?.netIncome)}
            subValue={`${fmt(d.yearToDate?.netIncome)} YTD`}
            color={Number(d.profitLoss?.netIncome) >= 0 ? 'success' : 'destructive'}
          />
          <KpiCard
            icon={CreditCard}
            label="Outstanding"
            value={fmt(d.summary?.totalOutstanding)}
            subValue={`${d.invoices?.overdue?.count || 0} overdue invoices`}
            color="warning"
          />
        </section>
      ) : null}

      {/* Main Content Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">

        {/* Left: Financial Summary + Recent Activity */}
        <div className="xl:col-span-5 space-y-5">

          {/* Balance Sheet Summary */}
          {d && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Balance Sheet</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <PiggyBank className="w-4 h-4 text-primary" />
                    <span className="text-sm text-foreground">Total Assets</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmt(d.balanceSheet?.assets)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-destructive" />
                    <span className="text-sm text-foreground">Total Liabilities</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmt(d.balanceSheet?.liabilities)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-success" />
                    <span className="text-sm text-foreground">Equity</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmt(d.balanceSheet?.equity)}</span>
                </div>
              </div>
            </Card>
          )}

          {/* Bank Flow */}
          {d && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Bank Flow (This Month)</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="text-xs text-muted-foreground">Credits</p>
                  <p className="text-lg font-bold text-success">{fmt(d.bankFlow?.monthCredits)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{d.bankFlow?.monthTransactions || 0} transactions</p>
                </div>
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <p className="text-xs text-muted-foreground">Debits</p>
                  <p className="text-lg font-bold text-destructive">{fmt(d.bankFlow?.monthDebits)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{d.bankFlow?.monthStatements || 0} statements</p>
                </div>
              </div>
              <div className="mt-3 p-3 rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Net Flow</span>
                  <span className={`text-sm font-semibold ${Number(d.bankFlow?.monthNetFlow) >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {fmt(d.bankFlow?.monthNetFlow)}
                  </span>
                </div>
              </div>
            </Card>
          )}

          {/* Recent Journal Entries */}
          {d?.recentEntries?.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Recent Activity</h2>
              <div className="space-y-2">
                {d.recentEntries.slice(0, 5).map((entry, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{entry.entryNumber}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{entry.description || 'No description'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {entry.date ? new Date(entry.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                      </p>
                      {entry.postedBy && (
                        <p className="text-xs text-muted-foreground">{entry.postedBy}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Invoice Summary */}
          {d?.invoices && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Invoice Status</h2>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Paid', count: d.invoices.paid?.count || 0, amount: d.invoices.paid?.totalAmount || '0', color: 'success' },
                  { label: 'Pending', count: (d.invoices.sent?.count || 0) + (d.invoices.partial?.count || 0), amount: Number(d.invoices.sent?.totalDue || 0) + Number(d.invoices.partial?.totalDue || 0), color: 'warning' },
                  { label: 'Overdue', count: d.invoices.overdue?.count || 0, amount: d.invoices.overdue?.totalDue || '0', color: 'destructive' },
                ].map(item => (
                  <div key={item.label} className={`p-3 rounded-lg bg-${item.color}/5 border border-${item.color}/20`}>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className={`text-lg font-bold text-${item.color}`}>{item.count}</p>
                    <p className="text-xs text-muted-foreground">{fmt(item.amount)}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Center: Expense Breakdown */}
        <div className="xl:col-span-4 space-y-5">
          {d?.expenses?.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Expenses by Category (This Month)</h2>
              <div className="space-y-3">
                {d.expenses.slice(0, 8).map((exp, i) => {
                  const totalExpenses = d.expenses.reduce((s, e) => s + (e.totalAmount || 0), 0);
                  const pct = totalExpenses > 0 ? ((exp.totalAmount / totalExpenses) * 100) : 0;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground font-medium">{exp._id || 'Uncategorized'}</span>
                        <span className="text-muted-foreground">{fmt(exp.totalAmount)} ({exp.count})</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Expense Status */}
          {d?.expensesByStatus && Object.keys(d.expensesByStatus).length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Expense Approval Status</h2>
              <div className="space-y-2">
                {Object.entries(d.expensesByStatus).map(([status, data]) => (
                  <div key={status} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                    <span className="text-sm text-foreground capitalize">{status}</span>
                    <div className="text-right">
                      <span className="text-sm font-medium text-foreground">{data.count}</span>
                      <span className="text-xs text-muted-foreground ml-2">{fmt(data.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Year-to-Date Summary */}
          {d?.yearToDate && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Year to Date</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2">
                  <span className="text-sm text-muted-foreground">Income</span>
                  <span className="text-sm font-semibold text-success">{fmt(d.yearToDate.income)}</span>
                </div>
                <div className="flex items-center justify-between p-2">
                  <span className="text-sm text-muted-foreground">Expenses</span>
                  <span className="text-sm font-semibold text-destructive">{fmt(d.yearToDate.expenses)}</span>
                </div>
                <div className="border-t border-border/40 pt-2 flex items-center justify-between p-2">
                  <span className="text-sm font-medium text-foreground">Net Income</span>
                  <span className={`text-sm font-bold ${Number(d.yearToDate.netIncome) >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {fmt(d.yearToDate.netIncome)}
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right: Signal Alerts + Detail */}
        <div className="xl:col-span-3 space-y-5">
          {/* Compact signal alerts */}
          {!signalsLoading && signals.length > 0 && (
            <SignalStackPanel
              groupedSignals={groupedSignals}
              selectedSignalId={selectedSignal?.id}
              onSelectSignal={setSelectedSignal}
            />
          )}

          {!signalsLoading && signals.length === 0 && (
            <Card className="p-4">
              <p className="text-xs text-muted-foreground text-center">
                No active compliance alerts.
              </p>
            </Card>
          )}

          {/* Signal Detail */}
          {selectedSignal && (
            <SignalDetailEngine selectedSignal={selectedSignal} />
          )}
        </div>
      </section>
    </div>
  );
};

export default FinancialIntelligenceDashboard;
