import { randomUUID } from 'crypto';

export const parseMonthPeriod = (period) => {
  const [yearStr, monthStr] = String(period || '').split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('Invalid period format. Expected YYYY-MM');
  }
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { year, month, startDate, endDate };
};

export const parseFinancialYear = (financialYear) => {
  const parts = String(financialYear || '').split('-');
  if (parts.length !== 2) {
    throw new Error('Invalid financial year format. Expected YYYY-YY');
  }
  const startYear = Number(parts[0]);
  if (!startYear) {
    throw new Error('Invalid financial year format');
  }
  return startYear;
};

export const parseQuarterPeriod = (quarter, financialYear) => {
  const startYear = parseFinancialYear(financialYear);
  const quarterMap = {
    Q1: { startMonth: 3, endMonth: 5, yearOffset: 0 },
    Q2: { startMonth: 6, endMonth: 8, yearOffset: 0 },
    Q3: { startMonth: 9, endMonth: 11, yearOffset: 0 },
    Q4: { startMonth: 0, endMonth: 2, yearOffset: 1 },
  };
  const config = quarterMap[String(quarter || '').toUpperCase()];
  if (!config) {
    throw new Error('Invalid quarter. Expected Q1-Q4');
  }
  const year = startYear + config.yearOffset;
  const startDate = new Date(Date.UTC(startYear + config.yearOffset, config.startMonth, 1));
  const endDate = new Date(Date.UTC(year, config.endMonth + 1, 0, 23, 59, 59, 999));
  return { startDate, endDate, quarter: String(quarter).toUpperCase(), financialYear };
};

export const buildTraceId = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const uuid = randomUUID().slice(0, 8);
  return `TRC-${date}-${uuid}`;
};
