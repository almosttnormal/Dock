# Environment Strategy & Multi-Developer Isolation

## 1. Why Each Developer Must Run an Isolated Stack

In **Dock**, running two developers against the same database or Google Drive account will corrupt synchronization state. Specifically:

1. **`drive_sync_state` is a Singleton Record**:
   - Google Drive `changes.list` relies on an opaque `startPageToken` / `nextPageToken`.
   - The server stores a single token in `drive_sync_state` (`id = 'global_drive_sync'`).
   - If Developer A advances the page token on their local machine, Developer B's machine will immediately miss changes or encounter invalid page token exceptions.
2. **`changes.watch` Webhook Addresses are Global per Channel**:
   - Google push notifications target a single public HTTPS URL.
   - If two developers share a Google account or webhook token, notifications will either be rejected or route to the wrong local tunnel.
3. **Discord Interaction Webhook URL is Unique per Application**:
   - Each Discord Application has exactly one **Interactions Endpoint URL** in the Discord Developer Portal.
   - Two developers cannot share one Discord Application ID because their local tunnel URLs (`ngrok` / `cloudflared`) will conflict.

---

## 2. Developer Stacks Overview

| Environment | Purpose | Infrastructure | Deployment Trigger |
| :--- | :--- | :--- | :--- |
| **Local Dev (@REPLACE-DEV-A)** | Feature development & tests | Own Discord Bot + Own Supabase + Own Google Drive | Local `npm run dev` + tunnel |
| **Local Dev (@REPLACE-DEV-B)** | Feature development & tests | Own Discord Bot + Own Supabase + Own Google Drive | Local `npm run dev` + tunnel |
| **Production** | Live agency operations | Shared Agency Discord + Supabase Prod + Agency Drive | Pushes to `main` via Vercel |

---

## 3. Setting Up Your Isolated Dev Stack

Every developer needs:
1. **Their Own Discord Application**:
   - Create at [Discord Developer Portal](https://discord.com/developers/applications).
   - Create a private test Discord server (guild) and invite your bot.
2. **Their Own Supabase Project**:
   - Create a free project at [supabase.com](https://supabase.com).
   - Run `supabase/migrations/20261007_init.sql` in the SQL Editor.
3. **Their Own Google Drive Test Folder**:
   - Create a test folder in your Google Drive.
   - Run `npx tsx scripts/get-google-refresh-token.ts` with your test Google Cloud credentials to obtain your refresh token.
4. **Local Configuration**:
   - Store your credentials in `.env.local` (which is git-ignored).

---

## 4. Production Environment Rules

- **Only deploys from branch `main`**: Production deployments are managed by Vercel from approved and merged pull requests.
- **Never point local dev to production Supabase or Google Drive**: Breaches loop prevention and advances production change tokens.
