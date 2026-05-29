/**
 * useRuntimeMode.js
 *
 * Single source of truth for backend connection state.
 * Determines: BACKEND_CONNECTED | BACKEND_DEGRADED | BACKEND_UNAVAILABLE | MOCK_MODE
 *
 * Rules:
 * - MOCK_MODE only when VITE_MOCK_MODE=true explicitly set
 * - BACKEND_CONNECTED: /health returned 200
 * - BACKEND_DEGRADED: /health returned but signals/snapshot failed
 * - BACKEND_UNAVAILABLE: /health itself failed (network error / 5xx)
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

export const RUNTIME_MODES = {
  CHECKING:            'CHECKING',
  BACKEND_CONNECTED:   'BACKEND_CONNECTED',
  BACKEND_DEGRADED:    'BACKEND_DEGRADED',
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  MOCK_MODE:           'MOCK_MODE',
};

export const MODE_META = {
  CHECKING:            { label: 'CHECKING CONNECTION',    color: 'text-muted-foreground', bg: 'bg-muted/40',          border: 'border-border/40' },
  BACKEND_CONNECTED:   { label: 'LIVE BACKEND SIGNALS',   color: 'text-success',          bg: 'bg-success/10',        border: 'border-success/30' },
  BACKEND_DEGRADED:    { label: 'SNAPSHOT FALLBACK ACTIVE', color: 'text-warning',         bg: 'bg-warning/10',        border: 'border-warning/30' },
  BACKEND_UNAVAILABLE: { label: 'BACKEND UNAVAILABLE',    color: 'text-destructive',       bg: 'bg-destructive/10',    border: 'border-destructive/30' },
  MOCK_MODE:           { label: 'MOCK DEVELOPMENT MODE',  color: 'text-secondary',         bg: 'bg-secondary/10',      border: 'border-secondary/30' },
};

export function useRuntimeMode() {
  const [mode, setMode]           = useState(RUNTIME_MODES.CHECKING);
  const [lastChecked, setLastChecked] = useState(null);
  const [healthDetail, setHealthDetail] = useState(null);

  const check = useCallback(async () => {
    // Explicit mock override
    if (import.meta.env.VITE_MOCK_MODE === 'true') {
      setMode(RUNTIME_MODES.MOCK_MODE);
      return;
    }

    setMode(RUNTIME_MODES.CHECKING);

    try {
      const res = await api.get('/health', { timeout: 5000 });
      setHealthDetail(res.data);

      // Health OK — now check if signals endpoint is reachable
      try {
        await api.get('/signals/snapshot', { timeout: 5000 });
        setMode(RUNTIME_MODES.BACKEND_CONNECTED);
      } catch {
        // Health OK but signals degraded
        setMode(RUNTIME_MODES.BACKEND_DEGRADED);
      }
    } catch {
      setMode(RUNTIME_MODES.BACKEND_UNAVAILABLE);
    }

    setLastChecked(new Date());
  }, []);

  useEffect(() => { check(); }, [check]);

  return { mode, lastChecked, healthDetail, recheck: check };
}
