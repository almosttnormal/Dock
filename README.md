# Dock

An internal, zero-worker Google Drive <-> Discord integration bridge designed for a 3-person creative/digital agency. Maps individual client Discord channels to Google Drive folders with bidirectional synchronization, rich announcements, loop prevention, and strict idempotency.

---

## Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                                 VERCEL SERVERLESS                                 |
|                                                                                   |
|  [ Inbound Discord ]          [ Inbound Drive ]           [ Daily Vercel Cron ]   |
|   /api/discord/interactions    /api/drive/webhook          /api/cron/renew-watches|
|        (Ed25519 Check)           (X-Goog Token)                 (Bearer Token)    |
|               |                         |                              |          |
|      +--------+--------+       +--------+--------+                     |          |
|      | Immediate ACK   |       | Immediate 200   |                     |          |
|      | (<3s response)  |       | (Handshake/ACK) |                     |          |
|      +--------+--------+       +--------+--------+                     |          |
|               |                         |                              |          |
|         after() async             after() async                        |          |
|               |                         |                              |          |
|               v                         v                              v          |
|      [ Streaming Pipe ]        [ Change Processor ]       [ Watch Renewal & Sync ]|
|   Download -> Pipe -> Drive    Diff changes vs Token     Renew channel subscription|
|  appProperties.source=discord   Loop Breaker check        Stop stale subscriptions |
+---------------+-------------------------+------------------------------+----------+
                |                         |                              |
                v                         v                              v
     +---------------------+    +---------------------+     +-----------------------+
     |   Discord REST v10  |    |   Google Drive v3   |     |    Supabase (Postgres)|
     |  (Native fetch API) |    |  (Owner OAuth2)     |     |   RLS + Service Role  |
     +---------------------+    +---------------------+     +-----------------------+
```

---

## Prerequisites

- **Node.js**: `v24.x` (enforced via `.nvmrc` and `engines`).
- **Google Cloud Console**: Free account with Google Drive API enabled and OAuth 2.0 Web Client credentials.
- **Discord Developer Portal**: Free account with Bot application and `applications.commands` scope.
- **Supabase**: Free database instance.
- **Vercel**: Free Hobby plan for serverless hosting and daily cron.

---

## Quick Start for a New Developer (< 30 Minutes)

Follow these steps to spin up your isolated local development stack:

### 1. Clone & Install Dependencies
```bash
git clone git@github.com:shonjoo/Dock.git
cd Dock
nvm use 24
npm install
```

### 2. Configure Your Isolated Test Stack
Every developer needs their own isolated test resources (see [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)):
1. Create a free test project in [Supabase](https://supabase.com) and run `supabase/migrations/20261007_init.sql` in the SQL Editor.
2. Create a test application in the [Discord Developer Portal](https://discord.com/developers/applications), create a bot, and invite it to your private test server with `applications.commands`, `Send Messages`, and `Attach Files` permissions.
3. In Google Cloud Console, enable Drive API, generate OAuth client credentials, and create a test folder in your Google Drive.

### 3. Generate Your Google Refresh Token
Run the interactive CLI helper:
```bash
npx tsx scripts/get-google-refresh-token.ts
```
Follow the browser consent prompt to generate your test `GOOGLE_REFRESH_TOKEN`.

### 4. Create Your Local Environment File
Copy [.env.example](.env.example) to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in your test credentials (see [docs/SECRETS.md](docs/SECRETS.md) for details).

### 5. Register Discord Commands to Your Test Guild
```bash
npx tsx scripts/register-commands.ts
```

### 6. Run the Local Development Server
```bash
npm run dev
```
- Test Discord interactions locally via a tunnel (see [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md)).
- Test Drive synchronization locally via the reconciliation route:
  ```bash
  curl -X POST http://localhost:3000/api/drive/poll \
    -H "Authorization: Bearer <YOUR_LOCAL_CRON_SECRET>"
  ```

---

## Documentation Index

- [Architecture & Invariants](docs/ARCHITECTURE.md): Idempotency keys, loop breaker tags, and 3-second SLA handling.
- [Environment Strategy](docs/ENVIRONMENTS.md): Why dev environments must remain completely isolated.
- [Local Development Guide](docs/LOCAL-DEV.md): Tunneling with Cloudflare/ngrok and manual polling workflows.
- [Secrets & Rotation](docs/SECRETS.md): Credential inventory, ownership matrix, and rotation runbooks.
- [Contributing Guidelines](CONTRIBUTING.md): Branch strategy, PR checklist, and domain ownership.
- [Security Policy](SECURITY.md): Vulnerability reporting procedures.

---

## Testing & Quality Assurance

Run the complete pre-flight validation suite:
```bash
npm run typecheck && npm run lint && npm run test && npm run build
```



