# Contributing to Dock

Welcome! This guide outlines the development workflow, branch strategy, review requirements, and ownership areas for collaborating on Dock (Google Drive <-> Discord Bridge).

---

## 1. Team Ownership Areas

To prevent merge conflicts and coordination overhead, ownership is divided into clear primary domains:

| Domain | Primary Owner | Secondary Reviewer | Scope / Files |
| :--- | :--- | :--- | :--- |
| **Discord Interactions & UI** | `@REPLACE-DEV-A` | `@REPLACE-DEV-B` | `lib/discord/*`, `app/api/discord/*`, `scripts/register-commands.ts` |
| **Drive Sync & Storage** | `@REPLACE-DEV-B` | `@REPLACE-DEV-A` | `lib/drive/*`, `app/api/drive/*`, `app/api/cron/*`, `scripts/bootstrap-drive.ts` |
| **Database & Common Bridge** | Shared | Both | `lib/bridge/*`, `lib/supabase/*`, `supabase/migrations/*`, `lib/env.ts` |

---

## 2. Branch & PR Strategy

- **Protected Main Branch**: Pushes directly to `main` are strictly forbidden. All changes must land via Pull Request.
- **Branch Naming Conventions**:
  - `feat/<short-description>`: New features or capabilities.
  - `fix/<short-description>`: Bug fixes and error recovery patches.
  - `chore/<short-description>`: Dependency updates, CI workflows, documentation.
- **Small, Focused PRs**: Keep PRs under ~300 lines of changes whenever possible.
- **Mandatory Review**: Every PR requires at least **1 approving review** from the other developer before merging.

---

## 3. Pre-Flight Command Chain

Before opening a pull request, run the complete verification chain locally:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

If any step fails, fix the issue locally before pushing to GitHub.

---

## 4. Additive-Only Database Migrations

In production, Supabase migrations run sequentially.

1. **NEVER modify or delete an existing migration file** in `supabase/migrations/` that has already been pushed to `main`.
2. To modify schema, add a new timestamped file:
   ```
   supabase/migrations/YYYYMMDD_short_description.sql
   ```
3. Always ensure Row Level Security (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`) is enabled on every new table.
4. Never add public policies without explicit architectural alignment.
