import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/client";
import type { Database, FileEventDirection, FileEventRow } from "@/lib/supabase/types";

export interface RecordFileEventParams {
  fileId: string;
  modifiedTime: string;
  version?: string;
  direction: FileEventDirection;
  discordMessageId?: string | null;
}

/**
 * Attempts to record a file event idempotently.
 * Returns the created row if newly processed, or null if it was already processed.
 */
export async function recordFileEventIdempotent(
  params: RecordFileEventParams,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<FileEventRow | null> {
  const version = params.version ?? params.modifiedTime;

  const { data, error } = await client
    .from("file_events")
    .insert({
      file_id: params.fileId,
      modified_time: params.modifiedTime,
      version,
      direction: params.direction,
      discord_message_id: params.discordMessageId ?? null,
    })
    .select()
    .single();

  if (error) {
    // 23505 is PostgreSQL unique violation code
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      return null;
    }
    throw new Error(`Failed to record file event: ${error.message}`);
  }

  return data;
}

/**
 * Deletes a recorded file event by ID (used for rollback if downstream Discord post fails).
 */
export async function deleteFileEvent(
  id: number,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<void> {
  const { error } = await client.from("file_events").delete().eq("id", id);
  if (error) {
    throw new Error(`Failed to delete file event ${id}: ${error.message}`);
  }
}

/**
 * Escapes LIKE wildcard characters (%, _, \) so they are treated as literal characters.
 */
export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/([\\%_])/g, "\\$1");
}

/**
 * Checks whether a file has any earlier events recorded in the context of a destination folder.
 * If mappedFolderId is provided, checks if an event exists whose version contains that mappedFolderId.
 * Used to distinguish "Added by" from "Updated by" per destination channel/folder.
 */
export async function hasPriorFileEvents(
  fileId: string,
  excludeEventId?: number,
  mappedFolderId?: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<boolean> {
  let query = client
    .from("file_events")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);

  if (excludeEventId !== undefined) {
    query = query.neq("id", excludeEventId);
  }

  if (mappedFolderId) {
    // version has the format `${modifiedTime}|${mappedFolderId}`
    // Escape LIKE special characters in mappedFolderId so '_' or '%' are matched literally
    const escapedFolderId = escapeLikePattern(mappedFolderId);
    query = query.like("version", `%|${escapedFolderId}`);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to check prior events for file ${fileId}: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

/**
 * Updates the discord_message_id on a recorded file event once posted.
 */
export async function updateFileEventDiscordMessage(
  id: number,
  discordMessageId: string,
  client: SupabaseClient<Database> = getSupabaseAdmin()
): Promise<void> {
  const { error } = await client
    .from("file_events")
    .update({ discord_message_id: discordMessageId })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update file event message id: ${error.message}`);
  }
}
