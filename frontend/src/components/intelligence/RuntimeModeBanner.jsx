/**
 * RuntimeModeBanner.jsx
 *
 * Visibly declares the current backend connection state.
 * Zero ambiguity — never hidden, never silent.
 */

import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { RUNTIME_MODES, MODE_META } from '../../hooks/useRuntimeMode';

const RuntimeModeBanner = ({ mode, lastChecked, onRecheck, compact = false }) => {
  const meta = MODE_META[mode] || MODE_META.CHECKING;

  if (compact) {
    return (
      <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border', meta.bg, meta.border, meta.color)}>
        <span className={clsx('w-1.5 h-1.5 rounded-full', {
          'bg-success animate-pulse':    mode === RUNTIME_MODES.BACKEND_CONNECTED,
          'bg-warning animate-pulse':    mode === RUNTIME_MODES.BACKEND_DEGRADED,
          'bg-destructive':              mode === RUNTIME_MODES.BACKEND_UNAVAILABLE,
          'bg-secondary':                mode === RUNTIME_MODES.MOCK_MODE,
          'bg-muted-foreground animate-pulse': mode === RUNTIME_MODES.CHECKING,
        })} />
        {meta.label}
      </span>
    );
  }

  return (
    <div className={clsx('flex items-center justify-between px-4 py-2 rounded-xl border text-xs font-medium', meta.bg, meta.border)}>
      <div className="flex items-center gap-2">
        <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', {
          'bg-success animate-pulse':    mode === RUNTIME_MODES.BACKEND_CONNECTED,
          'bg-warning animate-pulse':    mode === RUNTIME_MODES.BACKEND_DEGRADED,
          'bg-destructive':              mode === RUNTIME_MODES.BACKEND_UNAVAILABLE,
          'bg-secondary':                mode === RUNTIME_MODES.MOCK_MODE,
          'bg-muted-foreground animate-pulse': mode === RUNTIME_MODES.CHECKING,
        })} />
        <span className={meta.color}>{meta.label}</span>
        {lastChecked && (
          <span className="text-muted-foreground">
            · checked {lastChecked.toLocaleTimeString()}
          </span>
        )}
      </div>
      {onRecheck && mode !== RUNTIME_MODES.CHECKING && (
        <button
          onClick={onRecheck}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          recheck
        </button>
      )}
    </div>
  );
};

export default RuntimeModeBanner;
