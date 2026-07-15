import Decimal from 'decimal.js';
import JournalEntry from '../../models/JournalEntry.js';
import CompanySettings from '../../models/CompanySettings.js';
import ComplianceFiling from '../../models/ComplianceFiling.js';
import { GST_ENGINE } from '../gstEngine.service.js';
import { buildTraceId, parseMonthPeriod } from './period.util.js';
import traceabilityService from '../traceability.service.js';

const B2CL_THRESHOLD = new Decimal(250000);

const normalizeState = (value) => String(value || '').trim().toUpperCase();

const getCompanyGstinCandidates = (settings) => {
  const list = Array.isArray(settings?.gstinRegistrations) ? settings.gstinRegistrations : [];
  const gstins = list.map((item) => item.gstin).filter(Boolean);
  if (settings?.gstin) {
    gstins.unshift(settings.gstin);
  }
  return [...new Set(gstins)];
};

const resolveCompanyGstin = (detail, settings, gstin) => {
  if (gstin) return gstin;
  if (detail?.company_gstin) return detail.company_gstin;
  return settings?.gstin;
};

const determineSupplyType = ({ entry, detail, invoiceValue }) => {
  if (detail?.supply_type) return detail.supply_type;
  if (detail?.is_export) return 'EXP';
  if (detail?.is_zero_rated) return 'EXP';
  if (detail?.is_exempt || new Decimal(detail?.gst_rate || 0).equals(0)) return 'NIL';

  const isCreditNote = Array.isArray(entry?.tags) && entry.tags.includes('credit-note');
  if (isCreditNote && detail?.counterparty_gstin) return 'CDNR';

  if (detail?.counterparty_gstin) return 'B2B';

  const isInterstate = normalizeState(detail?.supplier_state) !== normalizeState(detail?.company_state);
  if (isInterstate && invoiceValue.greaterThanOrEqualTo(B2CL_THRESHOLD)) return 'B2CL';
  return 'B2CS';
};

const buildGstr1Item = (entry, detail) => {
  const invoiceValue = new Decimal(detail?.total_amount || 0);
  const supplyType = determineSupplyType({ entry, detail, invoiceValue });
  return {
    supply_type: supplyType,
    invoice_number: entry.reference || entry.entryNumber,
    invoice_date: entry.date.toISOString().split('T')[0],
    gstin: detail?.counterparty_gstin || null,
    place_of_supply: detail?.place_of_supply || detail?.supplier_state || null,
    taxable_value: detail?.taxable_value || detail?.amount,
    tax_rate: detail?.gst_rate,
    igst: detail?.igst || '0',
    cgst: detail?.cgst || '0',
    sgst: detail?.sgst || '0',
    reverse_charge_flag: Boolean(detail?.reverse_charge),
    invoice_type: detail?.invoice_type || (detail?.is_export ? 'export' : 'regular'),
  };
};

const filterDetailsByGstin = (details, gstin, settings) => details.filter((detail) => {
  const target = resolveCompanyGstin(detail, settings, gstin);
  if (!gstin) return true;
  return target === gstin;
});

class GSTStatutoryService {
  async getJournalEntries({ startDate, endDate }) {
    return JournalEntry.find({
      status: { $in: ['POSTED', 'posted'] },
      date: { $gte: startDate, $lte: endDate },
      gstDetails: { $exists: true, $ne: [] },
    }).sort({ date: 1, entryNumber: 1 });
  }

  async generateGSTR1(period, gstin, userId, existingTraceId = null) {
    const { year, month, startDate, endDate } = parseMonthPeriod(period);
    const settings = await CompanySettings.findById('company_settings').lean();
    const traceId = existingTraceId || buildTraceId();
    const entries = await this.getJournalEntries({ startDate, endDate });

    const sections = {
      b2b: [],
      b2cl: [],
      b2cs: [],
      cdnr: [],
      exp: [],
      nil: [],
    };

    const sourceTransactions = [];

    for (const entry of entries) {
      const details = filterDetailsByGstin(entry.gstDetails || [], gstin, settings);
      details.forEach((detail) => {
        const item = buildGstr1Item(entry, detail);
        const sectionKey = item.supply_type.toLowerCase();
        if (sections[sectionKey]) {
          sections[sectionKey].push(item);
        }
      });
      sourceTransactions.push({ sourceType: 'JournalEntry', sourceId: String(entry._id) });
    }

    const sortKey = (item) => `${item.invoice_date}-${item.invoice_number}`;
    Object.values(sections).forEach((items) => items.sort((a, b) => sortKey(a).localeCompare(sortKey(b))));

    const filing = {
      filing_type: 'GSTR-1',
      period,
      gstin: gstin || settings?.gstin,
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      sections,
    };

    const record = await ComplianceFiling.create({
      filingType: 'GSTR-1',
      period: { startDate, endDate, month, year },
      gstin: gstin || settings?.gstin,
      traceId,
      generatedBy: userId,
      schemaVersion: filing.schema_version,
      generatedAt: new Date(),
      sourceTransactions,
      jsonData: filing,
    });

    // Initialize unified trace and record FILING_CREATED stage
    try {
      if (!existingTraceId) {
        await traceabilityService.initializeTrace({
          source: 'GST_FILING',
          source_id: record._id,
          user_id: userId,
          metadata: { filing_type: 'GSTR-1', period },
        });
      }
      await traceabilityService.addStage(traceId, {
        stage: 'FILING_CREATED',
        entity_type: 'ComplianceFiling',
        entity_id: String(record._id),
        status: 'SUCCESS',
        metadata: { filing_type: 'GSTR-1', period, filing_id: record.filingId },
      });
    } catch (traceErr) {
      // Trace failures must not break filing generation
    }

    return { filing, traceId, filingId: record.filingId };
  }

  async generateGSTR3B(period, gstin, userId, existingTraceId = null) {
    const { year, month, startDate, endDate } = parseMonthPeriod(period);
    const settings = await CompanySettings.findById('company_settings').lean();
    const traceId = existingTraceId || buildTraceId();
    const entries = await this.getJournalEntries({ startDate, endDate });

    let outwardTaxable = new Decimal(0);
    let outwardCGST = new Decimal(0);
    let outwardSGST = new Decimal(0);
    let outwardIGST = new Decimal(0);

    let zeroRatedTaxable = new Decimal(0);
    let exemptTaxable = new Decimal(0);

    let reverseChargeTax = new Decimal(0);

    let itcCGST = new Decimal(0);
    let itcSGST = new Decimal(0);
    let itcIGST = new Decimal(0);

    const sourceTransactions = [];

    for (const entry of entries) {
      const details = filterDetailsByGstin(entry.gstDetails || [], gstin, settings);
      details.forEach((detail) => {
        GST_ENGINE.validateGSTDetailShape(detail);
        const taxable = new Decimal(detail.taxable_value || detail.amount || 0);
        const cgst = new Decimal(detail.cgst || 0);
        const sgst = new Decimal(detail.sgst || 0);
        const igst = new Decimal(detail.igst || 0);

        if (detail.transaction_type === 'purchase') {
          itcCGST = itcCGST.plus(cgst);
          itcSGST = itcSGST.plus(sgst);
          itcIGST = itcIGST.plus(igst);
          return;
        }

        if (detail.is_zero_rated || detail.is_export) {
          zeroRatedTaxable = zeroRatedTaxable.plus(taxable);
        } else if (detail.is_exempt || new Decimal(detail.gst_rate || 0).equals(0)) {
          exemptTaxable = exemptTaxable.plus(taxable);
        } else {
          outwardTaxable = outwardTaxable.plus(taxable);
          outwardCGST = outwardCGST.plus(cgst);
          outwardSGST = outwardSGST.plus(sgst);
          outwardIGST = outwardIGST.plus(igst);
        }

        if (detail.reverse_charge) {
          reverseChargeTax = reverseChargeTax.plus(cgst).plus(sgst).plus(igst);
        }
      });
      sourceTransactions.push({ sourceType: 'JournalEntry', sourceId: String(entry._id) });
    }

    const taxLiability = outwardCGST.plus(outwardSGST).plus(outwardIGST)
      .minus(itcCGST.plus(itcSGST).plus(itcIGST));

    const filing = {
      filing_type: 'GSTR-3B',
      period,
      gstin: gstin || settings?.gstin,
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      outwardTaxable: {
        taxable_value: outwardTaxable.toString(),
        cgst: outwardCGST.toString(),
        sgst: outwardSGST.toString(),
        igst: outwardIGST.toString(),
      },
      zeroRated: {
        taxable_value: zeroRatedTaxable.toString(),
      },
      exempt: {
        taxable_value: exemptTaxable.toString(),
      },
      reverseCharge: {
        tax: reverseChargeTax.toString(),
      },
      itc: {
        cgst: itcCGST.toString(),
        sgst: itcSGST.toString(),
        igst: itcIGST.toString(),
      },
      taxLiability: {
        total: taxLiability.toString(),
      },
    };

    const record = await ComplianceFiling.create({
      filingType: 'GSTR-3B',
      period: { startDate, endDate, month, year },
      gstin: gstin || settings?.gstin,
      traceId,
      generatedBy: userId,
      schemaVersion: filing.schema_version,
      generatedAt: new Date(),
      sourceTransactions,
      jsonData: filing,
    });

    // Initialize unified trace and record FILING_CREATED stage
    try {
      if (!existingTraceId) {
        await traceabilityService.initializeTrace({
          source: 'GST_FILING',
          source_id: record._id,
          user_id: userId,
          metadata: { filing_type: 'GSTR-3B', period },
        });
      }
      await traceabilityService.addStage(traceId, {
        stage: 'FILING_CREATED',
        entity_type: 'ComplianceFiling',
        entity_id: String(record._id),
        status: 'SUCCESS',
        metadata: { filing_type: 'GSTR-3B', period, filing_id: record.filingId },
      });
    } catch (traceErr) {
      // Trace failures must not break filing generation
    }

    return { filing, traceId, filingId: record.filingId };
  }

  async listGstinRegistrations() {
    const settings = await CompanySettings.findById('company_settings').lean();
    return getCompanyGstinCandidates(settings);
  }
}

export default new GSTStatutoryService();
