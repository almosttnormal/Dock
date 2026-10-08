# Verification Checklist: P0–P6 Phases

Follow this checklist to validate each phase of bridge development:

### Phase 0: Scaffold & Setup
- [ ] Next.js 15.1+ App Router configured.
- [ ] Strict TypeScript mode (`strict: true`) with zero compilation errors (`tsc --noEmit`).
- [ ] Zod environment schema (`lib/env.ts`) parses and throws on boot if missing secrets.
- [ ] Root landing page (`app/page.tsx`) is static and leaks zero sensitive config/status.
- [ ] Test runner (e.g. `vitest`) configured and baseline test passes.

### Phase 1: Database Layer
- [ ] Tables created with Row Level Security (RLS) enabled on all tables.
- [ ] Service-role client restricted to server-side code only (`lib/supabase/client.ts`).
- [ ] Compound idempotency constraint `(entity_id, modified_time, direction)` created in migration.
- [ ] Unit tests for CRUD, idempotency violation handling, and rollback functions.

### Phase 2: Origin Integration Layer
- [ ] Client SDK uses refresh token auth or service credentials without hardcoded secrets.
- [ ] Streaming upload/download implemented using Node.js stream piping (no full-file buffering).
- [ ] Loop prevention metadata stamped on created objects (e.g. `appProperties.source`).
- [ ] Diagnostic smoke test script created.

### Phase 3: Destination Webhooks & Interactions
- [ ] Cryptographic signature verification runs on raw request body BEFORE parsing.
- [ ] Initial ACK sent within SLA (e.g. Discord 3-second limit via deferred message).
- [ ] Long-running work executed in `after()`.
- [ ] Ephemeral responses to caller + public channel responses to users.

### Phase 4: Downstream Event Sync & Notifications
- [ ] Inbound push webhook validates verification tokens.
- [ ] Filter restricts sync to explicitly mapped channels/folders.
- [ ] Loop prevention rejects self-originating updates.
- [ ] Downstream failures rollback idempotency records and freeze sync tokens.

### Phase 5: Watch Lifecycle & Cron
- [ ] Push subscription registration and renewal routines implemented.
- [ ] Daily cron endpoint protected by Bearer secret.
- [ ] Protected manual poll route available for reconciliation catch-up.

### Phase 6: Hardening & Documentation
- [ ] End-to-end security test suite validates gating on all inbound endpoints.
- [ ] Typecheck, linter, tests, and production build all pass without warnings.
- [ ] README includes setup guides for credentials, migrations, and operational commands.
