# Security & Production Audit - docx-formater

## 🔴 CRITICAL ISSUES

### 1. **XXE (XML External Entity) Vulnerability**
**Location:** `utils/docxProcessor.js` - DOMParser
**Risk:** Malicious DOCX files with external entity declarations could:
- Read local files from the server
- Perform SSRF attacks
- Cause DoS via billion laughs attack

**Fix:**
```javascript
const parser = new DOMParser({
  entityFilter: (name) => false, // Disable entities
  onError: (level, message) => {
    if (level === 'fatalError') {
      throw new Error(`XML fatal error: ${message}`);
    }
  }
});
```

### 2. **No Request Timeout**
**Location:** `server.js` & `routes/format.js`
**Risk:** 
- Slow/malicious clients can hang connections indefinitely
- DOCX parsing with deeply nested elements could take forever
- Memory exhaustion on large transformations

**Fix:**
```javascript
// In server.js
const http = require('http');
const server = http.createServer(app);
server.setTimeout(30000); // 30 second timeout

// In format.js
router.post('/format', (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ 
        success: false, 
        message: 'Request timeout - document too complex to process' 
      });
    }
  }, 25000); // 25 sec timeout before server timeout

  res.on('finish', () => clearTimeout(timeout));
  // ... rest of handler
});
```

### 3. **No Memory/CPU Limits on Processing**
**Location:** `utils/docxProcessor.js`
**Risk:**
- Billion laughs attack: Malicious DOCX with recursive XML entities causes DoS
- Extremely large documents crash the server
- One request can consume all available RAM

**Fix:**
```javascript
async function processDocx(buffer) {
  // Validate buffer size early
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Buffer exceeds max size: ${buffer.length}`);
  }

  try {
    const zip = await JSZip.loadAsync(buffer);
    const docFile = zip.file('word/document.xml');
    
    if (!docFile) {
      throw new Error('Invalid DOCX file: word/document.xml not found.');
    }

    const docXml = await docFile.async('string');
    
    // Validate XML size - if document.xml is huge, it's suspicious
    if (docXml.length > 50 * 1024 * 1024) { // 50MB
      throw new Error('Document XML exceeds safe processing size.');
    }
    
    // ... rest
  } catch (err) {
    if (err.message.includes('Entity')) {
      throw new Error('Invalid DOCX file: contains malformed entities');
    }
    throw err;
  }
}
```

---

## 🟠 HIGH PRIORITY ISSUES

### 4. **Error Messages Expose Internal Details**
**Location:** `routes/format.js` line 122
**Current:**
```javascript
message: 'Failed to format document: ' + errMsg
```
**Risk:** Reveals internal error details to clients, aids attackers

**Fix:**
```javascript
message: 'Failed to format document. Please ensure the file is valid.'
// Log full error server-side for debugging
```

### 5. **No Express JSON Size Limit**
**Location:** `server.js` line 52
**Risk:** DoS via unlimited request body

**Fix:**
```javascript
app.use(express.json({ limit: '1mb' }));
```

### 6. **CORS Allowlist Can Be Empty**
**Location:** `server.js` lines 18-25
**Risk:** Empty allowlist in production blocks all requests, causing 403 errors

**Fix:**
```javascript
const corsAllowlist = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!corsAllowlist.length && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  WARNING: CORS_ORIGINS not set. API will reject all cross-origin requests.');
}
```

### 7. **No Rate Limit on /health Endpoint**
**Location:** `server.js` line 95
**Risk:** Health checks not rate-limited, potential for reconnaissance attacks

**Fix:**
```javascript
app.get('/health', apiLimiter, (req, res) => { // Add rate limiter
  // ... existing code
});
```

---

## 🟡 MEDIUM PRIORITY ISSUES

### 8. **No Security Headers (Missing Helmet)**
**Risk:** Missing HSTS, X-Frame-Options, X-Content-Type-Options, etc.

**Fix:**
```javascript
const helmet = require('helmet');
app.use(helmet());
```

### 9. **Processing Large Documents Creates Memory Bloat**
**Location:** `utils/docxProcessor.js` - Full DOM parsing
**Risk:** Large DOCX files with thousands of paragraphs consume massive memory

**Mitigation:**
```javascript
// Add memory check before processing
const os = require('os');

async function processDocx(buffer) {
  const freeMemory = os.freemem();
  const requiredMemory = buffer.length * 5; // DOM + temp buffers
  
  if (requiredMemory > freeMemory * 0.8) {
    throw new Error('Server memory insufficient for document processing');
  }
  
  // ... rest
}
```

### 10. **No Graceful Shutdown**
**Location:** `server.js`
**Risk:** In-flight requests get killed abruptly on Render redeploy

**Fix:**
```javascript
const server = app.listen(PORT, () => {
  console.log(`DOCX Formatter running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

### 11. **Filename Not Re-Sanitized in Response**
**Location:** `routes/format.js` line 95
**Risk:** If baseName somehow bypasses sanitization, could cause issues

**Current:**
```javascript
const outputName = `formatted_${baseName}.docx`;
```

**Better:**
```javascript
// Add second sanitization
const outputName = `formatted_${baseName}`.replace(/[^a-zA-Z0-9_-]/g, '_') + '.docx';
```

---

## 🔵 LOW PRIORITY (Best Practices)

### 12. **No Request Logging/Monitoring**
- Add structured logging for all requests (especially errors)
- Monitor response times to detect performance regressions

### 13. **Health Endpoint Doesn't Validate Processing**
```javascript
// Current just returns uptime, doesn't test actual functionality
// Should include: Can read files? Can process XML? Memory OK?
```

### 14. **No User Input Validation on ENV Variables**
```javascript
// Validate after reading from env
if (isNaN(RATE_LIMIT_MAX_REQUESTS) || RATE_LIMIT_MAX_REQUESTS < 1) {
  throw new Error('Invalid RATE_LIMIT_MAX_REQUESTS');
}
```

---

## ✅ WHAT'S DONE WELL

- ✓ In-memory storage (no temp file cleanup issues)
- ✓ Rate limiting enabled
- ✓ CORS allowlist approach (better than wildcard)
- ✓ Input file type validation
- ✓ File size limits
- ✓ Good error handling structure
- ✓ Filename sanitization

---

## 🚀 QUICK FIXES (Priority Order)

1. **Add XXE protection to DOMParser** ⚠️ CRITICAL
2. **Add request timeout (30s)** ⚠️ CRITICAL
3. **Validate XML size limits** ⚠️ CRITICAL
4. **Add helmet for security headers** - 2 min fix
5. **Remove error details from responses** - 2 min fix
6. **Add JSON body size limit** - 1 min fix
7. **Add graceful shutdown** - 5 min fix
8. **Add memory check before processing** - 5 min fix
