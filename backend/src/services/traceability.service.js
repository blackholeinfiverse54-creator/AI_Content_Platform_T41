import UnifiedTrace from '../models/UnifiedTrace.js';
import RuntimeProof from '../models/RuntimeProof.js';
import JournalEntry from '../models/JournalEntry.js';
import ComplianceSignal from '../models/ComplianceSignal.js';
import ComplianceFiling from '../models/ComplianceFiling.js';
import ComplianceValidationLog from '../models/ComplianceValidationLog.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import TDSEntry from '../models/TDSEntry.js';
import logger from '../config/logger.js';

/**
 * TraceabilityService - Unified trace continuity across ARTHA ecosystem
 * 
 * Solves: "Trace continuity is not actually continuous"
 * - Single trace_id format (TRC-YYYYMMDD-UUID)
 * - End-to-end lineage from transaction → signal → SETU
 * - Causality tracking (parent/child traces)
 * - Replay capability with full state reconstruction
 */
class TraceabilityService {
  /**
   * Initialize a new unified trace
   */
  async initializeTrace({ source, source_id, user_id, metadata = {} }) {
    try {
      const trace_id = UnifiedTrace.generateTraceId();
      
      const trace = await UnifiedTrace.create({
        trace_id,
        source,
        source_id: String(source_id),
        initiated_by: user_id,
        initiated_at: new Date(),
        status: 'IN_PROGRESS',
        current_stage: 'TRANSACTION_CREATED',
        stages: [{
          stage: 'TRANSACTION_CREATED',
          entity_type: source === 'INVOICE' ? 'Invoice' : source === 'EXPENSE' ? 'Expense' : 
                       source === 'TDS' ? 'TDSEntry' : 'JournalEntry',
          entity_id: String(source_id),
          status: 'SUCCESS',
          timestamp: new Date(),
          metadata,
        }],
        linked_entities: {
          journal_entries: [],
          signals: [],
          filings: [],
          validation_logs: [],
          setu_dispatches: [],
        },
      });
      
      logger.info(`UnifiedTrace initialized: ${trace_id} for ${source}:${source_id}`);
      return trace;
    } catch (error) {
      logger.error('Initialize trace error:', error);
      throw error;
    }
  }
  
  /**
   * Add stage to existing trace
   */
  async addStage(trace_id, stageData) {
    try {
      const trace = await UnifiedTrace.findOne({ trace_id });
      if (!trace) {
        logger.warn(`Trace not found: ${trace_id}, creating orphan stage record`);
        // Don't throw - allow graceful degradation
        return null;
      }
      
      await trace.addStage(stageData);
      logger.info(`Stage added to trace ${trace_id}: ${stageData.stage} [${stageData.status}]`);
      return trace;
    } catch (error) {
      logger.error('Add stage error:', error);
      throw error;
    }
  }
  
  /**
   * Mark trace as completed
   */
  async completeTrace(trace_id) {
    try {
      const trace = await UnifiedTrace.findOne({ trace_id });
      if (!trace) return null;
      
      trace.status = 'COMPLETED';
      await trace.save();
      
      logger.info(`Trace completed: ${trace_id}`);
      return trace;
    } catch (error) {
      logger.error('Complete trace error:', error);
      throw error;
    }
  }
  
  /**
   * Mark trace as failed
   */
  async failTrace(trace_id, error_message) {
    try {
      const trace = await UnifiedTrace.findOne({ trace_id });
      if (!trace) return null;
      
      trace.status = 'FAILED';
      trace.current_stage = 'FAILED';
      await trace.save();
      
      logger.warn(`Trace failed: ${trace_id} - ${error_message}`);
      return trace;
    } catch (error) {
      logger.error('Fail trace error:', error);
      throw error;
    }
  }
  
  /**
   * Get full trace chain with all linked entities
   */
  async getFullChain(trace_id) {
    try {
      const trace = await UnifiedTrace.findOne({ trace_id });
      if (!trace) {
        // Graceful degradation: return partial info instead of throwing
        logger.warn(`Trace not found: ${trace_id}, returning partial response`);
        return {
          trace: null,
          source_entity: null,
          runtime_proofs: [],
          continuity_verified: {
            is_continuous: false,
            missing_stages: [],
            total_stages: 0,
            current_stage: 'UNKNOWN',
            status: 'NOT_FOUND',
          },
          error: `Trace not found: ${trace_id}`,
        };
      }
      
      // Populate all linked entities
      await trace.getFullChain();
      
      // Get source entity
      let sourceEntity = null;
      switch (trace.source) {
        case 'INVOICE':
          sourceEntity = await Invoice.findById(trace.source_id)
            .select('invoiceNumber customerName totalAmount status invoiceDate')
            .lean();
          break;
        case 'EXPENSE':
          sourceEntity = await Expense.findById(trace.source_id)
            .select('expenseNumber vendor totalAmount status date')
            .lean();
          break;
        case 'TDS':
          sourceEntity = await TDSEntry.findById(trace.source_id)
            .select('entryNumber deductee.name tdsAmount status transactionDate')
            .lean();
          break;
        case 'MANUAL_JOURNAL':
          sourceEntity = await JournalEntry.findById(trace.source_id)
            .select('entryNumber description status date')
            .lean();
          break;
      }
      
      // Get runtime proofs
      const proofs = await RuntimeProof.find({ trace_id })
        .select('proof_id proof_type endpoint verified created_at')
        .lean();
      
      return {
        trace,
        source_entity: sourceEntity,
        runtime_proofs: proofs,
        continuity_verified: this.verifyContinuity(trace),
      };
    } catch (error) {
      logger.error('Get full chain error:', error);
      throw error;
    }
  }
  
  /**
   * Verify trace continuity
   */
  verifyContinuity(trace) {
    // Full expected lifecycle: Transaction → Journal → Signal → Filing → Validation → SETU
    const expectedStages = [
      'TRANSACTION_CREATED',
      'JOURNAL_CREATED',
      'JOURNAL_VALIDATED',
      'JOURNAL_POSTED',
      'SIGNAL_GENERATED',
      'FILING_CREATED',
      'FILING_VALIDATED',
      'SETU_DISPATCHED',
    ];
    const actualStages = trace.stages.map(s => s.stage);

    let continuityBroken = false;
    let missingStages = [];

    for (const expectedStage of expectedStages) {
      if (!actualStages.includes(expectedStage)) {
        missingStages.push(expectedStage);
        continuityBroken = true;
      }
    }

    return {
      is_continuous: !continuityBroken,
      missing_stages: missingStages,
      total_stages: trace.stages.length,
      current_stage: trace.current_stage,
      status: trace.status,
    };
  }
  
  /**
   * Reconstruct trace chain (full lineage with causality)
   */
  async reconstructLineage(trace_id) {
    try {
      const trace = await UnifiedTrace.findOne({ trace_id });
      if (!trace) {
        // Graceful degradation: return empty lineage instead of throwing
        logger.warn(`Trace not found for lineage: ${trace_id}, returning empty lineage`);
        return {
          root: null,
          lineage: { parents: [], children: [], depth: 0 },
          execution_flow: [],
          error: `Trace not found: ${trace_id}`,
        };
      }
      
      // Get parent traces
      const parents = [];
      if (trace.caused_by) {
        const parentTrace = await UnifiedTrace.findOne({ trace_id: trace.caused_by })
          .select('trace_id source current_stage status initiated_at')
          .lean();
        if (parentTrace) parents.push(parentTrace);
      }
      
      // Get child traces
      const children = [];
      if (trace.triggers && trace.triggers.length > 0) {
        const childTraces = await UnifiedTrace.find({ trace_id: { $in: trace.triggers } })
          .select('trace_id source current_stage status initiated_at')
          .lean();
        children.push(...childTraces);
      }
      
      // Build full lineage graph
      return {
        root: {
          trace_id: trace.trace_id,
          source: trace.source,
          current_stage: trace.current_stage,
          status: trace.status,
          initiated_at: trace.initiated_at,
          stages: trace.stages,
        },
        lineage: {
          parents,
          children,
          depth: this.calculateDepth(trace),
        },
        execution_flow: this.buildExecutionFlow(trace),
      };
    } catch (error) {
      logger.error('Reconstruct lineage error:', error);
      throw error;
    }
  }
  
  /**
   * Calculate trace depth in causality chain
   */
  calculateDepth(trace) {
    // Simple depth: count parent levels
    return trace.caused_by ? 1 : 0; // Can be extended for multi-level
  }
  
  /**
   * Build execution flow diagram
   */
  buildExecutionFlow(trace) {
    return trace.stages.map((stage, index) => ({
      step: index + 1,
      stage: stage.stage,
      entity_type: stage.entity_type,
      entity_id: stage.entity_id,
      status: stage.status,
      timestamp: stage.timestamp,
      duration_from_start: stage.timestamp ? 
        (new Date(stage.timestamp) - new Date(trace.initiated_at)) : null,
    }));
  }
  
  /**
   * Replay trace (reconstruct and re-execute if possible)
   */
  async replayTrace(trace_id, user_id) {
    try {
      const trace = await UnifiedTrace.findOne({ trace_id });
      if (!trace) {
        throw new Error(`Trace not found: ${trace_id}`);
      }
      
      if (!trace.replay_available) {
        throw new Error(`Trace ${trace_id} is not replayable`);
      }
      
      // Mark replay attempt
      trace.replay_count += 1;
      trace.last_replayed_at = new Date();
      await trace.save();
      
      // Get full chain for replay context (now handles missing traces gracefully)
      const chain = await this.getFullChain(trace_id);
      
      logger.info(`Trace replayed: ${trace_id} (attempt ${trace.replay_count})`);
      
      return {
        trace_id,
        replay_count: trace.replay_count,
        replayed_at: trace.last_replayed_at,
        chain,
        replay_status: 'SUCCESS',
      };
    } catch (error) {
      logger.error('Replay trace error:', error);
      throw error;
    }
  }
  
  /**
   * Search traces
   */
  async searchTraces(filters = {}) {
    try {
      const {
        source,
        status,
        current_stage,
        initiated_by,
        date_from,
        date_to,
        limit = 50,
        page = 1,
      } = filters;
      
      const query = {};
      if (source) query.source = source;
      if (status) query.status = status;
      if (current_stage) query.current_stage = current_stage;
      if (initiated_by) query.initiated_by = initiated_by;
      
      if (date_from || date_to) {
        query.initiated_at = {};
        if (date_from) query.initiated_at.$gte = new Date(date_from);
        if (date_to) query.initiated_at.$lte = new Date(date_to);
      }
      
      const skip = (page - 1) * limit;
      const [traces, total] = await Promise.all([
        UnifiedTrace.find(query)
          .select('trace_id source current_stage status initiated_at stages')
          .populate('initiated_by', 'name email')
          .sort({ initiated_at: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        UnifiedTrace.countDocuments(query),
      ]);
      
      return {
        traces,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Search traces error:', error);
      throw error;
    }
  }
  
  /**
   * Get trace statistics
   */
  async getStatistics() {
    try {
      const [
        totalTraces,
        inProgress,
        completed,
        failed,
        bySource,
        byStage,
      ] = await Promise.all([
        UnifiedTrace.countDocuments(),
        UnifiedTrace.countDocuments({ status: 'IN_PROGRESS' }),
        UnifiedTrace.countDocuments({ status: 'COMPLETED' }),
        UnifiedTrace.countDocuments({ status: 'FAILED' }),
        UnifiedTrace.aggregate([
          { $group: { _id: '$source', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        UnifiedTrace.aggregate([
          { $group: { _id: '$current_stage', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
      ]);
      
      return {
        total: totalTraces,
        by_status: {
          in_progress: inProgress,
          completed,
          failed,
        },
        by_source: bySource.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        by_stage: byStage.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
      };
    } catch (error) {
      logger.error('Get trace statistics error:', error);
      throw error;
    }
  }
}

export default new TraceabilityService();
