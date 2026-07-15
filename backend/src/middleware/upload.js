import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Ensure upload directory exists
const uploadDir = 'uploads/receipts';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Bank statements upload directory
const statementsDir = 'uploads/statements';
if (!fs.existsSync(statementsDir)) {
  fs.mkdirSync(statementsDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    cb(null, `receipt-${uniqueSuffix}${ext}`);
  },
});

// Storage configuration for bank statements
const statementsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, statementsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    cb(null, `statement-${uniqueSuffix}${ext}`);
  },
});

// File filter for receipts
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/jpg',
    'image/gif',
    'application/pdf',
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.'), false);
  }
};

// File filter for bank statements (CSV, Excel, PDF)
const statementsFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
  ];
  
  // Also check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.csv', '.xls', '.xlsx', '.pdf'];
  
  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only CSV, Excel (XLS/XLSX), and PDF are allowed for bank statements.'), false);
  }
};

// Multer configuration
export const uploadReceipts = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 5, // Max 5 files per request
  },
});

// Multer configuration for bank statements
export const uploadFile = multer({
  storage: statementsStorage,
  fileFilter: statementsFileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size for statements
    files: 1, // Single file per request
  },
});

// Error handling middleware
export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds 10MB limit',
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 5 files allowed',
      });
    }
  }
  
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
  
  next();
};

// Tally file upload directory
const tallyDir = 'uploads/tally';
if (!fs.existsSync(tallyDir)) {
  fs.mkdirSync(tallyDir, { recursive: true });
}

const tallyStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tallyDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    cb(null, `tally-${uniqueSuffix}${ext}`);
  },
});

const tallyFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.xml', '.csv', '.json'];
  const allowedTypes = [
    'text/xml', 'application/xml',
    'text/csv',
    'application/json',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  if (allowedExtensions.includes(ext) || allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only XML, CSV, and JSON files are allowed for Tally import.'), false);
  }
};

export const uploadTally = multer({
  storage: tallyStorage,
  fileFilter: tallyFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
  },
});

// Legacy export for backward compatibility
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

export default upload;