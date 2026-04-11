const express = require('express');
const multer = require('multer');
const { processDocx } = require('../utils/docxProcessor');

const router = express.Router();
const MAX_UPLOAD_MB = Math.max(
  Number.parseInt(process.env.MAX_UPLOAD_MB || '10', 10) || 10,
  1
);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * Sanitize a filename by removing characters that are unsafe across common
 * operating systems and could be used for path traversal or injection.
 * @param {string} name  Raw filename (without extension)
 * @returns {string}
 */
function sanitizeBaseName(name) {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-') // unsafe FS chars
    .replace(/\.{2,}/g, '.') // collapse double-dots (path traversal)
    .replace(/^\.+|\.+$/g, '') // strip leading/trailing dots
    .trim()
    .slice(0, 200) // cap length
    || 'document'; // fallback if everything was stripped
}

// Configure multer with in-memory storage (stateless – no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  },
  fileFilter: (req, file, cb) => {
    const isDocx =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.originalname.toLowerCase().endsWith('.docx');

    if (isDocx) {
      cb(null, true);
    } else {
      cb(new Error('Only DOCX files are allowed'));
    }
  }
});

/**
 * POST /api/format
 * Accepts a DOCX file upload and returns a formatted DOCX file.
 *
 * The multer middleware is invoked manually so that errors from fileFilter
 * (e.g. wrong file type) and limits (e.g. file too large) are caught here
 * and returned as JSON rather than propagating to the global error handler.
 */
router.post('/format', (req, res) => {
  // Set request timeout for processing
  const processingTimeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: 'Document processing timed out. The document may be too complex or large.'
      });
    }
  }, 25000); // 25 seconds (before server's 30s timeout)

  res.on('finish', () => clearTimeout(processingTimeout));

  upload.single('document')(req, res, async (multerErr) => {
    // ── Handle multer-level errors ────────────────────────────────────────────
    if (multerErr) {
      clearTimeout(processingTimeout);
      
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: `File size exceeds the ${MAX_UPLOAD_MB} MB limit.`
        });
      }
      if (multerErr.message && multerErr.message.includes('Only DOCX files')) {
        return res.status(400).json({
          success: false,
          message: 'Only DOCX files are allowed.'
        });
      }
      console.error('Multer error:', multerErr);
      return res.status(400).json({
        success: false,
        message: 'File upload failed. Please check your file and try again.'
      });
    }

    // ── Route handler ─────────────────────────────────────────────────────────
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided. Please upload a DOCX file.'
        });
      }

      const formattedBuffer = await processDocx(req.file.buffer);

      const baseName = sanitizeBaseName(req.file.originalname.replace(/\.docx$/i, ''));
      // Additional sanitization for output filename
      const sanitizedName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
      const outputName = `formatted_${sanitizedName || 'document'}.docx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${outputName}"`
      );
      res.setHeader('Content-Length', formattedBuffer.length);
      res.send(formattedBuffer);
    } catch (err) {
      clearTimeout(processingTimeout);
      console.error('Error formatting document:', err.message);

      // Determine error type without exposing internal details
      const errMsg = (err && err.message) || 'Unknown error';
      const isInvalidFile = /invalid docx|zip file|entity|invalid|malformed/i.test(errMsg);
      const isMemory = /memory|insufficient/i.test(errMsg);
      const isTimeout = /timeout/i.test(errMsg);

      if (isInvalidFile) {
        return res.status(400).json({
          success: false,
          message: 'Invalid DOCX file. Please ensure the file is a valid Word document.'
        });
      }

      if (isMemory) {
        return res.status(413).json({
          success: false,
          message: 'Document is too large to process. Please try a smaller file.'
        });
      }

      if (isTimeout) {
        return res.status(408).json({
          success: false,
          message: 'Document processing timed out. Please try a simpler document.'
        });
      }

      // Generic error - don't expose details
      res.status(500).json({
        success: false,
        message: 'Failed to format document. Please try again.'
      });
    }
  });
});

module.exports = router;
