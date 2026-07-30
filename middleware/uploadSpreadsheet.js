import multer from 'multer';
import path from 'path';

// Bulk-import spreadsheets are parsed in memory (ExcelJS reads the buffer) and
// never persisted to disk — so use memoryStorage instead of the disk storage
// used for profile/document uploads. The buffer is treated as untrusted input:
// extension + MIME here are only a first filter; the controller additionally
// verifies the file signature (magic bytes) and bounds parsing before use.
const storage = multer.memoryStorage();

// Official OOXML spreadsheet MIME. `application/octet-stream` is a common
// browser fallback for .xlsx, so it is tolerated here but still has to pass the
// magic-byte check in the controller before it is parsed.
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

// ExcelJS reads the OOXML .xlsx format (a ZIP archive), not the legacy binary
// .xls (BIFF) format — so only accept .xlsx.
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.xlsx' && ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
  cb(new Error('Only Excel .xlsx files are allowed'));
};

const uploadSpreadsheet = multer({
  storage,
  fileFilter,
  // 10 MB upload ceiling. The compressed payload is further bounded after
  // parsing by the worksheet/row caps in the controller, so a small but
  // deeply-inflating (zip-bomb) file is still rejected before it is iterated.
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// Wrap multer so filter/size errors surface as a clean 400 through the shared
// error handler rather than an unhandled 500.
export const importUpload = (req, res, next) => {
  uploadSpreadsheet.single('file')(req, res, (err) => {
    if (!err) return next();
    res.status(400);
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new Error('The file is too large. Please keep it under 10 MB.'));
    }
    next(new Error(err.message || 'Could not read the uploaded file'));
  });
};

export default uploadSpreadsheet;
