# Local Development Guide

This guide explains how to develop and test **Dock** (Google Drive <-> Discord Bridge) locally.

---

## 1. Running Locally Without a Public Domain for Google Drive

Google Drive's `changes.watch` API requires a public HTTPS URL with a verified domain name or valid SSL cert, meaning Google **cannot send push notifications to `localhost`**.

Instead of trying to verify local domains with Google Search Console, local development uses the **protected reconciliation poll route**:

### Starting the Server
```bash
npm run dev
```
By default, the server listens at `http://localhost:3000`.

### Manually Polling Drive Changes Locally
When you upload or modify a file in your mapped test folder on Google Drive, trigger the change sync via `curl`:

```bash
curl -X POST http://localhost:3000/api/drive/poll \
  -H "Authorization: Bearer <YOUR_LOCAL_CRON_SECRET>"
```

The endpoint will:
1. Fetch changes since the last `page_token`.
2. Filter for direct children of folders in your local `channel_mappings`.
3. Post the rich embed announcement to your test Discord channel.
4. Advance the local `drive_sync_state` token.

---

## 2. Exposing the Discord Interactions Endpoint Locally

Discord sends interaction webhooks (`/link`, `/unlink`, and "Save to Drive") to a public HTTPS endpoint. To receive interactions on `localhost:3000`, use a tunneling tool (installed as a developer CLI tool, **not** as a project dependency).

### Option A: Cloudflare Tunnels (Recommended)
```bash
cloudflared tunnel --url http://localhost:3000
```

### Option B: ngrok
```bash
ngrok http 3000
```

### Configuring Discord Developer Portal
1. Copy the HTTPS forwarding URL (e.g. `https://xxxx.trycloudflare.com` or `https://xxxx.ngrok-free.app`).
2. Navigate to your Application in the [Discord Developer Portal](https://discord.com/developers/applications).
3. Under **General Information**, set **Interactions Endpoint URL** to:
   ```
   https://YOUR-TUNNEL-URL/api/discord/interactions
   ```
4. Click **Save Changes**. Discord will send an Ed25519 PING request; your local Next.js server will verify the signature and return PONG.

---

## 3. Local Verification Loop

Before committing any changes:

```bash
# 1. Type checking
npm run typecheck

# 2. Linting
npm run lint

# 3. Unit and integration tests
npm run test

# 4. Production build test
npm run build
```
