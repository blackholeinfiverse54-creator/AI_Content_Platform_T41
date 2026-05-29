/**
 * ComplianceVisibilityLayer.jsx
 *
 * Phase 2B — Real compliance intelligence surfaces.
 * Source: real backend responses only. No hardcoded metrics.
 *
 * Shows: GST status snapshot, TDS status snapshot,
 *        filing readiness indicator, compliance risk surface.
 */

import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Card, Badge } from '../common';
import { useComplianceSnapshot } from '../../hooks/useComplianceSnapshot';

const FilingReadiness = ({ ready, errorCount }) => {
  if (ready === null) return <Badge variant="default" size="sm">unknown</Badge>;
  if (ready)          return <Badge variant="success" size="sm"><CheckCircle2 className="w-3 h-3 mr-1" />Ready</Badge>;
  return (
    <Badge variant="danger" size="sm">
      <XCircle className="w-3 h-3 mr-1" />
      {errorCount} error{errorCount !== 1 ? 's' : ''}
    </Badge>
  );
};

const MetricRow = ({ label, value, sub, highlight }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-border/20 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <div className="text-right">
      <span className={clsx('text-xs font-semibold', highlight ? 'text-destructive' : 'text-foreground')}>
        {value ?? '—'}
      </span>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  </div>
);

const ErrorSurface = ({ label, message }) => (
  <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
    <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
    <div>
      <p className="text-xs font-semibold text-destructive">{label} UNAVAILABLE</p>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  </div>
);

const ComplianceVisibilityLayer = () => {
  const { gst, tds, loading, errors, fetch } = useComplianceSnapshot();

  useEffect(() => { fetch(); }, [fetch]);

  const fmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

  // Derive filing readiness from GST data
  const gstNetPayable   = Number(gst?.net_payable || gst?.summary?.netPayable || 0);
  const tdsPayable      = Number(tds?.summary?.pendingPayment || tds?.total_tds_payable || 0);
  const tdsFilingReady  = tds ? (tds.byStatus?.filed > 0 || tds.summary?.pendingCount === 0) : null;

  // Risk surface: any HIGH/CRITICAL signals from compliance
  const hasGSTRisk = gstNetPayable > 100000;
  const hasTDSRisk = tdsPayable > 50000;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Compliance Snapshot</h3>
        <button
          onClick={fetch}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh compliance data"
        >
          <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* GST Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground tracking-wide">GST STATUS</p>
          {errors.gst
            ? <Badge variant="danger" size="sm">error</Badge>
            : gst
              ? <Badge variant={hasGSTRisk ? 'warning' : 'success'} size="sm">
                  {hasGSTRisk ? 'review' : 'ok'}
                </Badge>
              : loading
                ? <Badge variant="default" size="sm"><Clock className="w-3 h-3 mr-1" />loading</Badge>
                : <Badge variant="default" size="sm">no data</Badge>
          }
        </div>

        {errors.gst && <ErrorSurface label="GST" message={errors.gst} />}

        {!errors.gst && gst && (
          <div className="space-y-0">
            <MetricRow
              label="Output GST"
              value={fmt(gst.total_output_tax || gst.summary?.outputGST)}
            />
            <MetricRow
              label="Input Credit"
              value={fmt(gst.total_input_credit || gst.summary?.inputGST)}
            />
            <MetricRow
              label="Net Payable"
              value={fmt(gst.net_payable || gst.summary?.netPayable)}
              highlight={hasGSTRisk}
            />
            {gst.breakdown && (
              <MetricRow
                label="CGST / SGST / IGST"
                value={`${fmt(gst.breakdown.cgst)} / ${fmt(gst.breakdown.sgst)} / ${fmt(gst.breakdown.igst)}`}
              />
            )}
          </div>
        )}

        {!errors.gst && !gst && !loading && (
          <p className="text-xs text-muted-foreground">No GST data for current period.</p>
        )}
      </div>

      <div className="border-t border-border/30" />

      {/* TDS Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground tracking-wide">TDS STATUS</p>
          {errors.tds
            ? <Badge variant="danger" size="sm">error</Badge>
            : tds
              ? <FilingReadiness ready={tdsFilingReady} errorCount={tds.summary?.pendingCount || 0} />
              : loading
                ? <Badge variant="default" size="sm"><Clock className="w-3 h-3 mr-1" />loading</Badge>
                : <Badge variant="default" size="sm">no data</Badge>
          }
        </div>

        {errors.tds && <ErrorSurface label="TDS" message={errors.tds} />}

        {!errors.tds && tds && (
          <div className="space-y-0">
            <MetricRow
              label="Total Deducted"
              value={fmt(tds.summary?.totalDeducted)}
            />
            <MetricRow
              label="Pending Payment"
              value={fmt(tds.summary?.pendingPayment)}
              highlight={hasTDSRisk}
            />
            <MetricRow
              label="Pending Entries"
              value={tds.summary?.pendingCount ?? '—'}
              highlight={(tds.summary?.pendingCount || 0) > 0}
            />
            <MetricRow
              label="Quarter"
              value={`${tds.quarter} ${tds.financialYear}`}
            />
          </div>
        )}

        {!errors.tds && !tds && !loading && (
          <p className="text-xs text-muted-foreground">No TDS data for current quarter.</p>
        )}
      </div>

      {/* Risk Surface */}
      {(hasGSTRisk || hasTDSRisk) && (
        <>
          <div className="border-t border-border/30" />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground tracking-wide">COMPLIANCE RISK</p>
            {hasGSTRisk && (
              <div className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                GST net payable exceeds ₹1L — review before filing
              </div>
            )}
            {hasTDSRisk && (
              <div className="flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                TDS pending payment exceeds ₹50K — deposit challan
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
};

export default ComplianceVisibilityLayer;
