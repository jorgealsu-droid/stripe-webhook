# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

---

## ⚠️ Operating Rules (READ FIRST, ALWAYS)

These rules override any default Claude Code behavior. Ignore them and you break trust.

1. **User profile:** Jorge has basic programming knowledge. When proposing changes, explain technical concepts in plain language. Use step-by-step instructions and specify exact tools and locations ("open VS Code, switch to branch X, paste this in the terminal").
2. **Branching discipline:** Always work on branch `laboratorio` first. NEVER touch `main` without explicit user confirmation.
3. **Confirmation gates:** Before any irreversible change (commit, push, deploy, file deletion, dependency install, schema migration), ask for explicit user confirmation. Show what will change and why.
4. **Test environment first:** Changes must be validated in the test environment (test Telegram channels, Firebase project, `laboratorio` branch) before applying to production.
5. **Secret hygiene:** Never read, copy, or echo the contents of `.env`, `llave-firebase.json`, or `service-account-testing.json`. Never include real credentials in code suggestions or logs.
6. **No silent deletions:** If a refactor would delete or rename a file, list every file affected and ask for confirmation per file.

---

## Project Overview

Serverless backend for a Catholic liturgical content subscription service. Users pay via Stripe to join a premium Telegram channel; daily content is published via Vercel cron jobs. The stack is Node.js (ESM) deployed to Vercel.

**Status: PIVOTING.** Project is transitioning from a Telegram-only model to a dual-channel SaaS:
- **Telegram (free, permanent):** existing channel, used as acquisition funnel.
- **WhatsApp (paid, $49 MXN/month):** new channel via Meta Cloud API, with 7-day trial (no card), personalized delivery times, and on-demand content via keywords.

Migration is in progress. Legacy Telegram code coexists with new WhatsApp infrastructure during the transition.

---

## Stack

- **Runtime:** Node.js 24, ES Modules.
- **Hosting:** Vercel (serverless functions + cron jobs).
- **Database:** Firebase Firestore (Admin SDK).
- **File Storage:** Firebase Storage (audio MP3s).
- **Payments:** Stripe (subscriptions, checkout, webhooks).
- **Messaging (current):** Telegram Bot API.
- **Messaging (incoming):** WhatsApp Cloud API (Meta direct, no BSP).
- **Source control:** GitHub. Active branches: `main` (production), `laboratorio` (development).

---

## Commands

```bash
# Install dependencies
npm install

# Local dev server (Vercel functions)
vercel dev

# Deploy to production (REQUIRES USER CONFIRMATION)
vercel --prod

# Run local data ingestion scripts (manual, not deployed)
node subir-datos.js
node upload-audios.js
node make-public.js
```

There is no build step, test suite, or linter configured. **Adding tests is on the roadmap.**

---

## Architecture

### A. API and Webhook layer (`/api/`, deployed to Vercel)

| File | Route | Purpose |
|------|-------|---------|
| `api/telegram-webhook.js` | `POST /api/telegram-webhook` | Bot logic: `/start`, coupon redemption, callback queries. **Will become obsolete after WhatsApp launch but stays for free channel.** |
| `api/create-checkout.js` | `GET /api/create-checkout?telegram_id=` | Stripe customer + checkout session. Will be reused by the WhatsApp landing page. |
| `api/stripe-webhook.js` | `POST /api/stripe-webhook` | Signature-verified Stripe event handler. Currently only handles `customer.subscription.deleted`. **Will be extended for trial, payment failure, renewal events.** |
| `api/cron-cupones.js` | `GET /api/cron-cupones` | Daily cron — expires coupons past `expiresAt`. |
| `api/publicar-contenido.js` | `GET /api/publicar-contenido` | Daily cron — reads `liturgical_content/{YYYY-MM-DD}` and pushes to Telegram premium (audio) + free (text). |
| `api/firebase.js` | (shared module) | Firebase Admin singleton, `db` export, `sendLog()` for Telegram alert channel. |

Cron jobs are defined in `vercel.json` and secured with `Authorization: Bearer $CRON_SECRET`.

### B. Local data ingestion scripts (root, NOT deployed)

| File | Purpose |
|------|---------|
| `subir-datos.js` | Reads liturgical calendar CSV and populates `liturgical_content`. |
| `upload-audios.js` | Uploads MP3 files to Firebase Storage. |
| `make-public.js` | Sets public read permissions on Storage objects. |

These run on Jorge's laptop, not on Vercel.

### C. Configuration

- `vercel.json` — routes, headers, cron schedules.
- `.gitignore` — secrets, build artifacts, OS noise.
- `package.json` / `package-lock.json` — Node deps.

---

## Current Firestore Schema (legacy, Telegram-only)

**`users/{telegramId}`**
- `status`: `"new"` | `"free"` | `"premium"` | `"premium_coupon"` | `"revoked"`
- `state`: `"normal"` | `"awaiting_coupon"` | `"payment_failed"`
- `stripeCustomerId`, `telegramId`, `firstName`, `username`

**`coupons/{couponCode}`**
- `isActive` (boolean, one-time use)
- `status`: `"available"` | `"expired"`
- `expiresAt`: `"YYYY-MM-DD"`
- `usedBy`, `usedAt`

**`liturgical_content/{YYYY-MM-DD}`**
- `tiempo_liturgico`, `evangelio`, `audioUrl`

---

## Target Firestore Schema (post-pivot, in progress)

Designed in planning session. To be applied via migration script (Session 2).

- **`users/{uuid}`** — unified user across channels (Telegram + WhatsApp). Fields: channels[], status, telegram{}, whatsapp{}, stripe{}, delivery{}, antiAbuse{}.
- **`users/{uuid}/deliveries/{date}_{channel}`** — per-delivery audit log for idempotency.
- **`liturgical_content/{YYYY-MM-DD}`** — adds `liturgicalSeasonTag` (metadata), splits `evangelio` (text) and `reflexion` (audio premium only).
- **`wa_templates/{name}`** — WhatsApp HSM template catalog.
- **`keyword_map/{keyword}`** — on-demand keyword resolution (e.g., "Domingo" → next Sunday).
- **`webhook_events/{provider}_{eventId}`** — idempotency for Stripe and WhatsApp webhooks.

---

## Known Issues / Technical Debt (priority order)

1. **`publicar-contenido.js` has NO idempotency.** If Vercel retries the cron, content is duplicated to both channels. To fix in Session 1.
2. **`stripe-webhook.js` has NO event-id deduplication.** Stripe replays events occasionally; without an idempotency check, duplicate processing is possible. To fix in Session 1.
3. **Timezone bug in `publicar-contenido.js`.** Uses `new Date().toISOString().split('T')[0]`, which returns UTC date. Safe at 6 AM Mexico City today, but breaks for evening crons. Pin to `America/Mexico_City` explicitly.
4. **`stripe-webhook.js` handles only `customer.subscription.deleted`.** Missing handlers for `checkout.session.completed`, `customer.subscription.updated`, `invoice.payment_failed`, `invoice.payment_succeeded`. Required for trial flow.
5. **No tests.** Manual smoke checks via Telegram test channels.

---

## Roadmap

- ✅ **Session 0:** New Firestore schema designed.
- 🟡 **Session 1 (current):** `CLAUDE.md` created + idempotency patches on legacy code (`publicar-contenido.js`, `stripe-webhook.js`).
- ⬜ **Session 2:** Firestore migration script (create new collections, add fields to existing ones, no data loss).
- ⬜ **Session 3+:** WhatsApp Cloud API integration — webhook, template management, opt-in flow.
- ⬜ **Future:** Landing page for trial signup; per-user delivery scheduler (cron every 15 min reads `delivery.nextDeliveryAt`); on-demand keyword interactions.

---

## Conventions

- **ES Modules** (`import` / `export`). No CommonJS `require`.
- **Single-file handlers** — no shared business logic library yet. Each `/api/*.js` is self-contained.
- **Spanish business terminology** in field names and content (`evangelio`, `tiempo_liturgico`, `cupones`).
- **HTML `parse_mode`** for Telegram messages.
- **Logging via `sendLog()`** to the Telegram log channel for errors and critical events. Always include the project name from `PROJECT_NAME` env var.

---

## Required Environment Variables

```
# Stripe
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID

# Firebase
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY          # newlines as literal \n in the env

# Telegram
TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_USERNAME
TELEGRAM_CHANNEL_ID           # legacy / fallback
TELEGRAM_CHANNEL_ID_PREMIUM
TELEGRAM_CHANNEL_ID_FREE
TELEGRAM_LOGS_CHANNEL_ID      # private channel for sendLog()
ADMIN_CHAT_ID                 # Jorge's personal Telegram ID for emergency alerts

# Vercel
CRON_SECRET                   # Bearer token for cron endpoints
BASE_URL                      # e.g. https://your-project.vercel.app
PROJECT_NAME                  # label used in log messages

# WhatsApp (planned, not yet configured)
# WHATSAPP_ACCESS_TOKEN
# WHATSAPP_PHONE_NUMBER_ID
# WHATSAPP_VERIFY_TOKEN
# WHATSAPP_BUSINESS_ACCOUNT_ID
```