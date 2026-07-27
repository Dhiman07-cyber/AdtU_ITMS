# Environment Variables Reference — ITMS Production

Complete reference for all environment variables required to run the ITMS platform.

Variables marked `REQUIRED` will cause startup failure or security degradation if absent.
Variables marked `OPTIONAL` have safe defaults but should be configured in production.

---

## Firebase — Client SDK (Public)

These are safe to expose to browsers. They are embedded in the Next.js bundle.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | REQUIRED | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | REQUIRED | `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | REQUIRED | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | REQUIRED | Firebase Storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | REQUIRED | FCM sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | REQUIRED | Firebase App ID |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | OPTIONAL | GA4 Measurement ID |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | OPTIONAL | FCM VAPID key for push notifications |

---

## Firebase — Admin SDK (Server-side only — NEVER expose to client)

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_CLIENT_EMAIL` | REQUIRED | Service account email |
| `FIREBASE_PRIVATE_KEY` | REQUIRED | Service account private key (PEM with `\n` newlines) |

---

## Supabase

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | REQUIRED | `https://your-project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | REQUIRED | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | REQUIRED | Service role key (server-only, never expose) |
| `SUPABASE_DB_URL` | OPTIONAL | Direct PostgreSQL connection URL (for migrations) |

---

## Cryptographic Secrets — Server-only

**Generate with:** `openssl rand -hex 32` (produces 64-char hex string)

| Variable | Required | Description |
|----------|----------|-------------|
| `SIGNING_SECRET_KEY` | REQUIRED | General-purpose HMAC signing key |
| `ENCRYPTION_SECRET_KEY` | REQUIRED | AES encryption key for sensitive data |
| `RECEIPT_SIGNING_SECRET` | REQUIRED | HMAC key for payment receipt signing |
| `DOCUMENT_PRIVATE_KEY` | REQUIRED | RSA private key (PEM) for document signing |
| `DOCUMENT_PUBLIC_KEY` | REQUIRED | RSA public key (PEM) for document verification |
| `CRON_SECRET` | REQUIRED | Bearer token for cron job endpoint authorization |
| `WS_PRIVILEGED_TOKEN` | REQUIRED | Internal token for server→WS server trusted calls |

---

## Payments — Razorpay

| Variable | Required | Description |
|----------|----------|-------------|
| `RAZORPAY_KEY_ID` | REQUIRED | Razorpay Key ID |
| `RAZORPAY_KEY_SECRET` | REQUIRED | Razorpay Key Secret (server-only) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | REQUIRED | Key ID for client SDK initialization |
| `RAZORPAY_WEBHOOK_SECRET` | REQUIRED | Webhook signature secret |

---

## Storage — Cloudinary

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | REQUIRED | Cloudinary cloud name |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | REQUIRED | Upload preset for unsigned uploads |
| `CLOUDINARY_API_KEY` | REQUIRED | API key (server-only) |
| `CLOUDINARY_API_SECRET` | REQUIRED | API secret (server-only) |

---

## Email — Resend

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | REQUIRED | Resend API key |
| `ADMIN_EMAIL` | REQUIRED | Primary admin notification address |
| `EMAIL_FROM` | REQUIRED | Sender display name and address |
| `EMAIL_REPLY_TO` | OPTIONAL | Reply-to address |

---

## Maps — PMTiles

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_GUWAHATI_PMTILES_URL` | OPTIONAL | URL of Guwahati PMTiles vector tileset (MapLibre) |

---

## Analytics — Google Analytics

| Variable | Required | Description |
|----------|----------|-------------|
| `GA4_PROPERTY_ID` | OPTIONAL | GA4 property ID for analytics API |
| `GA_PROJECT_ID` | OPTIONAL | Google Cloud project ID for GA4 service account |
| `GA_CLIENT_EMAIL` | OPTIONAL | GA4 service account email |
| `GA_PRIVATE_KEY` | OPTIONAL | GA4 service account private key (PEM) |

---

## WebSocket Runtime

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WS_PORT` | REQUIRED | `3001` | WebSocket server port |
| `NEXT_PUBLIC_WS_URL` | REQUIRED | — | Public WS URL (e.g. `wss://itms.example.com/ws`) |
| `HEALTH_PORT` | OPTIONAL | `9090` | Health/metrics HTTP server port |
| `WS_HOST` | OPTIONAL | `0.0.0.0` | Bind address |
| `REDIS_URL` | OPTIONAL | — | Redis URL for horizontal WS scaling (`redis://host:6379`) |

---

## Performance & Limits

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_PER_IP` | OPTIONAL | `100` | Max messages per IP per window |
| `RATE_LIMIT_PER_USER` | OPTIONAL | `200` | Max messages per user per window |
| `RATE_LIMIT_PER_SOCKET` | OPTIONAL | `60` | Max messages per socket per window |
| `RATE_LIMIT_WINDOW_MS` | OPTIONAL | `10000` | Rate limit window in ms |
| `MAX_PAYLOAD_SIZE` | OPTIONAL | `65536` | Max WS message size in bytes (64KB) |
| `HEARTBEAT_INTERVAL_MS` | OPTIONAL | `30000` | WS heartbeat ping interval (ms) |
| `HEARTBEAT_TIMEOUT_GRACE_MS` | OPTIONAL | `5000` | Grace period after heartbeat before eviction (ms) |
| `BROADCAST_BATCH_SIZE` | OPTIONAL | `100` | Max subscribers per broadcast batch |
| `OFFLINE_QUEUE_MAX` | OPTIONAL | `500` | Max offline queue depth per socket |
| `SLOW_HANDLER_MS` | OPTIONAL | `100` | Threshold for slow handler warning log (ms) |

---

## Logging & Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | REQUIRED | `development` | `production` \| `development` \| `test` |
| `LOG_LEVEL` | OPTIONAL | `info` | `debug` \| `info` \| `warn` \| `error` |

---

## Feature Flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SEAT_RELEASE_AT_SOFT_BLOCK` | OPTIONAL | `false` | Release seat when student account is soft-blocked |

---

## Application URLs

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | REQUIRED | Canonical public URL for CORS and redirects |

---

## Fail-Fast Environment Validation

As of PROGRAM-005 Phase-01, both the Next.js App (`src/instrumentation.ts`) and WebSocket Server (`server/index.ts`) enforce deterministic fail-fast environment checks using `src/lib/env-validator.ts`:

- **Classification:** Every variable is classified as `public`, `private`, or `secret`, with defined lifecycle (`build-time`, `runtime`, `both`).
- **Fail-Fast Boot:** In `NODE_ENV=production`, if any required secret or public configuration variable is missing, the boot sequence halts immediately with exit code `1` and outputs structured error logs.
- **Development Warning:** In `NODE_ENV=development`, missing variables trigger explicit console warnings without halting boot.

---

*Version: PROGRAM-005-PHASE-01 | Last updated: 2026-07-27*
