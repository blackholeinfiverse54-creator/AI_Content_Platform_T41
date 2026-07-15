import express from 'express';
import tallyController from '../controllers/tally.controller.js';
import { protect } from '../middleware/auth.js';
import { uploadTally } from '../middleware/upload.js';

const router = express.Router();

router.use(protect);

// JSON body import
router.post('/import/vouchers', tallyController.importVouchers);
router.post('/import/masters', tallyController.importMasters);

// File upload import (XML, CSV, JSON)
router.post('/import/file', uploadTally.single('file'), tallyController.importFile);
router.post('/import/file/preview', uploadTally.single('file'), tallyController.importFilePreview);

// Export
router.post('/export/vouchers', tallyController.exportVouchers);
router.post('/export/masters', tallyController.exportMasters);
router.post('/export/opening-balances', tallyController.exportOpeningBalances);
router.post('/export/gst-data', tallyController.exportGSTData);

// Migration
router.post('/validate-migration', tallyController.validateMigrationReadiness);

export default router;
