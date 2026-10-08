# Manual Test Checklist (Dev Stack)

This manual test suite validates the end-to-end functionality, security verification, error handling, and bidirectional loop prevention of **Dock** on a local or staging deployment.

---

## Pre-Test Setup Checklist

Before running tests, ensure:
- [ ] Dev server running (`npm run dev` at `http://localhost:3000`).
- [ ] ngrok / tunnel active (`ngrok http 3000`) and URLs registered in Discord & Google Cloud Console.
- [ ] Supabase migrations applied (`npx supabase db push` or local instance).
- [ ] Slash commands registered (`npm run register-commands`).
- [ ] Test Discord server with at least 2 text channels (`#drive-sync-test` and `#unmapped-test`).
- [ ] Dedicated test folder in Google Drive.
- [ ] `ALLOWED_USER_IDS` in `.env.local` configured with the primary tester's Discord user ID.

---

## Test Execution Matrix

| ID | Category | Scenario / Steps | Expected Result | Status | Notes / Logs |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **T01** | Drive -> Discord | **New file upload**<br>1. In Discord `#drive-sync-test`, link the folder: `/link folder_id:<TEST_FOLDER_ID>`<br>2. In Google Drive, upload a new image or PDF into that folder. | Exactly **one green embed** appears in `#drive-sync-test` titled **"Added by [User]"** with filename, file size, thumbnail, and Drive link. | [ ] | |
| **T02** | Drive -> Discord | **File modification**<br>1. Open the file uploaded in T01 and update its content, or upload a new revision in Google Drive. | Exactly **one blue embed** appears in `#drive-sync-test` titled **"Updated by [User]"** indicating changes. | [ ] | |
| **T03** | Idempotency | **Duplicate Webhook Delivery**<br>1. Trigger a Drive change or manually replay the exact same `X-Goog-Resource-ID` and `X-Goog-Resource-URI` webhook payload twice in rapid succession. | The second webhook is acknowledged (`200 OK`) and skipped via compound idempotency key `(file_id, modified_time, 'drive_to_discord')`. **Still only one embed** in Discord. | [ ] | |
| **T04** | Debounce & Burst | **Google Doc Edit Burst**<br>1. In the linked Drive folder, create or edit a Google Doc.<br>2. Type continuously for 30–60 seconds (generating rapid autosave revisions). | Observe webhook reception in server logs. Notice burst of revisions.<br>*Note: Adjust `DEBOUNCE_SECONDS` in `.env.local` (e.g. 10s) to throttle intermediate autosaves if noise is high.* | [ ] | |
| **T05** | Discord -> Drive | **Save to Drive (Single Attachment)**<br>1. In `#drive-sync-test`, send a message with **1 attachment** (e.g. `report.pdf`).<br>2. Right-click message -> **Apps -> Save to Drive**. | Bot responds ephemerally: "Uploading 1 attachment to Drive...". The file appears in Google Drive test folder. Bot confirms upload with link. | [ ] | |
| **T06** | Discord -> Drive | **Save to Drive (Multiple Attachments)**<br>1. In `#drive-sync-test`, send a message with **3 attachments**.<br>2. Right-click message -> **Apps -> Save to Drive**. | Bot responds ephemerally. All 3 attachments stream to Drive test folder. Bot returns success embed listing all 3 files. | [ ] | |
| **T07** | Discord -> Drive | **Save to Drive (No Attachments)**<br>1. In `#drive-sync-test`, send a text-only message with no attachments.<br>2. Right-click message -> **Apps -> Save to Drive**. | Bot responds ephemerally with an error message: "No attachments found on this message." No files uploaded to Drive. | [ ] | |
| **T08** | Discord -> Drive | **Save to Drive in Unmapped Channel**<br>1. Switch to `#unmapped-test` (a channel without any `/link`).<br>2. Post a message with an image and select **Apps -> Save to Drive**. | Bot responds ephemerally: "This channel is not linked to any Google Drive folder. Use `/link` first." | [ ] | |
| **T09** | Performance | **Large File Upload (50MB+)**<br>1. Post a 50MB+ file in `#drive-sync-test` (or upload to Drive).<br>2. Run **Apps -> Save to Drive**.<br>3. Monitor Node.js memory footprint. | File streams directly from Discord CDN into Drive API chunk stream without buffering into Node.js heap memory or triggering Out-Of-Memory (OOM). | [ ] | |
| **T10** | Loop Prevention | **Bot-Uploaded File Echo Prevention**<br>1. Save an attachment from Discord to Drive using **Apps -> Save to Drive**.<br>2. Wait for Google Drive push webhook to arrive for this newly created file. | When the Drive webhook arrives, the bridge reads `file.appProperties.source === 'discord'` and **drops the event**. No return embed is posted to Discord. | [ ] | |
| **T11** | Security | **Forged Drive Webhook**<br>Execute curl with an invalid webhook token:```bash
curl -X POST http://localhost:3000/api/drive/webhook \
  -H "X-Goog-Channel-Token: invalid-secret-token" \
  -H "X-Goog-Resource-State: update"
``` | Endpoint immediately rejects request with **`401 Unauthorized`** before processing or DB interaction. | [ ] | |
| **T12** | Security | **Forged Discord Interaction**<br>Execute curl with invalid signature headers:```bash
curl -X POST http://localhost:3000/api/discord/interactions \
  -H "X-Signature-Ed25519: 00000000000000000000000000000000" \
  -H "X-Signature-Timestamp: 1600000000" \
  -H "Content-Type: application/json" \
  -d '{"type":1}'
``` | Endpoint verification fails with **`401 Unauthorized`**. | [ ] | |
| **T13** | Security | **Forged Cron / Poll Requests**<br>Execute curl with invalid authorization:```bash
# 1. Drive Poll Endpoint
curl -X POST http://localhost:3000/api/cron/poll-drive \
  -H "Authorization: Bearer wrong-secret"

# 2. Watch Renewal Endpoint
curl -X POST http://localhost:3000/api/cron/renew-watches \
  -H "Authorization: Bearer wrong-secret"
``` | Both endpoints immediately reject with **`401 Unauthorized`**. | [ ] | |
| **T14** | Authorization | **Non-Allowed User Permission Guard**<br>1. Have a user whose Discord ID is **not** in `ALLOWED_USER_IDS` run `/link folder_id:<ID>`. | Command returns an ephemeral rejection: "You are not authorized to configure bridge links for this server." | [ ] | |
| **T15** | State Lifecycle | **Unlink and Re-link**<br>1. In `#drive-sync-test`, run `/unlink`.<br>2. Verify bot confirms channel unlinked.<br>3. Upload file to Drive -> verify no Discord embed is sent.<br>4. Run `/link folder_id:<TEST_FOLDER_ID>` again. | Watch registration and channel mapping re-activate cleanly without duplicate key constraint collisions in Supabase. | [ ] | |
| **T16** | Formatting | **File with No Thumbnail / Binary**<br>1. Upload a binary or unrecognized file format (e.g. `.bin`, `.iso`, `.tar.gz`) to Google Drive. | Embed renders cleanly with a generic fallback file icon, valid file size format, and link without breaking embed generation. | [ ] | |
| **T17** | Lifecycle | **Watch Renewal Execution**<br>1. Trigger renewal endpoint manually:```bash
curl -X POST http://localhost:3000/api/cron/renew-watches \
  -H "Authorization: Bearer <LOCAL_CRON_SECRET>"
```<br>2. Check `drive_watches` table in Supabase. | Existing watch is renewed or replaced with an updated `expiration` timestamp (up to 7 days in the future). Old channels are stopped or updated. | [ ] | |
| **T18** | Resilience | **Polling Fallback (Missed Push Event)**<br>1. Temporarily pause or stop ngrok (simulating a missed webhook delivery).<br>2. In Google Drive, upload a new file `poll-test.pdf`.<br>3. Restart ngrok.<br>4. Trigger the poll endpoint manually:```bash
curl -X POST http://localhost:3000/api/cron/poll-drive \
  -H "Authorization: Bearer <LOCAL_CRON_SECRET>"
``` | Poller queries Drive changes using `saved_start_page_token`, detects `poll-test.pdf`, posts the green embed to Discord, and updates the stored page token. | [ ] | |
| **T19** | Subfolders | **Subfolder File Upload**<br>1. Inside the linked Google Drive folder, create a nested subfolder `/2026 Campaigns/Q1 Briefs/`.<br>2. Upload `campaign_brief.pdf` into that subfolder. | Exactly **one green embed** appears in the linked channel with author "Added by [User]", type "PDF Document", and an inline **Path field**: `📂 \`/2026 Campaigns/Q1 Briefs/\``. | [ ] | |
| **T20** | Subfolders | **Nested Channel Mappings**<br>1. Link parent folder to `#general-drive`: `/link folder_id:<PARENT_FOLDER_ID>`<br>2. Link child subfolder `/Special Project/` to `#special-project`: `/link folder_id:<CHILD_FOLDER_ID>`<br>3. Upload `asset.png` inside `/Special Project/`. | Nearest ancestor logic routes the announcement **only** to `#special-project`. `#general-drive` receives zero notifications. | [ ] | |
| **T21** | Subfolders | **File Moved Between Mapped Folders**<br>1. Have Folder A linked to `#channel-a` and Folder B linked to `#channel-b`.<br>2. In Drive, move an existing file from Folder A into Folder B. | Compound idempotency version records destination folder. `#channel-b` receives a green embed titled **"Added by [User]"** with the new folder path. | [ ] | |
| **T22** | Cache Lifecycle | **Folder Renamed / Cache Invalidation**<br>1. Rename subfolder `/Drafts/` to `/Final Assets/` in Google Drive.<br>2. Verify no notification spam occurs for the folder rename itself.<br>3. Upload `approved.pdf` into `/Final Assets/`. | Subfolder cache evicts on folder change event. Embed for `approved.pdf` accurately reflects the new path `📂 \`/Final Assets/\`` without requiring manual restart. | [ ] | |

---

## Test Run Sign-Off

- **Date Tested**: ____________________
- **Tester Name / Handle**: ____________________
- **Environment**: [ ] Local Dev [ ] Staging / Vercel Preview
- **All Critical Security Tests Passed (T11-T14)**: [ ] YES [ ] NO
- **Sign-Off Signature**: ____________________
