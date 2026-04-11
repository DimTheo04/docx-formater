const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';
const RATE_LIMIT_WINDOW_MINUTES = Math.max(
  Number.parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15', 10) || 15,
  1
);
const RATE_LIMIT_MAX_REQUESTS = Math.max(
  Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10) || 60,
  1
);

const corsAllowlist = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isDev) {
  corsAllowlist.push(
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  );
}

const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser clients and same-origin requests without Origin.
    if (!origin) {
      return callback(null, true);
    }

    if (corsAllowlist.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  optionsSuccessStatus: 204
};

// Required so rate-limit uses real client IP behind Render/Railway/Fly proxies.
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '15mb' })); // Limit matches MAX_UPLOAD_MB (10MB) + ~5MB overhead

// Emit structured logs for 5xx responses so providers can alert on error spikes.
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    if (res.statusCode >= 500) {
      console.error(
        JSON.stringify({
          level: 'error',
          type: 'http_5xx',
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
          ip: req.ip,
          timestamp: new Date().toISOString()
        })
      );
    }
  });

  next();
});

// Rate limit the formatting API.
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.'
  }
});

// Lighter rate limit for health checks (allow more frequent checks)
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 120, // 120 requests per minute is reasonable for health checks
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => false // Don't skip any health checks
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Health endpoint for uptime checks and platform monitoring.
app.get('/health', healthLimiter, (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'docx-formater',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// API routes (rate-limited)
const formatRoute = require('./routes/format');
app.use('/api', apiLimiter, formatRoute);

// Serve index.html for root (catch-all for SPA)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handling middleware
app.use((err, req, res, next) => {
  if (err && err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Request blocked by CORS policy for this origin.'
    });
  }

  // Do not expose internal error details in production
  const errorMsg = isDev ? err.message : 'Internal server error';
  console.error(isDev ? err.stack : err.message);
  
  res.status(500).json({
    success: false,
    message: errorMsg
  });
});

// Create HTTP server with request timeout
const http = require('http');
const server = http.createServer(app);
server.setTimeout(30000); // 30 second timeout for all requests

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM received, initiating graceful shutdown...');
  server.close(() => {
    console.log('Server closed. Goodbye.');
    process.exit(0);
  });
});

server.listen(PORT, () => {
  console.log(`DOCX Formatter running on http://localhost:${PORT}`);
  console.log(
    `Rate limit: ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MINUTES} minutes`
  );
  console.log(
    `CORS allowlist entries: ${corsAllowlist.length > 0 ? corsAllowlist.join(', ') : 'none'}`
  );
  
  if (!corsAllowlist.length && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  WARNING: CORS_ORIGINS not set. API will reject all cross-origin requests.');
  }
});

module.exports = app;
