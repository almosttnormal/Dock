import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import type { Database, ChannelMappingRow } from "@/lib/supabase/types";

export interface SetChannelMappingParams {
  channelId: string;
  folderId: string;
  folderName?: string | null;
  linkedBy: string;
}

/**
 * Upserts a channel to folder mapping in Supabase.
 */
export async function setChannelMapping(
  params: SetChannelMappingParams,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<ChannelMappingRow> {
  const { data, error } = await client
    .from("channel_mappings")
    .upsert(
      {
        channel_id: params.channelId,
        folder_id: params.folderId,
        folder_name: params.folderName ?? null,
        linked_by: params.linkedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel_id" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to set channel mapping: ${error?.message || "No data returned"}`);
  }

  return data;
}

/**
 * Removes a channel mapping by Discord channel ID.
 */
export async function removeChannelMapping(
  channelId: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<boolean> {
  const { error, count } = await client
    .from("channel_mappings")
    .delete({ count: "exact" })
    .eq("channel_id", channelId);

  if (error) {
    throw new Error(`Failed to remove channel mapping: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

/**
 * Retrieves the mapping for a Discord channel ID.
 */
export async function getChannelMapping(
  channelId: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<ChannelMappingRow | null> {
  const { data, error } = await client
    .from("channel_mappings")
    .select()
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get channel mapping: ${error.message}`);
  }

  return data;
}

/**
 * Finds all channel mappings mapped to a specific Google Drive folder ID.
 */
export async function getMappingsByFolderId(
  folderId: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<ChannelMappingRow[]> {
  const { data, error } = await client
    .from("channel_mappings")
    .select()
    .eq("folder_id", folderId);

  if (error) {
    throw new Error(`Failed to query mappings by folderId: ${error.message}`);
  }

  return data || [];
}

/**
 * Retrieves all registered channel mappings.
 */
export async function getAllChannelMappings(
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<ChannelMappingRow[]> {
  const { data, error } = await client.from("channel_mappings").select();

  if (error) {
    throw new Error(`Failed to query all channel mappings: ${error.message}`);
  }

  return data || [];
}
