import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import type { Database, DriveFolderCacheRow } from "@/lib/supabase/types";

export interface UpsertFolderCacheParams {
  folderId: string;
  name: string;
  parentId?: string | null;
  isTrashed?: boolean;
  ttlSeconds?: number;
}

/**
 * Retrieves a cached folder by ID if it has not expired.
 * Returns null if not found or expired.
 */
export async function getCachedFolder(
  folderId: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<DriveFolderCacheRow | null> {
  const nowIso = new Date().toISOString();

  const { data, error } = await client
    .from("drive_folder_cache")
    .select()
    .eq("folder_id", folderId)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get cached folder ${folderId}: ${error.message}`);
  }

  return data;
}

/**
 * Upserts a folder record in drive_folder_cache with an updated expiration.
 * Default TTL is 24 hours (86,400 seconds).
 */
export async function upsertCachedFolder(
  params: UpsertFolderCacheParams,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<DriveFolderCacheRow> {
  const ttl = params.ttlSeconds ?? 86400;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const updatedAt = now.toISOString();

  const { data, error } = await client
    .from("drive_folder_cache")
    .upsert(
      {
        folder_id: params.folderId,
        name: params.name,
        parent_id: params.parentId ?? null,
        is_trashed: params.isTrashed ?? false,
        updated_at: updatedAt,
        expires_at: expiresAt,
      },
      { onConflict: "folder_id" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert cached folder ${params.folderId}: ${error?.message}`);
  }

  return data;
}

/**
 * Evicts a specific folder from the cache (e.g. on folder rename, move, or deletion).
 */
export async function evictCachedFolder(
  folderId: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<void> {
  const { error } = await client
    .from("drive_folder_cache")
    .delete()
    .eq("folder_id", folderId);

  if (error) {
    throw new Error(`Failed to evict cached folder ${folderId}: ${error.message}`);
  }
}

/**
 * Removes all expired folder cache records from the database.
 */
export async function cleanExpiredFolders(
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<number> {
  const nowIso = new Date().toISOString();

  const { data, error } = await client
    .from("drive_folder_cache")
    .delete()
    .lt("expires_at", nowIso)
    .select("folder_id");

  if (error) {
    throw new Error(`Failed to clean expired folders: ${error.message}`);
  }

  return data?.length ?? 0;
}
