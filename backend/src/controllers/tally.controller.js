import tallyCompatibilityService from '../services/tallyCompatibility.service.js';
import logger from '../config/logger.js';
import fs from 'fs/promises';

class TallyController {
  async exportVouchers(req, res) {
    try {
      const result = await tallyCompatibilityService.exportVouchers({
        ...req.body,
        userId: req.user._id,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async exportMasters(req, res) {
    try {
      const result = await tallyCompatibilityService.exportMasters(req.body.companyId, req.user._id);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async exportOpeningBalances(req, res) {
    try {
      const result = await tallyCompatibilityService.exportOpeningBalances(
        req.body.companyId, req.body.financialYear, req.user._id
      );
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async exportGSTData(req, res) {
    try {
      const result = await tallyCompatibilityService.exportGSTData(
        req.body.period, req.body.financialYear, req.user._id
      );
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async importVouchers(req, res) {
    try {
      const result = await tallyCompatibilityService.importVouchers({
        ...req.body,
        userId: req.user._id,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async importMasters(req, res) {
    try {
      const result = await tallyCompatibilityService.importMasters({
        ...req.body,
        userId: req.user._id,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async importFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const ext = req.file.originalname.split('.').pop().toLowerCase();
      const result = await tallyCompatibilityService.ingestFile(req.file.path, ext, {
        userId: req.user._id,
        companyId: req.body.companyId,
        source: 'tally-file-upload',
        createJournals: req.body.createJournals !== 'false',
        importType: req.body.importType || 'vouchers',
      });

      await fs.unlink(req.file.path).catch(() => {});

      res.json({ success: true, data: result });
    } catch (err) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      logger.error('Tally file import error:', err);
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async importFilePreview(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const ext = req.file.originalname.split('.').pop().toLowerCase();
      let vouchers = [];

      if (ext === 'xml') {
        vouchers = await tallyCompatibilityService.parseTallyXMLFile(req.file.path);
      } else if (ext === 'csv') {
        vouchers = await tallyCompatibilityService.parseTallyCSVFile(req.file.path);
      } else if (ext === 'json') {
        const content = await fs.readFile(req.file.path, 'utf-8');
        const parsed = JSON.parse(content);
        vouchers = Array.isArray(parsed) ? parsed : parsed.vouchers || parsed.data || [];
      }

      await fs.unlink(req.file.path).catch(() => {});

      res.json({
        success: true,
        data: {
          fileName: req.file.originalname,
          format: ext,
          totalRecords: vouchers.length,
          preview: vouchers.slice(0, 10),
          vouchers,
        },
      });
    } catch (err) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      logger.error('Tally file preview error:', err);
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async validateMigrationReadiness(req, res) {
    try {
      const result = await tallyCompatibilityService.validateMigrationReadiness(req.body.companyId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
}

export default new TallyController();
