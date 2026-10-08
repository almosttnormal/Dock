# Project rules
- Stack: Next.js App Router (15.1+ for `after`), TypeScript strict, Supabase, googleapis, discord-interactions, zod. Node 24.
- No discord.js and no worker process. Discord is called via plain fetch (REST v10).
- All secrets come from env via lib/env.ts (zod). Never hardcode or log secrets, tokens, or full request bodies.
- Supabase: service role key server-side only. RLS enabled on every table, no public policies.
- Every inbound endpoint verifies its signature/token/bearer BEFORE parsing or acting.
- Handlers ACK fast and do work in `after()`. Everything must be idempotent.
- Uploads to Drive must set appProperties.source = "discord" so our own writes are skipped on the Drive -> Discord path.
- Download Discord attachments immediately (CDN URLs expire); stream, never buffer whole files.
- Do NOT invent API fields or endpoints. If unsure about a Google Drive v3 or Discord v10 field, check the official docs before writing code.
- Small modules, no dead code. No new dependencies beyond the list above without stating why and asking first.
- After each task: run typecheck + lint + tests, then summarize changes, deviations, and open risks.

# Multi-developer collaboration rules
- Never edit a teammate's in-flight files without prior alignment. Check CONTRIBUTING.md for domain ownership.
- Rebase on main before opening a pull request; never merge main into feature branches.
- Never commit .env, credentials, or token files. All local test keys live strictly in .env.local.
