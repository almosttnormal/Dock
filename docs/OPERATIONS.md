# Production Operations Manual (Dock)

This guide outlines runtime management, external polling configurations, secrets rotation procedures, recovery playbooks, and routine operational maintenance for **Dock** (Google Drive <-> Discord Bridge).

---

## 1. Setting Up cron-job.org Polling

To ensure resilience against missed push notifications (network hiccups, transient 5xx errors, or cold starts), configure an external cron job via [cron-job.org](https://cron-job.org) to ping the Drive changes poller every 5 minutes.

### Step-by-Step Field Configuration

1. Log in to **cron-job.org** and click **Create Cronjob**.
2. Fill in the fields exactly as follows:

| Form Field | Value / Configuration | Explanation |
| :--- | :--- | :--- |
| **Title** | `Dock - 5m Poller` | A recognizable name for the job. |
| **URL** | `https://<YOUR_PRODUCTION_DOMAIN>/api/drive/poll` | Production endpoint that queries Drive changes via start page token. |
| **Execution Schedule** | `Every 5 minutes` (`*/5 * * * *`) | Frequency to query for changes missed by webhooks. |
| **Request Method** | `GET` | The endpoint supports both `GET` and `POST`. |
| **Request Timeout** | `30 seconds` | Gives Next.js sufficient time to process changes and post embeds. |
| **Headers** | Key: `Authorization`<br>Value: `Bearer <YOUR_PRODUCTION_CRON_SECRET>` | Strictly required. Requests without this matching secret return `401 Unauthorized`. |
| **Failure Notifications** | Enable email or alert on consecutive failures | Set alerts for 2 or 3 consecutive failures to catch credential revocation early. |

3. Click **Save** and trigger a test execution. Ensure the response status is `200 OK` with JSON `{ "success": true, ... }`.

---

## 2. Troubleshooting: What to Check if Announcements Stop

If uploads/modifications in Google Drive stop appearing in Discord, troubleshoot in the following order:

### A. Check Drive Watch Expiration
Google Drive push notification channels expire after a maximum of 7 days:
1. Open your Supabase Dashboard -> Table Editor -> `drive_watches`.
2. Inspect the latest record's `expiration` column (Unix timestamp in milliseconds).
3. If `expiration < now()`, the watch channel expired before renewal:
   - Run the renewal endpoint manually:
     ```bash
     curl -X GET https://<YOUR_PRODUCTION_DOMAIN>/api/cron/renew-watches \
       -H "Authorization: Bearer <CRON_SECRET>"
     ```
   - Verify Vercel Cron or your scheduler is triggering `/api/cron/renew-watches` daily.

### B. Check Stale or Corrupted Page Token
If changes are not being picked up or an invalid page token error occurs:
1. Check Supabase table `sync_state` for key `drive_start_page_token`.
2. If Drive returns a `400` or `410 Gone` error (meaning the page token expired after extensive inactivity):
   - Re-run the bootstrap script to fetch a fresh token:
     ```bash
     npx tsx scripts/bootstrap-drive.ts
     ```
   - This records a fresh starting token in `sync_state` and establishes a new watch channel.

### C. Check Google OAuth Refresh Token Revocation
If Google API calls return `400 invalid_grant` or `401 Unauthorized`:
1. The OAuth refresh token has expired (common in "Testing" mode projects after 7 days) or was explicitly revoked.
2. Follow Section 5 below to generate a new `GOOGLE_REFRESH_TOKEN`.

### D. Inspect Vercel / Server Logs
1. Go to your **Vercel Dashboard -> Project -> Logs**.
2. Filter for `/api/drive/webhook` and `/api/drive/poll`.
3. Check for specific status codes:
   - `401 Unauthorized`: Webhook token or Bearer secret mismatch.
   - `429 Too Many Requests`: Discord rate limits encountered. Check Discord retry-after header handling.
   - `500 Internal Server Error`: Inspect the stack trace (e.g. database connection timeout, Supabase RLS policy issue).

---

## 3. How to Re-Run `bootstrap-drive` Safely

The bootstrap script resets the push notification watch and establishes a fresh page token.

```bash
# In production or staging environment:
npx tsx scripts/bootstrap-drive.ts
```

### Safety Guarantees
- **Idempotent State Update**: `bootstrap-drive.ts` inserts or updates `sync_state` with the latest start page token and stores the new watch in `drive_watches`.
- **Existing Channel Mappings Preserved**: Channel-to-folder mappings in `channel_mappings` are untouched.
- **Deduplication Maintained**: Past entries in `file_events` remain intact, preventing re-announcement of previously synced files.

---

## 4. Zero-Downtime Secret Rotation

To rotate critical tokens without dropping incoming events or failing active cron jobs, follow the strict order of operations below:

### A. Rotating `CRON_SECRET`
Used by Vercel Cron and cron-job.org to authorize `/api/cron/*` and `/api/drive/poll`.

1. **Dual-Accept / Window Update**:
   - Generate a new cryptographically random secret:
     ```bash
     openssl rand -hex 32
     ```
2. **Update Hosting Environment**:
   - Update `CRON_SECRET` in your hosting provider (e.g., Vercel Project Settings -> Environment Variables).
   - Trigger a deployment so the server uses the new secret.
3. **Immediately Update Schedulers**:
   - Update the `Authorization: Bearer <NEW_CRON_SECRET>` header in **cron-job.org**.
   - If using Vercel Cron, Vercel automatically injects the project's current `CRON_SECRET`.
4. **Verify**:
   - Manually trigger cron-job.org and confirm `200 OK`.

### B. Rotating `DRIVE_WEBHOOK_TOKEN`
Used in the `X-Goog-Channel-Token` header sent by Google Drive when dispatching push notifications.

1. **Generate New Token**:
   ```bash
   openssl rand -hex 32
   ```
2. **Update Environment**:
   - Update `DRIVE_WEBHOOK_TOKEN` in your hosting provider and redeploy.
3. **Register New Watch Channel**:
   - Google Drive sends the token configured *at watch creation time*. Changing the env variable alone will cause existing webhook deliveries to fail verification with `401`.
   - Immediately re-register the watch with the new token:
     ```bash
     npx tsx scripts/bootstrap-drive.ts
     ```
   - This creates a new Google Drive channel registered with the new `DRIVE_WEBHOOK_TOKEN`.
4. **Clean Up Old Channel**:
   - Stop the previous watch channel ID via the Google Drive API or let its remaining validity expire naturally.

---

## 5. How to Re-Issue Google OAuth Refresh Token

If `GOOGLE_REFRESH_TOKEN` expires or is revoked:

1. **Verify App Publishing Status**:
   - In [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services** -> **OAuth consent screen**:
   - If User Type is **External** and Publishing Status is **Testing**, tokens expire after **7 days**. Move the app to **In production** (or add your account as a permanent test user) to ensure long-lived tokens.
2. **Use Google OAuth 2.0 Playground**:
   - Visit [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
   - Click the gear icon (top right):
     - Check **Use your own OAuth credentials**.
     - Enter your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   - In Step 1: Authorize APIs:
     - Input scope: `https://www.googleapis.com/auth/drive`
     - Click **Authorize APIs** and log in with your Google account.
   - In Step 2: Exchange authorization code for tokens:
     - Click **Exchange authorization code for tokens**.
     - Copy the string from the **Refresh token** field.
3. **Update Production Environment**:
   - Replace `GOOGLE_REFRESH_TOKEN` in Vercel.
   - Re-run `npx tsx scripts/bootstrap-drive.ts` to ensure API access is restored.

---

## 6. Client Management: Adding and Removing Channels

### Adding a Client / Channel (`/link`)
1. In Discord, navigate to the target channel (e.g. `#client-assets`).
2. **Channel Privacy Check**:
   - Verify the Discord channel has appropriate permissions configured (e.g., private channel restricted to intended team roles).
   - Files uploaded to the linked Drive folder will produce announcements with file names and thumbnails visible to everyone who can view the channel.
3. Ensure the Drive folder is shared with the Google account owning the OAuth credentials.
4. Run the slash command:
   ```text
   /link folder_id:<GOOGLE_DRIVE_FOLDER_ID>
   ```
5. Bot confirms linkage. Any new files placed in that folder will notify `#client-assets`.

### Removing a Client / Channel (`/unlink`)
1. In the Discord channel you wish to disconnect:
   ```text
   /unlink
   ```
2. The bot removes the mapping from `channel_mappings`.
3. Drive changes for that folder will no longer be routed to Discord.
4. *(Optional)* Revoke Google Drive folder sharing permissions if the client should no longer have access.

---

## 7. Weekly 5-Minute Health Routine

Perform this quick check once a week to guarantee system health:

- [ ] **Check Watch Expiration**:
  - Query `drive_watches` in Supabase: verify `expiration` is at least 24 hours in the future.
- [ ] **Review cron-job.org Execution History**:
  - Open cron-job.org dashboard: confirm all executions in the past 7 days report status `200` with 0 failures.
- [ ] **Check Error Logs**:
  - Filter Vercel runtime logs for `status >= 400`. Confirm absence of `invalid_grant` or unhandled exceptions.
- [ ] **End-to-End Test File Ping**:
  - Upload a tiny test image (`test-ping.png`) to a designated internal test folder.
  - Verify a green embed appears in Discord within 60 seconds.
  - Delete `test-ping.png`.
- [ ] **Verify Database Disk / Quota**:
  - Check Supabase project compute/storage metrics to ensure table sizes remain healthy.

---

## 8. Subfolder Cache Maintenance (`drive_folder_cache`)

Dock caches Google Drive subfolder lineage in Postgres table `drive_folder_cache` to minimize Google Drive API roundtrips during sync.

### Automatic Invalidation & Expiration
- **24-Hour TTL**: Each cached folder row has an `expires_at` timestamp set to 24 hours from creation.
- **Real-Time Eviction**: When a folder itself is renamed, moved, or deleted, Google Drive emits a folder change event (`application/vnd.google-apps.folder`). Dock automatically catches this event and evicts that folder's row from `drive_folder_cache` before skipping announcements.
- **In-Batch Memoization**: Sibling files uploaded into the same subfolder resolve the hierarchy with only 1 API call per batch execution.

### Manual Cache Invalidation
If a folder structure was extensively reorganized in Google Drive and you want to force an immediate refresh across all cached folders:

1. **SQL Flush (Supabase SQL Editor)**:
   ```sql
   -- Purge entire subfolder cache to force fresh Drive API lookups
   TRUNCATE TABLE drive_folder_cache;
   ```
2. **Purge Expired Rows Only**:
   ```sql
   DELETE FROM drive_folder_cache WHERE expires_at < now();
   ```
   *(Dock also cleans expired rows during background routines via `cleanExpiredFolders()`.)*

---

## 9. Database Migrations & Rollback Advisory

### Migration `20261008_subfolder_cache.sql` (`file_events.version`)
Migration `20261008_subfolder_cache.sql` enforces that `file_events.version` is `NOT NULL`:
- It replaces the previous unique constraint on `(file_id, modified_time, direction)` with `(file_id, version, direction)`.
- It backfills existing records and sets `ALTER TABLE file_events ALTER COLUMN version SET NOT NULL;`.

> [!CAUTION]
> **Rollback Warning**: Rolling back application code to a pre-subfolder version (which omitted `version` on insertions) will fail with database constraint errors (`null value in column "version" of relation "file_events" violates not-null constraint`).
> 
> **Operational Rule**: **Do not rollback** to pre-subfolder code. If issues arise, **roll forward** with fixes. If a full downgrade is strictly required, you must first apply a compensating database migration to make `version` nullable and restore the original `(file_id, modified_time, direction)` constraint before deploying older application code.

