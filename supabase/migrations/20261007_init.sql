-- 20261007_init.sql
-- Drive <-> Discord Bridge database schema
-- Security: Service role access only, RLS enabled on all tables, no public policies.

-- 1. Mappings between Discord channels and Google Drive folders
CREATE TABLE IF NOT EXISTS channel_mappings (
  channel_id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  folder_name TEXT,
  linked_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_channel_mappings_folder_id ON channel_mappings(folder_id);

-- 2. Drive sync state tracking page tokens for incremental change detection
CREATE TABLE IF NOT EXISTS drive_sync_state (
  id TEXT PRIMARY KEY DEFAULT 'global_drive_sync',
  page_token TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. Drive webhook push notification registrations (changes.watch)
CREATE TABLE IF NOT EXISTS drive_watches (
  channel_id TEXT PRIMARY KEY, -- Google notification channel UUID
  resource_id TEXT,            -- Google resource ID returned on watch registration
  token TEXT NOT NULL,          -- Verification token sent in X-Goog-Channel-Token header
  expiration TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_drive_watches_expiration ON drive_watches(expiration);

-- 4. Idempotency and audit log for processed file events
-- Unique key strictly (file_id, modified_time, direction) to prevent duplicate posts
CREATE TABLE IF NOT EXISTS file_events (
  id BIGSERIAL PRIMARY KEY,
  file_id TEXT NOT NULL,
  modified_time TIMESTAMPTZ NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('drive_to_discord', 'discord_to_drive')),
  discord_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_file_events_idempotency UNIQUE (file_id, modified_time, direction)
);

CREATE INDEX IF NOT EXISTS idx_file_events_file_id ON file_events(file_id);
CREATE INDEX IF NOT EXISTS idx_file_events_lookup ON file_events(file_id, modified_time, direction);

-- ----------------------------------------------------
-- Row Level Security (RLS)
-- Enabled on all tables with ZERO public access policies.
-- Only accessible via Supabase service_role key.
-- ----------------------------------------------------
ALTER TABLE channel_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_events ENABLE ROW LEVEL SECURITY;
