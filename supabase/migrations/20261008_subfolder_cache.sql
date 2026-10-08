-- 20261008_subfolder_cache.sql
-- Additive migration: Subfolder ancestor cache & versioned file event idempotency
-- Security: Service role access only, RLS enabled, zero public policies.

-- 1. Create drive_folder_cache for caching folder lineage and metadata with TTL
CREATE TABLE IF NOT EXISTS drive_folder_cache (
  folder_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT, -- nullable for Drive roots
  is_trashed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_drive_folder_cache_expires_at 
  ON drive_folder_cache (expires_at);

-- Enable RLS with zero public policies (service role access only)
ALTER TABLE drive_folder_cache ENABLE ROW LEVEL SECURITY;

-- 2. Additive update to file_events:
-- Add version column to support compound keys including destination folder (e.g. `${modifiedTime}|${mappedFolderId}`)
ALTER TABLE file_events ADD COLUMN IF NOT EXISTS version TEXT;

-- Backfill existing rows with modified_time formatted as ISO text
UPDATE file_events SET version = modified_time::text WHERE version IS NULL;

-- Make version NOT NULL now that it is backfilled
ALTER TABLE file_events ALTER COLUMN version SET NOT NULL;

-- Drop old unique constraint on (file_id, modified_time, direction)
ALTER TABLE file_events DROP CONSTRAINT IF EXISTS uq_file_events_idempotency;

-- Create new unique constraint on (file_id, version, direction)
ALTER TABLE file_events ADD CONSTRAINT uq_file_events_idempotency UNIQUE (file_id, version, direction);

-- Add index for lookup by file_id, version, direction
CREATE INDEX IF NOT EXISTS idx_file_events_version_lookup ON file_events(file_id, version, direction);
