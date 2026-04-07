const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

// Middleware
app.use(cors());
app.use(express.json());

// Rate limit the formatting API: max 20 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// API routes (rate-limited)
const formatRoute = require('./routes/format');
app.use('/api', apiLimiter, formatRoute);

// Serve index.html for root (catch-all for SPA)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handling middleware
app.use((err, req, res, next) => {
  if (isDev) {
    console.error(err.stack);
  } else {
    console.error(err.message);
  }
  res.status(500).json({
    success: false,
    message: isDev ? err.message : 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`DOCX Formatter running on http://localhost:${PORT}`);
});

module.exports = app;
