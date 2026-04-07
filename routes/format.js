const express = require('express');
const multer = require('multer');
const { processDocx } = require('../utils/docxProcessor');

const router = express.Router();

// Configure multer with in-memory storage (stateless – no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
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
  upload.single('document')(req, res, async (multerErr) => {
    // ── Handle multer-level errors ────────────────────────────────────────────
    if (multerErr) {
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File size exceeds the 10 MB limit.'
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
        message: multerErr.message || 'File upload failed.'
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

      const baseName = req.file.originalname.replace(/\.docx$/i, '');
      const outputName = `formatted_${baseName}.docx`;

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
      console.error('Error formatting document:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to format document: ' + (err.message || 'Unknown error')
      });
    }
  });
});

module.exports = router;
