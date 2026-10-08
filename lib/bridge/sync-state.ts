import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import type { Database, DriveSyncStateRow, DriveWatchRow } from "@/lib/supabase/types";

const SYNC_STATE_ID = "global_drive_sync";

/**
 * Gets the current Drive startPageToken / saved page token.
 */
export async function getDriveSyncToken(
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<string | null> {
  const { data, error } = await client
    .from("drive_sync_state")
    .select("page_token")
    .eq("id", SYNC_STATE_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get drive sync token: ${error.message}`);
  }

  return data?.page_token ?? null;
}

/**
 * Updates or sets the Drive page token.
 */
export async function setDriveSyncToken(
  pageToken: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<DriveSyncStateRow> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("drive_sync_state")
    .upsert(
      {
        id: SYNC_STATE_ID,
        page_token: pageToken,
        last_synced_at: now,
        updated_at: now,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update drive sync token: ${error?.message || "No data returned"}`);
  }

  return data;
}

/**
 * Saves a new active watch channel registration.
 */
export async function saveDriveWatch(
  watch: {
    channelId: string;
    resourceId?: string | null;
    token: string;
    expiration: string;
  },
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<DriveWatchRow> {
  const { data, error } = await client
    .from("drive_watches")
    .upsert(
      {
        channel_id: watch.channelId,
        resource_id: watch.resourceId ?? null,
        token: watch.token,
        expiration: watch.expiration,
      },
      { onConflict: "channel_id" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to save drive watch: ${error?.message || "No data returned"}`);
  }

  return data;
}

/**
 * Retrieves an active watch by Google channel UUID.
 */
export async function getDriveWatch(
  channelId: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<DriveWatchRow | null> {
  const { data, error } = await client
    .from("drive_watches")
    .select()
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get drive watch: ${error.message}`);
  }

  return data;
}

/**
 * Retrieves the latest registered active watch.
 */
export async function getLatestActiveWatch(
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<DriveWatchRow | null> {
  const { data, error } = await client
    .from("drive_watches")
    .select()
    .order("expiration", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get latest active watch: ${error.message}`);
  }

  return data;
}
