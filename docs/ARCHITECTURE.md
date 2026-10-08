# Architecture & Invariants

This document outlines the non-negotiable architectural invariants that both developers must preserve.

---

## 1. Zero-Worker Serverless Architecture

- The entire bridge operates within **Next.js 15.1+ App Router** on Vercel Hobby.
- **No persistent background worker**, no long-lived daemon, no PM2/Docker container.
- Zero `discord.js`: Discord is called exclusively via native `fetch` against Discord REST v10. This avoids memory leaks and keeps dependencies minimal.

---

## 2. Invariant: 3-Second Discord Interaction Deadline

Discord requires an interaction acknowledgement within **3.0 seconds**, or the interaction fails with "The application did not respond".

### Preservation Rule:
All long-running work (fetching attachment streams, piping to Google Drive, updating database records) MUST run inside Next.js `after()`, returning a deferred response (`type: 5`) immediately:

```typescript
const ackResponse = NextResponse.json({
  type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  data: { flags: 64 }, // Ephemeral ACK
});

after(async () => {
  await executeSaveToDriveJob(...);
});

return ackResponse;
```

---

## 3. Invariant: Compound Idempotency `(file_id, modified_time, direction)`

Do **NOT** use MD5 hashes or Google change IDs for deduplication:
- Collaborative docs (Google Docs/Sheets) do not have MD5 checksums.
- Metadata edits (renames, moving parents) must trigger announcements but do not alter MD5.

### Preservation Rule:
- Enforce the PostgreSQL unique constraint on `(file_id, modified_time, direction)` in `file_events`.
- Attempt atomic inserts via `recordFileEventIdempotent()`. If PostgreSQL error `23505` occurs, the event is duplicate and discarded cleanly.

---

## 4. Invariant: Loop Prevention via `appProperties.source = "discord"`

A naive bridge creating a file in Google Drive from Discord will immediately trigger Google Drive's `changes.watch` webhook, posting the file right back to Discord in an infinite loop.

### Preservation Rule:
1. Every file written to Drive from Discord MUST set:
   ```json
   {
     "appProperties": {
       "source": "discord"
     }
   }
   ```
2. The Drive change processor (`processDriveChanges`) MUST inspect:
   ```typescript
   if (file.appProperties?.source === "discord") {
     continue; // Skip loop event
   }
   ```

---

## 5. Invariant: Failed Discord Post Must Roll Back Event and Freeze Page Token

If Discord returns an error (rate limited, network blip, invalid permissions) while posting an embed:

### Preservation Rule:
1. **Delete the created `file_events` row**:
   ```typescript
   await deleteFileEvent(eventRow.id);
   ```
2. **Do NOT advance `drive_sync_state.page_token`**:
   The routine must abort with an exception before updating `drive_sync_state`. This guarantees that subsequent webhook notifications or reconciliation polls will re-fetch the unprocessed change.
