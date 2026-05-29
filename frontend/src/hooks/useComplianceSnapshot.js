/**
 * useComplianceSnapshot.js
 *
 * Fetches real GST and TDS summary from backend.
 * No hardcoded metrics. No silent fallback.
 */

import { useState, useCallback } from 'react';
import api from '../services/api';

export function useComplianceSnapshot() {
  const [gst,     setGst]     = useState(null);
  const [tds,     setTds]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors,  setErrors]  = useState({});

  const fetch = useCallback(async () => {
    setLoading(true);
    const errs = {};

    // GST summary — /api/v1/reports/gst-summary (statutory) or /api/v1/gst/summary
    try {
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const res = await api.get('/gst/summary', { params: { period }, timeout: 8000 });
      setGst(res.data?.data || res.data || null);
    } catch (e) {
      errs.gst = e.response?.data?.message || e.message;
      setGst(null);
    }

    // TDS summary — /api/v1/tds/dashboard
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year  = now.getFullYear();
      let quarter = 'Q4';
      if (month >= 4 && month <= 6)  quarter = 'Q1';
      else if (month >= 7 && month <= 9)  quarter = 'Q2';
      else if (month >= 10 && month <= 12) quarter = 'Q3';
      const fyYear = month >= 4 ? year : year - 1;
      const financialYear = `FY${fyYear}-${String(fyYear + 1).slice(-2)}`;

      const res = await api.get('/tds/dashboard', {
        params: { quarter, financialYear },
        timeout: 8000,
      });
      setTds(res.data?.data || res.data || null);
    } catch (e) {
      errs.tds = e.response?.data?.message || e.message;
      setTds(null);
    }

    setErrors(errs);
    setLoading(false);
  }, []);

  return { gst, tds, loading, errors, fetch };
}
