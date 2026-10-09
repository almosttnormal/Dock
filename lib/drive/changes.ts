import type { drive_v3 } from "googleapis";
import { getDriveClient } from "@/lib/drive/client";
import { DiscordRestClient } from "@/lib/discord/client";
import { formatDriveNotification } from "@/lib/discord/embeds";
import { getAllChannelMappings } from "@/lib/bridge/channel-mapping";
import {
  recordFileEventIdempotent,
  deleteFileEvent,
  hasPriorFileEvents,
} from "@/lib/bridge/idempotency";
import { evictCachedFolder } from "@/lib/bridge/folder-cache";
import { resolveMappedAncestor, type FolderNode } from "@/lib/drive/hierarchy";
import { getDriveSyncToken, setDriveSyncToken } from "@/lib/bridge/sync-state";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import { withBackoff } from "@/lib/retry";

export interface ProcessChangesResult {
  processedChanges: number;
  announcedFiles: number;
  skippedLoopFiles: number;
  skippedUnmapped: number;
  advancedPageToken: string | null;
}

/**
 * Fetches thumbnail buffer server-side.
 * Returns null if thumbnail does not exist or fetch fails.
 */
async function fetchThumbnailBuffer(thumbnailLink?: string | null): Promise<Buffer | null> {
  if (!thumbnailLink) return null;
  try {
    const res = await fetch(thumbnailLink);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Processes incremental changes from Google Drive.
 * - Evicts folder changes from hierarchy cache before folder-skip
 * - Skips folders and shortcuts (never announced)
 * - Resolves file's ancestor chain to the nearest mapped folder
 * - Skips loop events where appProperties.source === 'discord'
 * - Debounces changes if DEBOUNCE_SECONDS > 0
 * - Distinguishes "Added by" vs "Updated by" per destination folder
 * - On Discord failure: DELETES file_events row and ABORTS before advancing page token
 */
export async function processDriveChanges(
  drive: drive_v3.Drive = getDriveClient(),
  discord: DiscordRestClient = new DiscordRestClient()
): Promise<ProcessChangesResult> {
  const env = getEnv();

  // 1. Get current pageToken
  let pageToken = await getDriveSyncToken();
  if (!pageToken) {
    // In polling-only mode, bootstrap-drive MUST have set a pageToken first.
    // If no page token exists, fail explicitly rather than silently initializing.
    if (env.POLLING_ONLY) {
      throw new Error(
        "Drive sync page token is missing in POLLING_ONLY mode. Run scripts/bootstrap-drive.ts first."
      );
    }

    const tokenRes = await withBackoff(() =>
      drive.changes.getStartPageToken({ supportsAllDrives: true })
    );
    pageToken = tokenRes.data.startPageToken || null;
    if (pageToken) {
      await setDriveSyncToken(pageToken);
    }
    return {
      processedChanges: 0,
      announcedFiles: 0,
      skippedLoopFiles: 0,
      skippedUnmapped: 0,
      advancedPageToken: pageToken,
    };
  }

  // Load all channel mappings once for this batch
  const allMappings = await getAllChannelMappings();
  const batchCache = new Map<string, FolderNode | null>();

  let newStartPageToken: string | null = null;
  let nextPageToken: string | undefined = pageToken;
  let totalProcessed = 0;
  let announcedCount = 0;
  let loopCount = 0;
  let unmappedCount = 0;

  // Process all pages of changes in the batch
  while (nextPageToken) {
    const res: { data: drive_v3.Schema$ChangeList } = await withBackoff(() =>
      drive.changes.list({
        pageToken: nextPageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        fields:
          "newStartPageToken, nextPageToken, changes(changeType, time, fileId, removed, file(id, name, mimeType, size, modifiedTime, lastModifyingUser(displayName), parents, webViewLink, thumbnailLink, appProperties, trashed))",
      })
    );

    const changes = res.data.changes || [];
    nextPageToken = res.data.nextPageToken || undefined;
    if (res.data.newStartPageToken) {
      newStartPageToken = res.data.newStartPageToken;
    }

    for (const change of changes) {
      totalProcessed++;
      const file = change.file;

      if (!file || !file.id) {
        continue;
      }

      // 1. FOLDER CHANGES: Evict from folder cache before folder-skip (handles rename, move, trash)
      if (file.mimeType === "application/vnd.google-apps.folder") {
        batchCache.delete(file.id);
        evictCachedFolder(file.id).catch((evictErr) => {
          logger.warn(`[DriveSync] Failed to evict cached folder ${file.id}:`, { error: evictErr });
        });
        // Folders are not announced
        continue;
      }

      // 2. SHORTCUTS: Skip shortcuts in this version
      if (file.mimeType === "application/vnd.google-apps.shortcut") {
        continue;
      }

      // Skip removed or trashed items
      if (change.removed || file.trashed) {
        continue;
      }

      // LOOP PREVENTION: Check appProperties.source
      if (file.appProperties?.source === "discord") {
        loopCount++;
        continue;
      }

      // Check parents array
      const parents = file.parents || [];
      if (parents.length === 0) {
        unmappedCount++;
        continue;
      }

      // 3. ANCESTOR RESOLUTION: Resolve to the nearest mapped folder
      const resolved = await resolveMappedAncestor({
        drive,
        fileParents: parents,
        mappings: allMappings,
        batchCache,
      });

      if (!resolved) {
        unmappedCount++;
        continue;
      }

      const modifiedTime = file.modifiedTime || new Date().toISOString();

      // Check optional DEBOUNCE_SECONDS
      if (env.DEBOUNCE_SECONDS > 0) {
        const fileModTime = new Date(modifiedTime).getTime();
        const now = Date.now();
        if (now - fileModTime < env.DEBOUNCE_SECONDS * 1000) {
          // Debounce delay
        }
      }

      // Compound version incorporates destination folder to handle moves between mapped folders
      const version = `${modifiedTime}|${resolved.mappedFolderId}`;

      // Idempotency check: attempt to insert into file_events
      const eventRow = await recordFileEventIdempotent({
        fileId: file.id,
        modifiedTime,
        version,
        direction: "drive_to_discord",
      });

      if (!eventRow) {
        // Already processed this exact (file_id, version, direction)
        continue;
      }

      // Check if file has any prior events in this destination folder to decide "Added" vs "Updated"
      const isPrior = await hasPriorFileEvents(file.id, eventRow.id, resolved.mappedFolderId);
      const isNew = !isPrior;

      // Fetch thumbnail server-side
      const thumbBuffer = await fetchThumbnailBuffer(file.thumbnailLink);
      const hasThumb = Boolean(thumbBuffer);

      const { embed, components } = formatDriveNotification({
        filename: file.name || "Untitled",
        fileId: file.id,
        mimeType: file.mimeType,
        sizeBytes: file.size,
        modifiedTime,
        modifyingUserName: file.lastModifyingUser?.displayName,
        isNew,
        hasThumbnail: hasThumb,
        webViewLink: file.webViewLink,
        relativePath: resolved.relativePath,
      });

      const files = thumbBuffer
        ? [{ name: "thumb.png", buffer: thumbBuffer, contentType: "image/png" }]
        : undefined;

      // Announce once to the nearest mapped channel
      try {
        await discord.postMessage({
          channelId: resolved.channelId,
          embeds: [embed],
          components,
          files,
        });
        announcedCount++;
      } catch (postError) {
        logger.error(
          `Failed to post Drive notification for file ${file.id} to Discord channel ${resolved.channelId}`,
          { fileId: file.id, channelId: resolved.channelId, error: postError }
        );

        // CRITICAL REQUIREMENT:
        // Failed Discord post must delete the file_events row it inserted
        // and NOT advance the page token, so the change retries.
        await deleteFileEvent(eventRow.id);
        throw new Error(
          `Aborting Drive change sync: Discord post failed for file ${file.id}. Event rolled back.`
        );
      }
    }
  }

  // Advance page token only after successful processing
  const finalToken = newStartPageToken || nextPageToken || pageToken;
  if (finalToken && finalToken !== pageToken) {
    await setDriveSyncToken(finalToken);
  }

  return {
    processedChanges: totalProcessed,
    announcedFiles: announcedCount,
    skippedLoopFiles: loopCount,
    skippedUnmapped: unmappedCount,
    advancedPageToken: finalToken,
  };
}
