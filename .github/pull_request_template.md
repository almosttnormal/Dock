## What Changed
<!-- Provide a concise summary of the changes introduced in this pull request -->

## Why
<!-- What problem does this PR solve or what feature does it enable? -->

## How Tested
<!-- Detail the manual and automated steps taken to verify these changes -->
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero warnings or errors
- [ ] `npm run test` passes all suites
- [ ] `npm run build` succeeds locally

## Database Migrations Included?
- [ ] No database changes
- [ ] Yes, new additive migration added in `supabase/migrations/`
  - [ ] Row Level Security (RLS) enabled on all new tables
  - [ ] Zero public policies added

## Environment Variables Added or Changed?
- [ ] No env changes
- [ ] Yes, updated `.env.example`, `lib/env.ts` (Zod schema), and documented in `docs/SECRETS.md`

## Security Checklist
- [ ] No secrets, real tokens, or personal identifiers committed
- [ ] Inbound endpoints verify cryptographic signatures or bearer tokens before reading payload
- [ ] 3-second Discord interaction latency SLA preserved (long tasks in `after()`)
- [ ] Compound idempotency `(file_id, modified_time, direction)` preserved
