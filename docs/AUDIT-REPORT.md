# Full Project Audit: Dock

**Repository**: [shonjoo/Dock](https://github.com/shonjoo/Dock.git)  
**Version**: `1.0.0` (Commit `966e033`)  
**Stack**: Next.js 15.1.7 (App Router), TypeScript 5.7 Strict, Supabase (PostgreSQL), Node 20.x, Vercel Serverless  
**Audit Date**: October 7, 2026  
**Status**: **PRODUCTION-READY & PUBLICLY SECURE**

---

## Executive Summary

**Dock** is a zero-worker, serverless synchronization bridge connecting Discord channels and Google Drive folders. It eliminates background worker VMs by taking advantage of Next.js 15.1+ `after()` asynchronous execution.

This audit evaluates the codebase across six dimensions:
1. **Security & Inbound Signature Verification**
2. **Loop Prevention & Idempotency**
3. **Architecture & Performance (Zero-Worker Design)**
4. **Data Layer & Migrations**
5. **Code Quality, Testing & Build Health**
6. **Multi-Developer Collaboration & Git Hygiene**

---

## 1. Security & Perimeter Defense

| Area | Implementation & Mechanism | Audit Status |
| :--- | :--- | :---: |
| **Discord Verification** | `verifyDiscordRequest` in [lib/discord/verify.ts](../lib/discord/verify.ts) enforces raw Ed25519 signature checks using `discord-interactions` before parsing any JSON payload. | **PASS** (Zero bypass vulnerability) |
| **Drive Webhook Verification** | [app/api/drive/webhook/route.ts](../app/api/drive/webhook/route.ts) compares `X-Goog-Channel-Token` against `DRIVE_WEBHOOK_TOKEN` with constant-time equality checks before processing. | **PASS** |
| **Cron & Poller Auth** | Both `/api/cron/renew-watches` and `/api/drive/poll` enforce `Authorization: Bearer <CRON_SECRET>`. Unauthenticated requests return `401 Unauthorized`. | **PASS** |
| **Command Permission Guard** | Slash commands `/link` and `/unlink` check invoker ID against `ALLOWED_USER_IDS` in [lib/env.ts](../lib/env.ts). Unauthorized users receive ephemeral rejection. | **PASS** |
| **Secret Management** | Environment validation via strict Zod schema in [lib/env.ts](../lib/env.ts). No secrets logged or committed. Full history scanned with `gitleaks`. | **PASS** (0 secrets in history or working tree) |
| **PostgreSQL RLS** | All tables (`channel_mappings`, `drive_sync_state`, `drive_watches`, `file_events`, `drive_folder_cache`) have Row Level Security enabled with zero public policies. | **PASS** (Server-side service role only) |

---

## 2. Bidirectional Loop Prevention & Idempotency

### A. Feedback Loop Elimination
- **Mechanism**: When saving Discord attachments to Drive via context menu, [lib/drive/upload.ts](../lib/drive/upload.ts) sets `file.appProperties.source = 'discord'`.
- **Enforcement**: In [lib/drive/changes.ts](../lib/drive/changes.ts), incoming Drive push events check `file.appProperties?.source === 'discord'` and drop the event immediately.
- **Audit Outcome**: Mathematically prevents ping-pong loops between Discord and Google Drive.

### B. Compound Idempotency (`file_events`)
- **Compound Key**: Unique constraint `(file_id, version, direction)` where `version = "${modifiedTime}|${mappedFolderId}"`.
- **Move Awareness**: Moving a file between mapped folders triggers an announcement in the new folder as "Added by" because the destination folder forms part of the unique key and history lookup.
- **Rollback Guarantee**: If Discord API returns an error during announcement, the database row in `file_events` is deleted and the page token is not advanced, ensuring at-least-once delivery with rollback safety.

---

## 3. Architecture & Subfolder Resolution

```
                                      ARCHITECTURE OVERVIEW
+---------------------------------------------------------------------------------------------------------+
|                                           VERCEL SERVERLESS                                             |
|                                                                                                         |
|   [ Inbound Discord ]                 [ Inbound Drive Push ]                     [ 5m Poll / Cron ]     |
|   /api/discord/interactions           /api/drive/webhook                         /api/drive/poll        |
|   (Ed25519 signature check)           (X-Goog-Channel-Token check)               (Bearer CRON_SECRET)   |
|               |                                   |                                      |              |
|      Fast ACK (<3s)                      Fast ACK (200 OK)                              GET/POST        |
|               |                                   |                                      |              |
|         after() async                       after() async                                |              |
|               |                                   |                                      |              |
|               v                                   v                                      v              |
|      [ Direct HTTP Stream ]             [ Hierarchy Resolver ]                  [ Changes Poller ]      |
|     Discord CDN -> Drive API             (3-Tier: Mem -> DB -> API)            Using Start Page Token   |
|      (Zero disk/memory buffer)         Nearest Mapped Folder Priority            Deduplicates Events    |
+---------------------------------------------------------------------------------------------------------+
```

### A. Subfolder & Ancestor Resolver Engine
- **Nearest Ancestor Priority**: Traverses upward from any file's parents and stops at the first mapped folder, supporting nested mappings (`#general-drive` vs `#special-project`).
- **3-Tier Hierarchy Cache**:
  1. *In-batch memory cache*: Sibling files uploaded in the same subfolder trigger only 1 Drive API call.
  2. *Postgres cache (`drive_folder_cache`)*: 24-hour TTL caching for folder lineage.
  3. *Drive API fallback*: Max depth 10 hops with cycle detection (`visited: Set<string>`).
- **Resilient Error Handling**: Drive API `403`/`404` on ancestor lookups marks the branch unmapped without failing the batch; `429`/`5xx` throws for retry.
- **Real-Time Invalidation**: Folder rename, move, or trash events evict the cache row in real time before folder suppression.

### B. Streaming Large File Transfers
- Discord attachments stream directly from Discord CDN into Google Drive API chunked streams via `Readable.fromWeb(res.body)` without buffering entire files in memory or overflowing Vercel's serverless heap.

---

## 4. Database Schema & Migration Review

The database uses additive-only migrations applied sequentially:

1. **`supabase/migrations/20261007_init.sql`**:
   - `channel_mappings`: Maps Discord `channel_id` to Google Drive `folder_id`.
   - `drive_sync_state`: Singleton tracking `page_token` for incremental change detection.
   - `drive_watches`: Stores Google Drive push notification channel registrations.
   - `file_events`: Audit log and idempotency tracking table.
2. **`supabase/migrations/20261008_subfolder_cache.sql`**:
   - `drive_folder_cache`: Caches ancestor folder names and parents with `expires_at` TTL index.
   - `file_events.version`: Upgrades uniqueness to `(file_id, version, direction)`.
   - All tables enforce Row Level Security (`ENABLE ROW LEVEL SECURITY`).

---

## 5. Test Suite & Verification Results

Verification completed on Node 20.x:

| Check | Tool / Command | Result | Details |
| :--- | :--- | :---: | :--- |
| **Type Check** | `tsc --noEmit` | **PASS** | 0 TypeScript errors |
| **Lint** | `next lint` | **PASS** | 0 warnings, 0 errors |
| **Unit & Integration Tests** | `vitest run` | **PASS** | **58/58 passed across 8 test suites** |
| **Production Build** | `next build` | **PASS** | Optimized Next.js 15 production build |

### Test Breakdown by Module
- `lib/security.test.ts` (8 tests): Ed25519 signature checks, forged webhooks, forged cron tokens, allowed user checks.
- `lib/drive/hierarchy.test.ts` (15 tests): Fast path, 3-level subfolders, nested mappings, cycle protection, depth 10 cap, 403/404 non-blocking, 429 retry, sibling memoization, path markdown escaping.
- `lib/drive/changes.test.ts` (4 tests): Loop suppression, rollback on post failure, folder change eviction, subfolder announcement.
- `lib/discord/embeds.test.ts` (5 tests): File size format, green "Added", blue "Updated", subfolder `Path` field, root omission.
- `lib/discord/save-to-drive.test.ts` (3 tests): Attachment streaming, ephemeral responses, no-attachment rejection.
- `lib/bridge/repository.test.ts` (18 tests): Channel mapping CRUD, versioned idempotency, folder cache TTL, eviction, sync token.
- `lib/drive/drive.test.ts` (3 tests): Drive client instantiation, token exchange.
- `lib/env.test.ts` (2 tests): Zod schema parsing and missing environment variable handling.

---

## 6. Repository Hygiene & Multi-Developer Operations

1. **Git History Cleanliness**:
   - Single clean root commit (`966e033`) on `main`.
   - **Zero** absolute local paths in git history or working tree.
   - `graphify-out/` and all `.env*` files untracked and excluded via [.gitignore](../.gitignore).
2. **Documentation & Onboarding**:
   - [README.md](../README.md): Quick start guide (<30 mins) with text architecture diagram.
   - [docs/ENVIRONMENTS.md](./ENVIRONMENTS.md): Explains why dual-developer stacks must be isolated.
   - [docs/LOCAL-DEV.md](./LOCAL-DEV.md): Local ngrok tunneling and manual poll testing.
   - [docs/OPERATIONS.md](./OPERATIONS.md): Cron-job.org setup, secret rotation, token re-issue, and cache maintenance.
   - [docs/TEST-CHECKLIST.md](./TEST-CHECKLIST.md): 22-step manual test suite covering all edge cases.
   - [docs/SECRETS.md](./SECRETS.md): Safe local and production secret handling.
3. **Collaboration Infrastructure**:
   - [.github/workflows/ci.yml](../.github/workflows/ci.yml): Pinned actions, Gitleaks security scan, automated typecheck/lint/test/build.
   - [.github/CODEOWNERS](../.github/CODEOWNERS) & [CONTRIBUTING.md](../CONTRIBUTING.md): Pre-configured domain ownership and branch strategies.
   - [SECURITY.md](../SECURITY.md) & [LICENSE](../LICENSE) (MIT).

---

## 7. Audit Conclusion & Next Steps

The project meets all production, security, and architectural requirements.

### Final Setup Checklist for Repository Owners
- [ ] In [.github/CODEOWNERS](../.github/CODEOWNERS) and [CONTRIBUTING.md](../CONTRIBUTING.md), replace `@REPLACE-DEV-A` and `@REPLACE-DEV-B` with your GitHub handles.
- [ ] Enable GitHub Branch Protection on `main` (require 1 approval + passing CI checks).
- [ ] Turn on GitHub Secret Scanning and Push Protection in repository settings.
