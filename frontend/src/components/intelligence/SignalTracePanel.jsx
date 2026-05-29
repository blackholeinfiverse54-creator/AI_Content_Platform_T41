/**
 * SignalTracePanel.jsx
 *
 * Phase 1C — Signal Trace Proof
 * Shows: trace_id, source, generation timestamp, origin layer
 * for a selected signal. Calls /api/v1/signals/trace/:traceId
 * to reconstruct the full chain.
 */

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Link2, Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import { Card, Badge } from '../common';

const STEP_COLORS = {
  1: 'bg-primary/10 border-primary/30 text-primary',
  2: 'bg-warning/10 border-warning/30 text-warning',
  3: 'bg-info/10 border-info/30 text-info',
  4: 'bg-success/10 border-success/30 text-success',
  5: 'bg-secondary/10 border-secondary/30 text-secondary',
};

const TraceStep = ({ step }) => {
  const [open, setOpen] = useState(false);
  const colorClass = STEP_COLORS[step.step] || 'bg-muted/40 border-border/40 text-foreground';

  return (
    <div className={clsx('rounded-xl border p-3', colorClass)}>
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold opacity-60">STEP {step.step}</span>
          <span className="text-xs font-semibold">{step.label}</span>
          {step.found
            ? <Badge variant="success" size="sm">found</Badge>
            : <Badge variant="default" size="sm">not found</Badge>}
        </div>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          : <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
      </button>

      {open && step.data && (
        <pre className="mt-2 text-xs bg-background/60 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(step.data, null, 2)}
        </pre>
      )}
      {open && !step.data && (
        <p className="mt-2 text-xs opacity-60">No data at this step.</p>
      )}
    </div>
  );
};

const SignalTracePanel = ({ signal }) => {
  const [chain,   setChain]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Extract trace_id from either shape (DB model or in-memory)
  const traceId = signal?.trace_id;

  useEffect(() => {
    if (!traceId) { setChain(null); return; }

    setLoading(true);
    setError(null);

    api.get(`/signals/trace/${traceId}`, { timeout: 8000 })
      .then(res => { setChain(res.data?.data || null); })
      .catch(e  => { setError(e.response?.data?.message || e.message); })
      .finally(() => setLoading(false));
  }, [traceId]);

  if (!signal) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Signal Trace</h3>
      </div>

      {/* Signal metadata — always shown from the signal itself */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">trace_id</span>
          <span className="font-mono text-foreground truncate max-w-[180px]" title={traceId}>
            {traceId || '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">signal type</span>
          <span className="font-medium text-foreground">{signal.type || signal.signal_type || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">source</span>
          <span className="text-foreground">{signal.source || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">generated</span>
          <span className="text-foreground">
            {signal.created_at
              ? new Date(signal.created_at).toLocaleString()
              : signal.timestamp
                ? new Date(signal.timestamp).toLocaleString()
                : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">origin layer</span>
          <span className="text-foreground">
            {signal.context?.source?.module || signal.source?.module || 'ARTHA'}
          </span>
        </div>
      </div>

      <div className="border-t border-border/30 pt-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2">CHAIN RECONSTRUCTION</p>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Reconstructing trace chain...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        {!loading && !error && !chain && traceId && (
          <p className="text-xs text-muted-foreground">No chain data found for this trace_id.</p>
        )}

        {!traceId && (
          <p className="text-xs text-muted-foreground">No trace_id on this signal — snapshot-derived signal.</p>
        )}

        {chain && (
          <div className="space-y-2">
            {chain.steps?.map(step => (
              <TraceStep key={step.step} step={step} />
            ))}
            <p className="text-xs text-muted-foreground text-right">
              reconstructed at {new Date(chain.reconstructed_at).toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default SignalTracePanel;
