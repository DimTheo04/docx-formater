# Free Deployment Guide (Exact Steps)

This app can be deployed for free on Render using the Web Service free tier.

## 1) Prepare GitHub repository

1. Commit your latest changes.
2. Push the docx-formater project to GitHub.
3. Confirm these files exist:
   - server.js
   - package.json
   - routes/format.js
   - public/index.html

## 2) Create a free Render service

1. Open Render dashboard.
2. Click New -> Web Service.
3. Connect your GitHub account and select this repository.
4. Set configuration:
   - Name: docx-formater
   - Root Directory: docx-formater
   - Environment: Node
   - Build Command: npm ci
   - Start Command: npm start
   - Instance Type: Free

## 3) Set production environment variables

Add these env vars in Render:

- NODE_ENV=production
- CORS_ORIGINS=https://your-render-domain.onrender.com,https://your-custom-domain.com
- MAX_UPLOAD_MB=10
- RATE_LIMIT_WINDOW_MINUTES=15
- RATE_LIMIT_MAX_REQUESTS=60
- DEFAULT_FONT=Calibri

Notes:
- CORS_ORIGINS is a comma-separated allowlist. No wildcard is needed.
- For same-domain frontend+API on Render, include your Render domain.

## 4) Deploy and verify

1. Click Deploy latest commit.
2. Open:
   - https://your-service.onrender.com/health
3. Expected response:
   - ok=true
   - service=docx-formater
4. Open the app root URL and upload a DOCX to confirm formatting works.

## 5) Enable logs and 5xx spike alerts

This app already emits structured logs for 5xx responses from server.js.

Render setup:
1. Open service -> Logs and verify entries stream correctly.
2. Open service -> Alerts (or Notifications settings).
3. Create alert rule:
   - Condition: error/5xx rate above threshold
   - Example threshold: >5 errors in 5 minutes
4. Notify via Email (free) and optionally Discord/Slack webhook.

If your Render plan does not expose advanced alerts:
1. Create free UptimeRobot monitor on /health (1-minute checks).
2. Add email alert for downtime.
3. Optional: Better Stack free tier for log and incident alerting.

## 6) Capacity guidance for current settings

Current defaults are suitable for small-to-medium traffic:

- Upload max size: 10 MB
- Rate limit: 60 requests per 15 minutes per IP

When to change:
- High traffic office network behind one NAT IP: increase RATE_LIMIT_MAX_REQUESTS to 120.
- Large files common: increase MAX_UPLOAD_MB to 15 (watch memory on free tier).

## 7) Free-tier caveats

- Free instances may sleep when idle.
- First request after sleep can be slow (cold start).
- For strict uptime and faster cold starts, move to a paid instance.
