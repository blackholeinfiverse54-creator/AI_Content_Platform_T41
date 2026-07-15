import { randomUUID } from 'crypto';
import logger from '../config/logger.js';
import Invoice from '../models/Invoice.js';
import JournalEntry from '../models/JournalEntry.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import CompanySettings from '../models/CompanySettings.js';
import TallyExport from '../models/TallyExport.js';
import TallyImport from '../models/TallyImport.js';
import AccountBalance from '../models/AccountBalance.js';
import Decimal from 'decimal.js';
import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';

let ledgerService = null;
try {
  const mod = await import('./ledger.service.js');
  ledgerService = mod.default;
} catch {
  logger.warn('ledger.service.js not available — journal entries will not be created on import');
}

class TallyCompatibilityService {
  static VOUCHER_MAP = {
    sales: { tallyType: 'Sales', journalSource: 'Invoice', defaultDebit: 'Accounts Receivable', defaultCredit: 'Sales' },
    purchase: { tallyType: 'Purchase', journalSource: 'Expense', defaultDebit: 'Purchases', defaultCredit: 'Accounts Payable' },
    receipt: { tallyType: 'Receipt', journalSource: 'Payment', defaultDebit: 'Cash', defaultCredit: 'Accounts Receivable' },
    payment: { tallyType: 'Payment', journalSource: 'Payment', defaultDebit: 'Accounts Payable', defaultCredit: 'Cash' },
    journal: { tallyType: 'Journal', journalSource: 'JournalEntry', defaultDebit: null, defaultCredit: null },
    contra: { tallyType: 'Contra', journalSource: 'JournalEntry', defaultDebit: null, defaultCredit: null },
    credit_note: { tallyType: 'Credit Note', journalSource: 'CreditNote', defaultDebit: 'Sales Returns', defaultCredit: 'Accounts Receivable' },
    debit_note: { tallyType: 'Debit Note', journalSource: 'DebitNote', defaultDebit: 'Accounts Payable', defaultCredit: 'Purchase Returns' },
  };

  static MASTERS_MAP = {
    'Asset': { tallyGroup: 'Current Assets', normalBalance: 'debit' },
    'Liability': { tallyGroup: 'Current Liabilities', normalBalance: 'credit' },
    'Equity': { tallyGroup: 'Capital Account', normalBalance: 'credit' },
    'Income': { tallyGroup: 'Sales Accounts', normalBalance: 'credit' },
    'Expense': { tallyGroup: 'Purchase Accounts', normalBalance: 'debit' },
  };

  static TALLY_GROUP_TO_TYPE = {
    'Current Assets': 'Asset', 'Fixed Assets': 'Asset', 'Bank Accounts': 'Asset',
    'Cash-in-Hand': 'Asset', 'Deposits (Asset)': 'Asset', 'Loans & Advances (Asset)': 'Asset',
    'Investments': 'Asset', 'Duties & Taxes': 'Asset',
    'Current Liabilities': 'Liability', 'Loans (Liability)': 'Liability',
    'Provisions': 'Liability', 'Capital Account': 'Equity',
    'Sales Accounts': 'Income', 'Direct Incomes': 'Income', 'Indirect Incomes': 'Income',
    'Purchase Accounts': 'Expense', 'Direct Expenses': 'Expense', 'Indirect Expenses': 'Expense',
  };

  static VOUCHER_TYPE_MAP = {
    'Sales': 'sales', 'Purchase': 'purchase', 'Receipt': 'receipt',
    'Payment': 'payment', 'Journal': 'journal', 'Contra': 'contra',
    'Credit Note': 'credit_note', 'Debit Note': 'debit_note',
    'Sales Order': 'sales', 'Purchase Order': 'purchase',
  };

  // ─────────── EXPORTS ───────────

  async exportVouchers(data) {
    const { companyId, dateRange, voucherTypes, userId } = data;
    const exportRecord = new TallyExport({
      exportType: 'vouchers', format: 'xml', companyId, dateRange,
      voucherTypes: voucherTypes || ['all'], exportedBy: userId,
    });

    try {
      const query = {};
      if (dateRange?.startDate) query.date = { $gte: new Date(dateRange.startDate) };
      if (dateRange?.endDate) query.date = { ...query.date, $lte: new Date(dateRange.endDate) };

      const journals = await JournalEntry.find(query).populate('lines.account', 'code name type');
      const xmlData = this.generateTallyXML(journals);

      exportRecord.status = 'completed';
      exportRecord.recordCount = journals.length;
      exportRecord.metadata = { ...exportRecord.metadata, xmlLength: xmlData.length };
      await exportRecord.save();

      return { exportRecord, xmlData };
    } catch (err) {
      exportRecord.status = 'failed';
      exportRecord.exportErrors = [{ entityType: 'Voucher', entityId: '', error: err.message }];
      await exportRecord.save();
      throw err;
    }
  }

  async exportMasters(companyId, userId) {
    const exportRecord = new TallyExport({
      exportType: 'masters', format: 'xml', companyId, exportedBy: userId,
    });

    try {
      const accounts = await ChartOfAccounts.find({ isActive: true });
      const mastersData = accounts.map(account => ({
        name: account.name,
        code: account.code,
        group: this.MASTERS_MAP[account.type]?.tallyGroup || account.type,
        type: account.type,
        openingBalance: '0',
      }));

      exportRecord.status = 'completed';
      exportRecord.recordCount = accounts.length;
      await exportRecord.save();

      return { exportRecord, mastersData };
    } catch (err) {
      exportRecord.status = 'failed';
      exportRecord.exportErrors = [{ entityType: 'Master', entityId: '', error: err.message }];
      await exportRecord.save();
      throw err;
    }
  }

  async exportOpeningBalances(companyId, financialYear, userId) {
    const exportRecord = new TallyExport({
      exportType: 'opening_balances', format: 'xml', companyId, exportedBy: userId,
    });

    try {
      const accounts = await ChartOfAccounts.find({ isActive: true });
      const balances = await AccountBalance.find({});
      const balanceMap = new Map(balances.map(b => [String(b.account), b]));

      const openingBalances = accounts.map(account => {
        const balance = balanceMap.get(String(account._id));
        return {
          name: account.name,
          code: account.code,
          type: account.type,
          openingBalance: balance?.balance || '0',
        };
      });

      exportRecord.status = 'completed';
      exportRecord.recordCount = openingBalances.length;
      await exportRecord.save();

      return { exportRecord, openingBalances };
    } catch (err) {
      exportRecord.status = 'failed';
      await exportRecord.save();
      throw err;
    }
  }

  async exportGSTData(period, financialYear, userId) {
    const exportRecord = new TallyExport({
      exportType: 'gst_data', format: 'xml', exportedBy: userId,
    });

    try {
      const invoices = await Invoice.find({
        invoiceDate: { $gte: period.startDate, $lte: period.endDate },
        status: { $in: ['sent', 'paid', 'partial'] },
      });

      const gstData = invoices.map(inv => ({
        invoiceNumber: inv.invoiceNumber,
        date: inv.invoiceDate,
        partyName: inv.customerName,
        partyGSTIN: inv.customerGSTIN,
        taxableAmount: inv.subtotal,
        cgst: inv.gstBreakdown?.cgst || '0',
        sgst: inv.gstBreakdown?.sgst || '0',
        igst: inv.gstBreakdown?.igst || '0',
        totalAmount: inv.totalAmount,
      }));

      exportRecord.status = 'completed';
      exportRecord.recordCount = gstData.length;
      await exportRecord.save();

      return { exportRecord, gstData };
    } catch (err) {
      exportRecord.status = 'failed';
      await exportRecord.save();
      throw err;
    }
  }

  // ─────────── FILE PARSING ───────────

  async parseTallyXMLFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseTallyXML(content);
  }

  parseTallyXML(xmlContent) {
    const vouchers = [];
    const voucherBlocks = xmlContent.split(/<VOUCHER[\s>]/i).slice(1);

    for (const block of voucherBlocks) {
      const endIdx = block.indexOf('</VOUCHER>');
      const voucherXml = endIdx > -1 ? block.substring(0, endIdx) : block;

      const voucher = {
        type: this._extractXmlTag(voucherXml, 'VOUCHERTYPE') || this._extractXmlAttr(block, 'VCHTYPE') || 'Journal',
        date: this._extractXmlTag(voucherXml, 'DATE'),
        number: this._extractXmlTag(voucherXml, 'VOUCHERNUMBER') || this._extractXmlTag(voucherXml, 'NUMBER'),
        narration: this._extractXmlTag(voucherXml, 'NARRATION'),
        party: this._extractXmlTag(voucherXml, 'PARTYNAME'),
        reference: this._extractXmlTag(voucherXml, 'REFERENCE'),
        amount: '0',
        ledgerEntries: [],
      };

      const entryBlocks = voucherXml.split(/<ALLLEDGERENTRIES\.LIST>/i).slice(1);
      for (const entryBlock of entryBlocks) {
        const entryEnd = entryBlock.indexOf('</ALLLEDGERENTRIES.LIST>');
        const entryXml = entryEnd > -1 ? entryBlock.substring(0, entryEnd) : entryBlock;

        const ledgerName = this._extractXmlTag(entryXml, 'LEDGERNAME');
        const amountStr = this._extractXmlTag(entryXml, 'AMOUNT') || '0';
        const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;

        if (ledgerName) {
          voucher.ledgerEntries.push({
            ledgerName,
            amount,
            isDebit: amount > 0,
          });
        }
      }

      const totalAmount = voucher.ledgerEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);
      voucher.amount = String(totalAmount);

      vouchers.push(voucher);
    }

    return vouchers;
  }

  async parseTallyCSVFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseTallyCSV(content);
  }

  parseTallyCSV(csvContent) {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    const voucherMap = new Map();

    for (const record of records) {
      const voucherDate = record.Date || record.date || record.DATE || '';
      const voucherNumber = record.VoucherNumber || record.Voucher_Number || record.number || '';
      const voucherType = record.VoucherType || record.Voucher_Type || record.type || 'Journal';
      const ledgerName = record.LedgerName || record.Ledger_Name || record.ledger || '';
      const amount = parseFloat((record.Amount || record.amount || '0').replace(/,/g, '')) || 0;
      const narration = record.Narration || record.narration || '';
      const party = record.PartyName || record.Party || record.party || '';

      const key = `${voucherDate}|${voucherNumber}|${voucherType}`;
      if (!voucherMap.has(key)) {
        voucherMap.set(key, {
          date: voucherDate,
          number: voucherNumber,
          type: voucherType,
          narration,
          party,
          ledgerEntries: [],
          amount: '0',
        });
      }

      const voucher = voucherMap.get(key);
      if (ledgerName) {
        voucher.ledgerEntries.push({
          ledgerName,
          amount: Math.abs(amount),
          isDebit: amount > 0,
        });
      }
    }

    return Array.from(voucherMap.values());
  }

  _extractXmlTag(xml, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\\/${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  _extractXmlAttr(xml, attrName) {
    const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  // ─────────── IMPORT WITH JOURNAL CREATION ───────────

  async importVouchers(data) {
    const { companyId, vouchers, userId, createJournals = true } = data;
    const importRecord = new TallyImport({
      importType: 'vouchers', format: 'json', companyId, importedBy: userId,
    });

    const results = {
      created: 0, updated: 0, skipped: 0, failed: 0,
      journalEntriesCreated: 0, errors: [], warnings: [],
    };

    const accountCache = new Map();

    for (const voucher of vouchers) {
      try {
        const mappedType = this.mapTallyVoucherType(voucher.type);
        if (!mappedType) {
          results.skipped++;
          results.warnings.push({ voucher: voucher.number || voucher.id, warning: `Unknown voucher type: ${voucher.type}` });
          continue;
        }

        if (!voucher.ledgerEntries || voucher.ledgerEntries.length < 2) {
          results.skipped++;
          results.warnings.push({ voucher: voucher.number || voucher.id, warning: 'Insufficient ledger entries (need at least 2)' });
          continue;
        }

        if (createJournals && ledgerService) {
          const journalLines = await this.buildJournalLinesFromVoucher(voucher, accountCache);
          if (journalLines.lines.length >= 2) {
            const traceId = `TRC-TALLY-${Date.now()}-${randomUUID().slice(0, 8)}`;
            const journalEntry = await ledgerService.createJournalEntry({
              date: this.parseTallyDate(voucher.date) || new Date(),
              description: voucher.narration || voucher.party || `Tally import: ${voucher.type} ${voucher.number || ''}`,
              lines: journalLines.lines,
              reference: voucher.number || voucher.reference || `TALLY-${randomUUID().slice(0, 8)}`,
              source: 'SYSTEM',
              trace_id: traceId,
              tags: ['tally-import', mappedType],
            }, userId);

            if (ledgerService.validateDoubleEntry(journalLines.lines)) {
              await ledgerService.validateJournalEntry(journalEntry._id, userId);
              await ledgerService.postJournalEntry(journalEntry._id, userId);
              results.journalEntriesCreated++;
            }

            results.created++;
          } else {
            results.skipped++;
            results.warnings.push({ voucher: voucher.number, warning: 'Could not resolve enough accounts for journal lines' });
          }
        } else {
          results.created++;
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ voucher: voucher.number || voucher.id, error: err.message });
        logger.error(`Tally voucher import error: ${err.message}`, { voucher });
      }
    }

    importRecord.status = results.failed === 0 ? 'completed' : 'partial';
    importRecord.importResults = results;
    importRecord.validationResults = {
      totalRecords: vouchers.length,
      validRecords: results.created + results.skipped,
      invalidRecords: results.failed,
      warnings: results.warnings,
    };
    await importRecord.save();

    return { importRecord, results };
  }

  async buildJournalLinesFromVoucher(voucher, accountCache) {
    const lines = [];

    for (const entry of voucher.ledgerEntries) {
      const account = await this.resolveAccount(entry.ledgerName, accountCache);
      if (!account) continue;

      const absAmount = Math.abs(entry.amount).toFixed(2);
      if (entry.isDebit || entry.amount > 0) {
        lines.push({
          account: account._id,
          debit: absAmount,
          credit: '0',
          description: entry.ledgerName,
        });
      } else {
        lines.push({
          account: account._id,
          debit: '0',
          credit: absAmount,
          description: entry.ledgerName,
        });
      }
    }

    if (lines.length === 0 && voucher.ledgerEntries.length >= 2) {
      const first = voucher.ledgerEntries[0];
      const second = voucher.ledgerEntries[1];
      const amount = Math.abs(first.amount || second.amount || voucher.amount || 0).toFixed(2);

      const debitAccount = await this.resolveAccount(first.ledgerName, accountCache);
      const creditAccount = await this.resolveAccount(second.ledgerName, accountCache);

      if (debitAccount && creditAccount) {
        lines.push(
          { account: debitAccount._id, debit: amount, credit: '0', description: first.ledgerName },
          { account: creditAccount._id, debit: '0', credit: amount, description: second.ledgerName }
        );
      }
    }

    return { lines };
  }

  async resolveAccount(ledgerName, accountCache) {
    if (accountCache.has(ledgerName)) return accountCache.get(ledgerName);

    let account = await ChartOfAccounts.findOne({
      name: { $regex: new RegExp(`^${this.escapeRegex(ledgerName)}$`, 'i') },
      isActive: true,
    });

    if (!account) {
      account = await ChartOfAccounts.findOne({
        name: { $regex: new RegExp(ledgerName, 'i') },
        isActive: true,
      });
    }

    if (!account) {
      const inferredType = this.inferAccountType(ledgerName);
      const maxCode = await ChartOfAccounts.findOne({ type: inferredType }).sort({ code: -1 }).select('code');
      const nextCode = maxCode ? String(parseInt(maxCode.code) + 1) : this.getDefaultCode(inferredType);

      account = new ChartOfAccounts({
        code: nextCode,
        name: ledgerName,
        type: inferredType,
        normalBalance: this.MASTERS_MAP[inferredType]?.normalBalance || 'debit',
        description: `Auto-created from Tally import: ${ledgerName}`,
      });
      await account.save();
      logger.info(`Auto-created account: ${ledgerName} (${nextCode})`);
    }

    accountCache.set(ledgerName, account);
    return account;
  }

  inferAccountType(name) {
    const lower = name.toLowerCase();
    if (lower.includes('cash') || lower.includes('bank') || lower.includes('receivable') || lower.includes('asset')) return 'Asset';
    if (lower.includes('payable') || lower.includes('liability') || lower.includes('loan') || lower.includes('duty') || lower.includes('tax')) return 'Liability';
    if (lower.includes('capital') || lower.includes('equity') || lower.includes('retained')) return 'Equity';
    if (lower.includes('sales') || lower.includes('revenue') || lower.includes('income') || lower.includes('service')) return 'Income';
    if (lower.includes('purchase') || lower.includes('expense') || lower.includes('salary') || lower.includes('rent') || lower.includes('depreciation')) return 'Expense';
    return 'Expense';
  }

  getDefaultCode(type) {
    const codes = { Asset: '1000', Liability: '2000', Equity: '3000', Income: '4000', Expense: '5000' };
    return codes[type] || '5000';
  }

  async importMasters(data) {
    const { companyId, masters, userId } = data;
    const importRecord = new TallyImport({
      importType: 'masters', format: 'json', companyId, importedBy: userId,
    });

    const results = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

    for (const master of masters) {
      try {
        const existing = await ChartOfAccounts.findOne({ code: master.code });
        if (existing) {
          if (master.name && master.name !== existing.name) {
            existing.name = master.name;
            existing.description = `Updated from Tally import`;
            await existing.save();
            results.updated++;
          } else {
            results.skipped++;
          }
          continue;
        }

        const accountType = master.type || this.TALLY_GROUP_TO_TYPE[master.group] || 'Asset';
        const account = new ChartOfAccounts({
          code: master.code,
          name: master.name,
          type: accountType,
          normalBalance: this.MASTERS_MAP[accountType]?.normalBalance || 'debit',
          description: `Imported from Tally - ${master.group || ''}`,
        });
        await account.save();
        results.created++;
      } catch (err) {
        results.failed++;
        results.errors.push({ master: master.code, error: err.message });
      }
    }

    importRecord.status = results.failed === 0 ? 'completed' : 'partial';
    importRecord.importResults = results;
    await importRecord.save();

    return { importRecord, results };
  }

  // ─────────── GENERIC INGESTION PIPELINE ───────────

  async ingestFile(filePath, fileType, options = {}) {
    const { userId, companyId, source = 'unknown', createJournals = true } = options;

    let vouchers = [];
    let format = 'unknown';

    try {
      if (fileType === 'xml' || filePath.endsWith('.xml')) {
        vouchers = await this.parseTallyXMLFile(filePath);
        format = 'xml';
      } else if (fileType === 'csv' || filePath.endsWith('.csv')) {
        vouchers = await this.parseTallyCSVFile(filePath);
        format = 'csv';
      } else if (fileType === 'json' || filePath.endsWith('.json')) {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        vouchers = Array.isArray(parsed) ? parsed : parsed.vouchers || parsed.data || [];
        format = 'json';
      } else {
        throw new Error(`Unsupported file type: ${fileType}`);
      }
    } catch (err) {
      logger.error(`File parse error: ${err.message}`);
      throw new Error(`Failed to parse file: ${err.message}`);
    }

    const importRecord = new TallyImport({
      importType: options.importType || 'vouchers',
      format,
      companyId,
      file: { filename: filePath.split(/[/\\]/).pop(), path: filePath, mimetype: '', size: 0 },
      importedBy: userId,
      metadata: { source, originalFormat: fileType, voucherCount: vouchers.length },
    });
    await importRecord.save();

    const result = await this.importVouchers({
      companyId,
      vouchers,
      userId,
      createJournals,
    });

    importRecord.status = result.importRecord.status;
    importRecord.importResults = result.results;
    importRecord.validationResults = result.importRecord.validationResults;
    await importRecord.save();

    return {
      importId: importRecord.importId,
      format,
      totalVouchers: vouchers.length,
      results: result.results,
      importRecord,
    };
  }

  // ─────────── MIGRATION VALIDATION ───────────

  async validateMigrationReadiness(_companyId) {
    const checks = {
      accountsMigrated: false,
      openingBalancesSet: false,
      gstConfigured: false,
      tdsConfigured: false,
      vouchersImportable: false,
    };

    const accounts = await ChartOfAccounts.countDocuments({ isActive: true });
    checks.accountsMigrated = accounts > 0;

    const settings = await CompanySettings.findOne();
    checks.gstConfigured = !!settings?.gstin;
    checks.tdsConfigured = !!settings?.tan;

    checks.openingBalancesSet = true;
    checks.vouchersImportable = true;

    return {
      ready: Object.values(checks).every(v => v),
      checks,
      recommendations: Object.entries(checks)
        .filter(([, v]) => !v)
        .map(([k]) => `Complete ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`),
    };
  }

  // ─────────── XML GENERATION ───────────

  generateTallyXML(journals) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY>\n<IMPORTDATA>\n<REQUESTDESC>\n<REPORTNAME>Vouchers</REPORTNAME>\n</REQUESTDESC>\n<REQUESTDATA>\n';

    for (const journal of journals) {
      xml += `<TALLYMESSAGE xmlns:UDF="TallyUDF">\n`;
      xml += `<VOUCHER VCHTYPE="${journal.source || 'Journal'}" ACTION="Create" OBJVIEW="Accounting Voucher View">\n`;
      xml += `<DATE>${this.formatTallyDate(journal.date)}</DATE>\n`;
      xml += `<NARRATION>${this.escapeXml(journal.description)}</NARRATION>\n`;
      xml += `<VOUCHERNUMBER>${journal.entryNumber}</VOUCHERNUMBER>\n`;

      for (const line of journal.lines) {
        const account = line.account;
        xml += `<ALLLEDGERENTRIES.LIST>\n`;
        xml += `<LEDGERNAME>${this.escapeXml(account?.name || 'Unknown')}</LEDGERNAME>\n`;
        xml += `<AMOUNT>${new Decimal(line.debit || 0).gt(0) ? line.debit : `-${line.credit}`}</AMOUNT>\n`;
        xml += `</ALLLEDGERENTRIES.LIST>\n`;
      }

      xml += `</VOUCHER>\n</TALLYMESSAGE>\n`;
    }

    xml += '</REQUESTDATA>\n</IMPORTDATA>\n</BODY>\n</ENVELOPE>';
    return xml;
  }

  // ─────────── HELPERS ───────────

  mapTallyVoucherType(tallyType) {
    if (!tallyType) return null;
    const normalized = String(tallyType).trim();
    return TallyCompatibilityService.VOUCHER_TYPE_MAP[normalized] ||
      Object.keys(TallyCompatibilityService.VOUCHER_MAP).find(
        k => TallyCompatibilityService.VOUCHER_MAP[k].tallyType.toLowerCase() === normalized.toLowerCase()
      ) || null;
  }

  mapTallyVoucherToARTHA(voucher) {
    const voucherType = this.mapTallyVoucherType(voucher.type);
    if (!voucherType) return null;

    return {
      type: voucherType,
      date: new Date(voucher.date),
      number: voucher.number,
      amount: voucher.amount,
      party: voucher.party,
      narration: voucher.narration,
      reference: voucher.reference,
    };
  }

  formatTallyDate(date) {
    const d = new Date(date);
    return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;
  }

  parseTallyDate(dateStr) {
    if (!dateStr) return null;
    const ddmmyyyy = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (ddmmyyyy) return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  escapeXml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export default new TallyCompatibilityService();
