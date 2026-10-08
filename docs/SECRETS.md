# Secrets Management & Rotation Policy

## 1. Secrets Inventory & Ownership

| Variable | Description | Managed Where | Owner |
| :--- | :--- | :--- | :--- |
| `PUBLIC_BASE_URL` | Public production URL | Vercel Project Settings / `.env.local` | Platform Lead |
| `DISCORD_APPLICATION_ID`| Discord Application ID | Vercel Project Settings / `.env.local` | Discord Admin |
| `DISCORD_PUBLIC_KEY` | Ed25519 public key | Vercel Project Settings / `.env.local` | Discord Admin |
| `DISCORD_BOT_TOKEN` | Discord Bot secret token | Vercel Env (Encrypted) / Password Mgr | Discord Admin |
| `DISCORD_GUILD_ID` | Guild/server snowflake ID | Vercel Project Settings / `.env.local` | Discord Admin |
| `ALLOWED_USER_IDS` | Authorized admin user IDs | Vercel Project Settings / `.env.local` | Agency Lead |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | Vercel Project Settings / `.env.local` | Google Admin |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | Vercel Env (Encrypted) / Password Mgr | Google Admin |
| `GOOGLE_REFRESH_TOKEN` | Google Account Refresh Token | Vercel Env (Encrypted) / Password Mgr | Google Admin |
| `DRIVE_WEBHOOK_TOKEN` | Google webhook shared secret | Vercel Env (Encrypted) / Password Mgr | Platform Lead |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | Vercel Project Settings / `.env.local` | Database Admin |
| `SUPABASE_SERVICE_ROLE_KEY`| Supabase Service Role Secret| Vercel Env (Encrypted) / Password Mgr | Database Admin |
| `CRON_SECRET` | Vercel Cron bearer token | Vercel Env (Encrypted) / Password Mgr | Platform Lead |
| `DEBOUNCE_SECONDS` | Optional debounce window | Vercel Project Settings / `.env.local` | Platform Lead |

---

## 2. Cardinal Security Rules

1. **NEVER share secrets via chat, pull requests, issues, or commits**: Any secret pasted in Discord, Slack, GitHub comments, or git history is considered compromised immediately.
2. **Local secrets live strictly in `.env.local`**: Never edit `.env` or commit `.env*` files.
3. **Production secrets live strictly in Vercel Environment Variables**: Accessible only to designated repository administrators.

---

## 3. Secret Rotation Procedures

### A. Discord Bot Token (`DISCORD_BOT_TOKEN`)
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) > Your App > **Bot**.
2. Click **Reset Token**.
3. Update Vercel Environment Variables (`DISCORD_BOT_TOKEN`).
4. Trigger a deployment redeploy in Vercel.

### B. Google OAuth Client & Refresh Token (`GOOGLE_REFRESH_TOKEN`)
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Reset or re-issue client secret if needed.
3. Run `npx tsx scripts/get-google-refresh-token.ts` locally with the updated credentials to acquire a new refresh token.
4. Update `GOOGLE_REFRESH_TOKEN` in Vercel.
5. Trigger a deployment redeploy.
6. Run `npx tsx scripts/bootstrap-drive.ts` to re-register the watch channel.

### C. Supabase Service Role Key (`SUPABASE_SERVICE_ROLE_KEY`)
1. Go to [Supabase Dashboard](https://supabase.com/dashboard) > Project > **Settings** > **API**.
2. Under **Project API keys**, click **Roll key** for `service_role`.
3. Update Vercel Environment Variables (`SUPABASE_SERVICE_ROLE_KEY`).
4. Trigger a deployment redeploy.

### D. Webhook Tokens (`CRON_SECRET`, `DRIVE_WEBHOOK_TOKEN`)
1. Generate a new high-entropy string:
   ```bash
   node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
   ```
2. Update `CRON_SECRET` or `DRIVE_WEBHOOK_TOKEN` in Vercel Environment Variables.
3. Redeploy the application.
4. If `DRIVE_WEBHOOK_TOKEN` changed, re-register the Google watch via `/api/cron/renew-watches` or `scripts/bootstrap-drive.ts`.
