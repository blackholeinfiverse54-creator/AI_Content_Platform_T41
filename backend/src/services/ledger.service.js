import Decimal from 'decimal.js';
import JournalEntry from '../models/JournalEntry.js';
import LedgerEntry from '../models/LedgerEntry.js';
import AccountBalance from '../models/AccountBalance.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import AuditLog from '../models/AuditLog.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';
import cacheService from './cache.service.js';
import { withTransaction, areTransactionsAvailable } from '../config/database.js';
import {
  calculateGSTBreakdown,
  buildGSTValidationError,
  validateGSTDetailShape,
} from './gstEngine.service.js';

const JOURNAL_STATUS = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  POSTED: 'POSTED',
  VOIDED: 'VOIDED',
};

const POSTED_STATUSES = ['POSTED', 'posted'];
const VOIDED_STATUSES = ['VOIDED', 'voided'];
const VALIDATED_STATUSES = ['VALIDATED', 'validated'];
const DRAFT_STATUSES = ['DRAFT', 'draft'];
const ROUNDING_TOLERANCE = new Decimal('0.01');

class LedgerService {
  normalizeStatusFilter(status) {
    if (!status) return null;

    const normalized = String(status).toUpperCase();
    if (normalized === JOURNAL_STATUS.POSTED) return { $in: POSTED_STATUSES };
    if (normalized === JOURNAL_STATUS.DRAFT) return { $in: DRAFT_STATUSES };
    if (normalized === JOURNAL_STATUS.VALIDATED) return { $in: VALIDATED_STATUSES };
    if (normalized === JOURNAL_STATUS.VOIDED) return { $in: VOIDED_STATUSES };

    return status;
  }

  validateJournal(journalLines) {
    const totalDebit = journalLines.reduce(
      (sum, line) => sum.plus(new Decimal(line.debit || 0)),
      new Decimal(0)
    );
    const totalCredit = journalLines.reduce(
      (sum, line) => sum.plus(new Decimal(line.credit || 0)),
      new Decimal(0)
    );

    if (!totalDebit.equals(totalCredit)) {
      throw new Error('Journal not balanced');
    }

    return {
      balanced: true,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
    };
  }

  /**
   * Validate double-entry: debits must equal credits
   */
  validateDoubleEntry(lines) {
    this.validateJournal(lines);
    return true;
  }

  /**
   * Validate that each line has only debit OR credit (not both)
   */
  validateLineIntegrity(lines) {
    lines.forEach((line, index) => {
      const debit = new Decimal(line.debit || 0);
      const credit = new Decimal(line.credit || 0);

      if (!debit.isZero() && !credit.isZero()) {
        throw new Error(`Line ${index + 1}: Cannot have both debit and credit`);
      }

      if (debit.isZero() && credit.isZero()) {
        throw new Error(`Line ${index + 1}: Must have either debit or credit`);
      }

      if (debit.isNegative() || credit.isNegative()) {
        throw new Error(`Line ${index + 1}: Amounts cannot be negative`);
      }
    });

    return true;
  }

  /**
   * Validate that all accounts exist and are active
   */
  async validateAccounts(lines) {
    const accountIds = lines.map(line => line.account);
    const accounts = await ChartOfAccounts.find({
      _id: { $in: accountIds },
      isActive: true,
    });

    if (accounts.length !== accountIds.length) {
      throw new Error('One or more accounts are invalid or inactive');
    }

    return accounts;
  }

  buildAuditSnapshot(entry) {
    return {
      id: entry?._id ? String(entry._id) : undefined,
      entryNumber: entry?.entryNumber,
      date: entry?.date,
      description: entry?.description,
      lines: entry?.lines,
      reference: entry?.reference,
      reference_entry_id: entry?.reference_entry_id
        ? String(entry.reference_entry_id)
        : undefined,
      status: entry?.status,
      source: entry?.source,
      tags: entry?.tags,
      gstDetails: entry?.gstDetails,
      correctionMetadata: entry?.correctionMetadata,
    };
  }

  buildAuditTraceEntry({ action, entry, beforeState, afterState, userId }) {
    return {
      action,
      entity_id: entry?._id ? String(entry._id) : 'unknown',
      before_state: beforeState ?? null,
      after_state: afterState ?? {},
      action_user: userId ? String(userId) : null,
      timestamp: new Date().toISOString(),
      trace_id: entry?.trace_id || entry?.auditTrace?.trace_id || 'unknown',
    };
  }

  validateGSTDetails(entry, gstTotals) {
    const gstDetails = entry.gstDetails;

    if (!Array.isArray(gstDetails) || gstDetails.length === 0) {
      throw buildGSTValidationError('GST details are required for GST entries', {
        entryId: String(entry._id),
      });
    }

    let hasIGST = false;
    let hasCGSTSGST = false;
    let outputCGST = new Decimal(0);
    let outputSGST = new Decimal(0);
    let outputIGST = new Decimal(0);
    let inputCGST = new Decimal(0);
    let inputSGST = new Decimal(0);
    let inputIGST = new Decimal(0);

    gstDetails.forEach((detail) => {
      validateGSTDetailShape(detail);

      const computed = calculateGSTBreakdown({
        transaction_type: detail.transaction_type,
        amount: detail.taxable_value,
        gst_rate: detail.gst_rate,
        supplier_state: detail.supplier_state,
        company_state: detail.company_state,
      });

      const expectedCGST = new Decimal(computed.cgst || 0);
      const expectedSGST = new Decimal(computed.sgst || 0);
      const expectedIGST = new Decimal(computed.igst || 0);
      const actualCGST = new Decimal(detail.cgst || 0);
      const actualSGST = new Decimal(detail.sgst || 0);
      const actualIGST = new Decimal(detail.igst || 0);

      if (expectedCGST.minus(actualCGST).abs().greaterThan(ROUNDING_TOLERANCE) ||
          expectedSGST.minus(actualSGST).abs().greaterThan(ROUNDING_TOLERANCE) ||
          expectedIGST.minus(actualIGST).abs().greaterThan(ROUNDING_TOLERANCE)) {
        throw buildGSTValidationError('GST detail amounts do not match rate calculation', {
          detail,
          expected: computed,
        });
      }

      if (!expectedIGST.isZero()) {
        hasIGST = true;
      }

      if (!expectedCGST.isZero() || !expectedSGST.isZero()) {
        hasCGSTSGST = true;
      }

      if (detail.transaction_type === 'sale') {
        outputCGST = outputCGST.plus(actualCGST.abs());
        outputSGST = outputSGST.plus(actualSGST.abs());
        outputIGST = outputIGST.plus(actualIGST.abs());
      } else {
        inputCGST = inputCGST.plus(actualCGST.abs());
        inputSGST = inputSGST.plus(actualSGST.abs());
        inputIGST = inputIGST.plus(actualIGST.abs());
      }
    });

    if (hasIGST && hasCGSTSGST) {
      throw buildGSTValidationError('Mixed GST tax types are not allowed', {
        entryId: String(entry._id),
      });
    }

    const compareTotals = (expected, actual, label) => {
      if (expected.minus(actual).abs().greaterThan(ROUNDING_TOLERANCE)) {
        throw buildGSTValidationError('GST ledger totals do not match GST details', {
          label,
          expected: expected.toString(),
          actual: actual.toString(),
        });
      }
    };

    if (gstTotals.outputCGST) {
      compareTotals(outputCGST, gstTotals.outputCGST, 'outputCGST');
    }
    if (gstTotals.outputSGST) {
      compareTotals(outputSGST, gstTotals.outputSGST, 'outputSGST');
    }
    if (gstTotals.outputIGST) {
      compareTotals(outputIGST, gstTotals.outputIGST, 'outputIGST');
    }
    if (gstTotals.inputCGST) {
      compareTotals(inputCGST, gstTotals.inputCGST, 'inputCGST');
    }
    if (gstTotals.inputSGST) {
      compareTotals(inputSGST, gstTotals.inputSGST, 'inputSGST');
    }
    if (gstTotals.inputIGST) {
      compareTotals(inputIGST, gstTotals.inputIGST, 'inputIGST');
    }

    return true;
  }

  validateTDS(tds, expense) {
    const tdsDecimal = new Decimal(tds || 0);
    const expenseDecimal = new Decimal(expense || 0);

    if (tdsDecimal.greaterThan(expenseDecimal)) {
      throw new Error('Invalid TDS');
    }

    return true;
  }

  validateComplianceRules(entry, accountsById) {
    let outputCGST = new Decimal(0);
    let outputSGST = new Decimal(0);
    let outputIGST = new Decimal(0);
    let inputCGST = new Decimal(0);
    let inputSGST = new Decimal(0);
    let inputIGST = new Decimal(0);
    let taxableRevenue = new Decimal(0);
    let taxableExpense = new Decimal(0);
    let tdsPayable = new Decimal(0);
    let tdsExpense = new Decimal(0);
    let hasGST = false;
    let hasTDS = false;

    entry.lines.forEach((line) => {
      const account = accountsById.get(String(line.account));
      const accountName = (account?.name || '').toLowerCase();
      const accountType = (account?.type || '').toLowerCase();
      const debit = new Decimal(line.debit || 0);
      const credit = new Decimal(line.credit || 0);
      const lineAmount = debit.plus(credit);

      if (accountName.includes('output cgst')) {
        hasGST = true;
        outputCGST = outputCGST.plus(lineAmount);
      }

      if (accountName.includes('output sgst')) {
        hasGST = true;
        outputSGST = outputSGST.plus(lineAmount);
      }

      if (accountName.includes('output igst')) {
        hasGST = true;
        outputIGST = outputIGST.plus(lineAmount);
      }

      if (accountName.includes('input cgst')) {
        hasGST = true;
        inputCGST = inputCGST.plus(lineAmount);
      }

      if (accountName.includes('input sgst')) {
        hasGST = true;
        inputSGST = inputSGST.plus(lineAmount);
      }

      if (accountName.includes('input igst')) {
        hasGST = true;
        inputIGST = inputIGST.plus(lineAmount);
      }

      if (accountType === 'income') {
        taxableRevenue = taxableRevenue.plus(credit);
      }

      if (accountType === 'expense') {
        taxableExpense = taxableExpense.plus(debit);
      }

      if (accountName.includes('tds payable')) {
        hasTDS = true;
        tdsPayable = tdsPayable.plus(credit);
      }

      if (accountType === 'expense') {
        tdsExpense = tdsExpense.plus(debit);
      }
    });

    if (hasGST) {
      if (entry.gstDetails?.length) {
        this.validateGSTDetails(entry, {
          outputCGST,
          outputSGST,
          outputIGST,
          inputCGST,
          inputSGST,
          inputIGST,
        });
      } else {
        throw buildGSTValidationError('GST details are missing for GST accounts', {
          entryId: String(entry._id),
        });
      }
    } else if (entry.gstDetails?.length) {
      throw buildGSTValidationError('GST accounts are missing for GST details', {
        entryId: String(entry._id),
      });
    }

    if (hasTDS) {
      this.validateTDS(tdsPayable, tdsExpense);
    }

    return {
      gst_valid: true,
      tds_valid: true,
      hasGST,
      hasTDS,
    };
  }

  async ensureComplianceAccounts(session = null) {
    const requiredAccounts = [
      {
        code: '2301',
        name: 'Input CGST',
        type: 'Asset',
        subtype: 'Current Asset',
        normalBalance: 'debit',
      },
      {
        code: '2302',
        name: 'Input SGST',
        type: 'Asset',
        subtype: 'Current Asset',
        normalBalance: 'debit',
      },
      {
        code: '2303',
        name: 'Input IGST',
        type: 'Asset',
        subtype: 'Current Asset',
        normalBalance: 'debit',
      },
      {
        code: '2311',
        name: 'Output CGST',
        type: 'Liability',
        subtype: 'Current Liability',
        normalBalance: 'credit',
      },
      {
        code: '2312',
        name: 'Output SGST',
        type: 'Liability',
        subtype: 'Current Liability',
        normalBalance: 'credit',
      },
      {
        code: '2313',
        name: 'Output IGST',
        type: 'Liability',
        subtype: 'Current Liability',
        normalBalance: 'credit',
      },
      {
        code: '4010',
        name: 'Sales Returns',
        type: 'Expense',
        subtype: 'Contra Revenue',
        normalBalance: 'debit',
      },
      {
        code: '2400',
        name: 'TDS Payable',
        type: 'Liability',
        subtype: 'Current Liability',
        normalBalance: 'credit',
      },
    ];

    for (const accountData of requiredAccounts) {
      const existingQuery = ChartOfAccounts.findOne({ code: accountData.code });
      const existingAccount = session ? await existingQuery.session(session) : await existingQuery;

      if (!existingAccount) {
        const account = new ChartOfAccounts(accountData);
        await account.save(session ? { session } : {});
      }
    }
  }

  async validateJournalEntry(entryId, userId) {
    return await withTransaction(async (session) => {
      await this.ensureComplianceAccounts(session);

      const entry = await JournalEntry.findById(entryId).session(session);

      if (!entry) {
        throw new Error('Entry not found');
      }

      if (POSTED_STATUSES.includes(entry.status)) {
        throw new Error('Journal entry is already posted');
      }

      if (VOIDED_STATUSES.includes(entry.status)) {
        throw new Error('Cannot validate a voided entry');
      }

      if (!entry.description || !entry.lines || entry.lines.length < 2) {
        entry.status = JOURNAL_STATUS.DRAFT;
        await entry.save({ session });
        throw new Error('incomplete_data');
      }

      this.validateLineIntegrity(entry.lines);
      const journalValidation = this.validateJournal(entry.lines);
      const accounts = await this.validateAccounts(entry.lines);
      const accountsById = new Map(accounts.map((account) => [String(account._id), account]));
      const complianceValidation = this.validateComplianceRules(entry, accountsById);

      if (!entry.trace_id || !entry.source) {
        throw new Error('Audit trace metadata is required');
      }

      if (!entry.auditTrace || !entry.auditTrace.action || !entry.auditTrace.trace_id) {
        throw new Error('Audit trace record is required');
      }

      const beforeState = this.buildAuditSnapshot(entry);

      entry.status = JOURNAL_STATUS.VALIDATED;

      const afterState = {
        ...this.buildAuditSnapshot(entry),
        validation: {
          ...journalValidation,
          ...complianceValidation,
        },
      };

      const auditRecord = this.buildAuditTraceEntry({
        action: 'VALIDATED',
        entry,
        beforeState,
        afterState,
        userId,
      });

      entry.auditTrace = auditRecord;
      if (!entry.auditTrail) entry.auditTrail = [];
      entry.auditTrail.push(auditRecord);

      await entry.save({ session });
      return entry;
    });
  }

  /**
   * Get the previous hash for chain continuity
   */
  async getPreviousHash() {
    const lastEntry = await JournalEntry.findOne({ status: { $in: POSTED_STATUSES } })
      .sort({ createdAt: -1 })
      .select('immutable_hash');

    return lastEntry ? lastEntry.immutable_hash : '0';
  }

  /**
   * Create a new journal entry with hash-chain enforcement
   */
  async createJournalEntry(entryData, userId) {
    return await withTransaction(async (session) => {
      await this.ensureComplianceAccounts(session);

      const {
        date,
        description,
        lines,
        reference,
        reference_entry_id,
        tags,
        source,
        trace_id,
        gstDetails,
        auditAction,
        auditBeforeState,
        auditAfterState,
      } = entryData;

      if (!lines || !Array.isArray(lines) || lines.length < 2) {
        throw new Error('Journal entry must contain at least 2 lines');
      }

      // Get the latest entry to find prevHash and chainPosition
      const lastEntry = await JournalEntry.findOne({ status: { $in: POSTED_STATUSES } })
        .sort({ chainPosition: -1 })
        .session(session);

      const prevHash = lastEntry?.hash || lastEntry?.immutable_hash || '0';
      const chainPosition = (lastEntry?.chainPosition ?? -1) + 1;

      // Compute hash for new entry
      const tempEntry = {
        entryNumber: 'TEMP',
        date: date || new Date(),
        description,
        lines,
        reference,
        status: JOURNAL_STATUS.DRAFT,
      };
      const hash = JournalEntry.computeHash(tempEntry, prevHash);

      // Create journal entry with hash-chain
      const journalEntry = new JournalEntry({
        date: date || new Date(),
        description,
        lines,
        reference,
        reference_entry_id,
        tags,
        status: JOURNAL_STATUS.DRAFT,
        source: source || 'MANUAL',
        trace_id,
        created_at: new Date(),
        gstDetails: Array.isArray(gstDetails) && gstDetails.length ? gstDetails : undefined,
        prevHash,
        hash,
        chainPosition,
        prev_hash: prevHash, // Legacy field
        immutable_hash: hash, // Legacy field
      });

      const auditRecord = this.buildAuditTraceEntry({
        action: auditAction || 'ENTRY_CREATED',
        entry: journalEntry,
        beforeState: auditBeforeState ?? null,
        afterState: auditAfterState || this.buildAuditSnapshot(journalEntry),
        userId,
      });

      journalEntry.auditTrace = auditRecord;
      journalEntry.auditTrail = [auditRecord];

      await journalEntry.save(session ? { session } : {});
      
      logger.info(`Journal entry created: ${journalEntry.entryNumber}`, {
        hash: journalEntry.hash,
        chainPosition: journalEntry.chainPosition,
        status: journalEntry.status,
        transactionMode: session ? 'with-transaction' : 'without-transaction',
      });

      return journalEntry;
    });
  }

  async createCreditNote(noteData, userId) {
    const {
      amount,
      gst_rate,
      supplier_state,
      company_state,
      reference,
      description,
      customerName,
      reference_entry_id,
      date,
    } = noteData;

    if (amount === undefined || amount === null) {
      throw buildGSTValidationError('Credit note amount is required', {
        field: 'amount',
      });
    }

    const gstDetail = calculateGSTBreakdown({
      transaction_type: 'sale',
      amount,
      gst_rate,
      supplier_state,
      company_state,
    });

    const taxableAmount = new Decimal(gstDetail.taxable_value || 0);
    const totalTax = new Decimal(gstDetail.cgst || 0)
      .plus(gstDetail.sgst || 0)
      .plus(gstDetail.igst || 0);
    const totalAmount = taxableAmount.plus(totalTax);

    const arAccount = await ChartOfAccounts.findOne({ code: '1100' });
    const salesReturnAccount = await ChartOfAccounts.findOne({ code: '4010' });
    const outputCGST = await ChartOfAccounts.findOne({ code: '2311' });
    const outputSGST = await ChartOfAccounts.findOne({ code: '2312' });
    const outputIGST = await ChartOfAccounts.findOne({ code: '2313' });

    if (!arAccount || !salesReturnAccount || !outputCGST || !outputSGST || !outputIGST) {
      throw new Error('Required accounts not found');
    }

    const lines = [
      {
        account: salesReturnAccount._id,
        debit: taxableAmount.toString(),
        credit: '0',
        description: 'Sales Returns',
      },
    ];

    if (new Decimal(gstDetail.cgst || 0).greaterThan(0)) {
      lines.push({
        account: outputCGST._id,
        debit: gstDetail.cgst,
        credit: '0',
        description: 'Output CGST reversal',
      });
    }

    if (new Decimal(gstDetail.sgst || 0).greaterThan(0)) {
      lines.push({
        account: outputSGST._id,
        debit: gstDetail.sgst,
        credit: '0',
        description: 'Output SGST reversal',
      });
    }

    if (new Decimal(gstDetail.igst || 0).greaterThan(0)) {
      lines.push({
        account: outputIGST._id,
        debit: gstDetail.igst,
        credit: '0',
        description: 'Output IGST reversal',
      });
    }

    lines.push({
      account: arAccount._id,
      debit: '0',
      credit: totalAmount.toString(),
      description: 'Accounts Receivable reversal',
    });

    const journalEntry = await this.createJournalEntry(
      {
        date: date || new Date(),
        description: description || `Credit note for ${customerName || reference || 'sales return'}`,
        lines,
        reference,
        reference_entry_id,
        tags: ['credit-note', reference].filter(Boolean),
        source: 'MANUAL',
        trace_id: noteData.trace_id,
        gstDetails: [{
          ...gstDetail,
          amount: taxableAmount.toString(),
        }],
        auditAction: 'CREDIT_NOTE_CREATED',
      },
      userId
    );

    await this.validateJournalEntry(journalEntry._id, userId);
    await this.postJournalEntry(journalEntry._id, userId);

    return journalEntry;
  }

  async createDebitNote(noteData, userId) {
    const {
      amount,
      expenseAccountId,
      expenseAccountCode,
      reference,
      description,
      reference_entry_id,
      date,
    } = noteData;

    if (amount === undefined || amount === null) {
      throw new Error('Debit note amount is required');
    }

    let expenseAccount = null;
    if (expenseAccountId) {
      expenseAccount = await ChartOfAccounts.findById(expenseAccountId);
    } else if (expenseAccountCode) {
      expenseAccount = await ChartOfAccounts.findOne({ code: expenseAccountCode });
    }

    const payableAccount = await ChartOfAccounts.findOne({ code: '2000' });

    if (!expenseAccount || !payableAccount) {
      throw new Error('Required accounts not found');
    }

    const amountDecimal = new Decimal(amount);
    const journalEntry = await this.createJournalEntry(
      {
        date: date || new Date(),
        description: description || `Debit note for ${reference || 'payable adjustment'}`,
        lines: [
          {
            account: expenseAccount._id,
            debit: amountDecimal.toString(),
            credit: '0',
            description: 'Debit note expense',
          },
          {
            account: payableAccount._id,
            debit: '0',
            credit: amountDecimal.toString(),
            description: 'Accounts Payable',
          },
        ],
        reference,
        reference_entry_id,
        tags: ['debit-note', reference].filter(Boolean),
        source: 'MANUAL',
        trace_id: noteData.trace_id,
        auditAction: 'DEBIT_NOTE_CREATED',
      },
      userId
    );

    await this.validateJournalEntry(journalEntry._id, userId);
    await this.postJournalEntry(journalEntry._id, userId);

    return journalEntry;
  }

  async createReversalEntry(entryId, userId, reason = null) {
    const entry = await JournalEntry.findById(entryId);

    if (!entry) {
      throw new Error('Entry not found');
    }

    if (VOIDED_STATUSES.includes(entry.status)) {
      throw new Error('Cannot reverse a voided entry');
    }

    const reversingLines = entry.lines.map((line) => ({
      account: line.account,
      debit: line.credit,
      credit: line.debit,
      description: `REVERSAL: ${line.description || ''}`,
    }));

    const journalEntry = await this.createJournalEntry(
      {
        date: new Date(),
        description: reason
          ? `Reversal of ${entry.entryNumber} - ${reason}`
          : `Reversal of ${entry.entryNumber}`,
        lines: reversingLines,
        reference: `REV-${entry.entryNumber}`,
        reference_entry_id: entry._id,
        tags: ['reversal', entry.entryNumber],
        source: 'SYSTEM',
        trace_id: entry.trace_id,
        gstDetails: Array.isArray(entry.gstDetails) && entry.gstDetails.length
          ? entry.gstDetails
          : undefined,
        correctionMetadata: {
          originalTransactionId: String(entry._id),
          reversalReference: `REV-${entry.entryNumber}`,
          correctionReason: reason || 'Reversal entry',
          createdBy: userId,
          createdAt: new Date(),
        },
        auditAction: 'REVERSAL_CREATED',
      },
      userId
    );

    await this.validateJournalEntry(journalEntry._id, userId);
    await this.postJournalEntry(journalEntry._id, userId);

    return journalEntry;
  }

  /**
   * Post a journal entry (move to posted state with chain finalization)
   */
  async postJournalEntry(entryId, userId) {
    return await withTransaction(async (session) => {
      const entry = await JournalEntry.findById(entryId).session(session);

      if (!entry) {
        throw new Error('Entry not found');
      }

      if (POSTED_STATUSES.includes(entry.status)) {
        throw new Error('Journal entry is already posted');
      }

      if (VOIDED_STATUSES.includes(entry.status)) {
        throw new Error('Cannot post a voided entry');
      }

      if (!VALIDATED_STATUSES.includes(entry.status)) {
        throw new Error('Cannot post unvalidated entry');
      }

      // Verify hash before posting (tamper detection)
      if (entry.verifyHash && !entry.verifyHash()) {
        throw new Error('Entry hash verification failed - possible tampering');
      }

      const ledgerEntries = await this.writeLedgerEntries(entry, session);

      const beforeState = this.buildAuditSnapshot(entry);

      // Update entry status
      entry.status = JOURNAL_STATUS.POSTED;
      entry.postedBy = userId;
      entry.postedAt = new Date();

      const afterState = {
        ...this.buildAuditSnapshot(entry),
        posting: {
          prevHash: entry.prevHash || entry.prev_hash,
          hash: entry.hash || entry.immutable_hash,
          ledgerEntriesCreated: ledgerEntries.length,
        },
      };

      const auditRecord = this.buildAuditTraceEntry({
        action: 'POSTED',
        entry,
        beforeState,
        afterState,
        userId,
      });

      entry.auditTrace = auditRecord;
      if (!entry.auditTrail) entry.auditTrail = [];
      entry.auditTrail.push(auditRecord);
      
      // Hash will be recalculated in pre-save hook
      await entry.save({ session });

      // Update account balances
      await this.updateAccountBalances(entry.lines, session);
      
      // Invalidate related caches
      await cacheService.invalidateLedgerCaches();
      
      logger.info(`Journal entry posted: ${entry.entryNumber}`, {
        hash: entry.hash,
        chainPosition: entry.chainPosition,
        postedBy: userId,
        ledgerEntries: ledgerEntries.length,
        transactionMode: session ? 'with-transaction' : 'without-transaction',
      });

      return entry;
    });
  }

  /**
   * Update account balances based on journal entry lines
   */
  async updateAccountBalances(lines, session = null) {
    for (const line of lines) {
      const debit = new Decimal(line.debit || 0);
      const credit = new Decimal(line.credit || 0);

      // Find or create account balance with optional session
      const query = AccountBalance.findOne({ account: line.account });
      let accountBalance = session ? await query.session(session) : await query;

      if (!accountBalance) {
        accountBalance = new AccountBalance({
          account: line.account,
          balance: '0',
          debitTotal: '0',
          creditTotal: '0',
        });
      }

      // Update totals
      const currentDebitTotal = new Decimal(accountBalance.debitTotal);
      const currentCreditTotal = new Decimal(accountBalance.creditTotal);

      accountBalance.debitTotal = currentDebitTotal.plus(debit).toString();
      accountBalance.creditTotal = currentCreditTotal.plus(credit).toString();

      // Calculate net balance (debit - credit)
      const netBalance = new Decimal(accountBalance.debitTotal).minus(
        new Decimal(accountBalance.creditTotal)
      );
      accountBalance.balance = netBalance.toString();
      accountBalance.lastUpdated = new Date();

      // Save with optional session
      await accountBalance.save(session ? { session } : {});
    }
  }

  async writeLedgerEntries(entry, session = null) {
    const query = LedgerEntry.findOne({}).sort({ timestamp: -1, _id: -1 }).select('hash');
    const lastLedgerEntry = session ? await query.session(session) : await query;

    let prevHash = lastLedgerEntry ? lastLedgerEntry.hash : '0';
    const ledgerDocs = [];

    for (const line of entry.lines) {
      const accountId = String(line.account);
      const debit = new Decimal(line.debit || 0);
      const credit = new Decimal(line.credit || 0);

      if (debit.greaterThan(0)) {
        const amount = debit.toString();
        const hash = LedgerEntry.computeHash({
          journalId: String(entry._id),
          accountId,
          amount,
          prevHash,
        });

        ledgerDocs.push({
          journal_id: String(entry._id),
          account_id: accountId,
          type: 'DEBIT',
          amount,
          prev_hash: prevHash,
          hash,
          timestamp: new Date(),
        });

        prevHash = hash;
      }

      if (credit.greaterThan(0)) {
        const amount = credit.toString();
        const hash = LedgerEntry.computeHash({
          journalId: String(entry._id),
          accountId,
          amount,
          prevHash,
        });

        ledgerDocs.push({
          journal_id: String(entry._id),
          account_id: accountId,
          type: 'CREDIT',
          amount,
          prev_hash: prevHash,
          hash,
          timestamp: new Date(),
        });

        prevHash = hash;
      }
    }

    if (!ledgerDocs.length) {
      throw new Error('No ledger lines generated from journal entry');
    }

    await LedgerEntry.insertMany(ledgerDocs, session ? { session } : {});
    return ledgerDocs;
  }

  /**
   * Get journal entries with pagination and filters
   */
  async getJournalEntries(filters = {}, pagination = {}) {
    const {
      status,
      dateFrom,
      dateTo,
      account,
      search,
    } = filters;

    const {
      page = 1,
      limit = 20,
      sortBy = 'date',
      sortOrder = 'desc',
    } = pagination;

    const query = {};

    if (status) {
      query.status = this.normalizeStatusFilter(status);
    }

    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo) query.date.$lte = new Date(dateTo);
    }

    if (account) {
      query['lines.account'] = account;
    }

    if (search) {
      query.$or = [
        { entryNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [entries, total] = await Promise.all([
      JournalEntry.find(query)
        .populate('lines.account', 'code name type')
        .populate('postedBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      JournalEntry.countDocuments(query),
    ]);

    return {
      entries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single journal entry by ID
   */
  async getJournalEntryById(entryId) {
    const entry = await JournalEntry.findById(entryId)
      .populate('lines.account', 'code name type normalBalance')
      .populate('postedBy', 'name email');

    if (!entry) {
      throw new Error('Journal entry not found');
    }

    return entry;
  }

  /**
   * Verify entire ledger chain (Enhanced with detailed reporting)
   */
  async verifyLedgerChain() {
    try {
      const entries = await LedgerEntry.find({})
        .sort({ timestamp: 1, _id: 1 })
        .exec();

      if (entries.length === 0) {
        return {
          isValid: true,
          totalEntries: 0,
          errors: [],
          message: 'No entries to verify',
        };
      }

      const errors = [];
      let expectedPrevHash = '0'; // Genesis hash

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const entryPrevHash = entry.prev_hash;
        const entryHash = entry.hash;
        const computedHash = LedgerEntry.computeHash({
          journalId: entry.journal_id,
          accountId: entry.account_id,
          amount: entry.amount,
          prevHash: entryPrevHash,
        });

        // Check prevHash linkage
        if (entryPrevHash !== expectedPrevHash) {
          errors.push({
            position: i,
            journalId: entry.journal_id,
            issue: 'Chain linkage broken',
            expectedPrevHash,
            actualPrevHash: entryPrevHash,
          });
        }

        // Verify entry hash
        if (computedHash !== entryHash) {
          errors.push({
            position: i,
            journalId: entry.journal_id,
            issue: 'Hash mismatch (possible tampering)',
            expectedHash: computedHash,
            actualHash: entryHash,
          });
        }

        // Update expected prevHash for next iteration
        expectedPrevHash = entryHash;
      }

      const isValid = errors.length === 0;

      logger.info(`Ledger chain verification: ${isValid ? 'VALID' : 'INVALID'}`, {
        totalEntries: entries.length,
        errorCount: errors.length,
      });

      return {
        isValid,
        totalEntries: entries.length,
        errors,
        lastHash: entries[entries.length - 1]?.hash,
        chainLength: entries.length,
        message: isValid
          ? 'Ledger chain is valid and tamper-proof'
          : `Ledger integrity issues detected at ${errors.length} point(s)`,
      };
    } catch (error) {
      logger.error('Verify ledger chain error:', error);
      throw error;
    }
  }

  /**
   * Verify chain from specific entry (Enhanced)
   */
  async verifyChainFromEntry(entryId) {
    const entries = await LedgerEntry.find({ journal_id: String(entryId) })
      .sort({ timestamp: 1, _id: 1 })
      .exec();

    if (!entries.length) {
      throw new Error('Ledger entries not found for journal entry');
    }

    const errors = [];
    let expectedPrevHash = entries[0].prev_hash;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const computedHash = LedgerEntry.computeHash({
        journalId: entry.journal_id,
        accountId: entry.account_id,
        amount: entry.amount,
        prevHash: entry.prev_hash,
      });

      if (entry.prev_hash !== expectedPrevHash) {
        errors.push({
          position: i,
          issue: 'Chain linkage broken',
          expectedPrevHash,
          actualPrevHash: entry.prev_hash,
        });
      }

      if (computedHash !== entry.hash) {
        errors.push({
          position: i,
          issue: 'Hash mismatch (possible tampering)',
          expectedHash: computedHash,
          actualHash: entry.hash,
        });
      }

      expectedPrevHash = entry.hash;
    }

    return {
      isValid: errors.length === 0,
      totalEntriesVerified: entries.length,
      errors,
    };
  }

  /**
   * Get chain statistics
   */
  async getChainStatistics() {
    const stats = await LedgerEntry.aggregate([
      {
        $match: {}
      },
      {
        $group: {
          _id: null,
          totalEntries: { $sum: 1 },
          oldestEntry: { $min: '$timestamp' },
          newestEntry: { $max: '$timestamp' },
        }
      }
    ]);

    const result = stats[0] || {
      totalEntries: 0,
    };

    return {
      totalPostedEntries: result.totalEntries,
      chainLength: result.totalEntries,
      oldestEntry: result.oldestEntry,
      newestEntry: result.newestEntry,
      hasGaps: false,
    };
  }

  /**
   * Get account balances with optional filters
   */
  async getAccountBalances(filters = {}) {
    const { accountType, minBalance, maxBalance, search } = filters;

    const pipeline = [
      {
        $lookup: {
          from: 'chartofaccounts',
          localField: 'account',
          foreignField: '_id',
          as: 'accountDetails',
        },
      },
      {
        $unwind: '$accountDetails',
      },
    ];

    // Add filters
    const matchStage = { 'accountDetails.isActive': true };

    if (accountType) {
      matchStage['accountDetails.type'] = accountType;
    }

    if (search) {
      matchStage.$or = [
        { 'accountDetails.name': { $regex: search, $options: 'i' } },
        { 'accountDetails.code': { $regex: search, $options: 'i' } },
      ];
    }

    pipeline.push({ $match: matchStage });

    // Filter by balance range (convert to number for comparison)
    if (minBalance !== undefined || maxBalance !== undefined) {
      pipeline.push({
        $addFields: {
          balanceNum: { $toDouble: '$balance' },
        },
      });

      const balanceFilter = {};
      if (minBalance !== undefined) balanceFilter.$gte = parseFloat(minBalance);
      if (maxBalance !== undefined) balanceFilter.$lte = parseFloat(maxBalance);

      pipeline.push({
        $match: { balanceNum: balanceFilter },
      });
    }

    // Project final shape
    pipeline.push({
      $project: {
        account: '$accountDetails._id',
        accountCode: '$accountDetails.code',
        accountName: '$accountDetails.name',
        accountType: '$accountDetails.type',
        normalBalance: '$accountDetails.normalBalance',
        balance: 1,
        debitTotal: 1,
        creditTotal: 1,
        lastUpdated: 1,
      },
    });

    // Sort by account code
    pipeline.push({ $sort: { accountCode: 1 } });

    const balances = await AccountBalance.aggregate(pipeline);

    return balances;
  }

  /**
   * Get ledger summary (total assets, liabilities, equity, income, expenses)
   */
  async getLedgerSummary() {
    // Try to get from cache first
    const cached = await cacheService.getCachedLedgerSummary();
    if (cached) {
      return cached;
    }

    const balances = await this.getAccountBalances();

    const summary = {
      assets: new Decimal(0),
      liabilities: new Decimal(0),
      equity: new Decimal(0),
      income: new Decimal(0),
      expenses: new Decimal(0),
    };

    balances.forEach((balance) => {
      const amount = new Decimal(balance.balance);
      const type = balance.accountType.toLowerCase();

      switch (type) {
        case 'asset':
          summary.assets = summary.assets.plus(amount);
          break;
        case 'liability':
          summary.liabilities = summary.liabilities.plus(amount);
          break;
        case 'equity':
          summary.equity = summary.equity.plus(amount);
          break;
        case 'income':
          summary.income = summary.income.plus(amount);
          break;
        case 'expense':
          summary.expenses = summary.expenses.plus(amount);
          break;
      }
    });

    // Calculate net income
    const netIncome = summary.income.minus(summary.expenses);

    // Accounting equation check: Assets = Liabilities + Equity + Net Income
    const leftSide = summary.assets;
    const rightSide = summary.liabilities.plus(summary.equity).plus(netIncome);
    const isBalanced = leftSide.equals(rightSide);

    const result = {
      assets: summary.assets.toString(),
      liabilities: summary.liabilities.toString(),
      equity: summary.equity.toString(),
      income: summary.income.toString(),
      expenses: summary.expenses.toString(),
      netIncome: netIncome.toString(),
      isBalanced,
      balanceDifference: leftSide.minus(rightSide).toString(),
    };

    // Cache the result
    await cacheService.cacheLedgerSummary(result);
    
    return result;
  }

  /**
   * Void a journal entry (mark as voided in chain)
   */
  async voidJournalEntry(entryId, userId, reason) {
    return await withTransaction(async (session) => {
      const entry = await JournalEntry.findById(entryId).session(session);

      if (!entry) {
        throw new Error('Entry not found');
      }

      if (VOIDED_STATUSES.includes(entry.status)) {
        throw new Error('Entry is already voided');
      }

      if (!POSTED_STATUSES.includes(entry.status)) {
        throw new Error('Only posted entries can be voided');
      }

      const beforeState = this.buildAuditSnapshot(entry);

      // Create void audit trail but keep chain intact
      entry.status = JOURNAL_STATUS.VOIDED;
      entry.voidedBy = userId;
      entry.voidReason = reason;

      const afterState = {
        ...this.buildAuditSnapshot(entry),
        voidReason: reason,
        originalHash: entry.hash || entry.immutable_hash,
      };

      const auditRecord = this.buildAuditTraceEntry({
        action: 'VOIDED',
        entry,
        beforeState,
        afterState,
        userId,
      });

      entry.auditTrace = auditRecord;
      if (!entry.auditTrail) entry.auditTrail = [];
      entry.auditTrail.push(auditRecord);

      await entry.save({ session });

      // Create reversing entry
      const reversingLines = entry.lines.map((line) => ({
        account: line.account,
        debit: line.credit, // Swap debit and credit
        credit: line.debit,
        description: `VOID: ${line.description || ''}`,
      }));

      const reversingEntry = new JournalEntry({
        date: new Date(),
        description: `VOID: ${entry.description} (Reason: ${reason})`,
        lines: reversingLines,
        reference: `VOID-${entry.entryNumber}`,
        reference_entry_id: entry._id,
        status: JOURNAL_STATUS.VALIDATED,
        source: 'SYSTEM',
        trace_id: entry.trace_id,
        postedBy: userId,
        postedAt: new Date(),
        gstDetails: Array.isArray(entry.gstDetails) && entry.gstDetails.length
          ? entry.gstDetails
          : undefined,
        prev_hash: await this.getPreviousHash(),
        immutable_hash: '', // Will be calculated in pre-save hook
      });

      const reversalAudit = this.buildAuditTraceEntry({
        action: 'REVERSAL_CREATED',
        entry: reversingEntry,
        beforeState: null,
        afterState: this.buildAuditSnapshot(reversingEntry),
        userId,
      });

      reversingEntry.auditTrace = reversalAudit;
      reversingEntry.auditTrail = [reversalAudit];

      await reversingEntry.save({ session });

      const ledgerLines = await this.writeLedgerEntries(reversingEntry, session);

      reversingEntry.status = JOURNAL_STATUS.POSTED;
      await reversingEntry.save({ session });

      // Update account balances with reversing entry
      await this.updateAccountBalances(reversingLines, session);

      logger.info(`Journal entry voided: ${entry.entryNumber}`, {
        reason,
        hash: entry.hash,
        reversingLedgerLines: ledgerLines.length,
        voidedBy: userId,
        transactionMode: session ? 'with-transaction' : 'without-transaction',
      });

      return { voidedEntry: entry, reversingEntry };
    });
  }

  /**
   * Reverse account balances (for voiding)
   */
  async reverseAccountBalances(entry) {
    return await withTransaction(async (session) => {
      const reversingLines = entry.lines.map(line => ({
        account: line.account,
        debit: line.credit,
        credit: line.debit,
      }));

      await this.updateAccountBalances(reversingLines, session);
    });
  }

  /**
   * Get entry chain segment (for audit)
   */
  async getChainSegment(startPosition, endPosition) {
    try {
      const size = Math.max(endPosition - startPosition + 1, 0);
      const entries = await LedgerEntry.find({})
        .sort({ timestamp: 1, _id: 1 })
        .skip(startPosition)
        .limit(size)
        .select('journal_id account_id type amount hash prev_hash timestamp')
        .exec();

      return entries;
    } catch (error) {
      logger.error('Get chain segment error:', error);
      throw error;
    }
  }
}

export default new LedgerService();