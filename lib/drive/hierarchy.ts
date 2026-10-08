import type { drive_v3 } from "googleapis";
import { getCachedFolder, upsertCachedFolder } from "@/lib/bridge/folder-cache";
import type { ChannelMappingRow } from "@/lib/supabase/types";
import { logger } from "@/lib/log";

export interface ResolvedAncestor {
  mappedFolderId: string;
  channelId: string;
  relativePath: string; // e.g. "/" or "/2026 Campaigns/Briefs/"
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  isTrashed: boolean;
}

export interface ResolveAncestorParams {
  drive: drive_v3.Drive;
  fileParents: string[];
  mappings: ChannelMappingRow[];
  batchCache?: Map<string, FolderNode | null>;
}

const MAX_DEPTH = 10;
const MAX_PATH_LENGTH = 1024;

/**
 * Escapes Discord markdown special characters in folder names.
 * Escapes: * _ ~ ` | \ [ ] ( ) < >
 */
export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/([*_~`|\\\[\]()<>])/g, "\\$1");
}

/**
 * Truncates path in the middle with an ellipsis if it exceeds maxLength.
 */
export function truncatePathMiddle(path: string, maxLength: number = MAX_PATH_LENGTH): string {
  if (path.length <= maxLength) return path;
  const ellipsis = "/.../";
  const available = maxLength - ellipsis.length;
  const half = Math.floor(available / 2);
  const start = path.slice(0, half);
  const end = path.slice(path.length - (available - half));
  return `${start}${ellipsis}${end}`;
}

/**
 * Formats an array of ancestor folder names into a relative path.
 * e.g. ["SubA", "SubB"] => "/SubA/SubB/"
 * Root level => "/"
 */
export function formatRelativePath(segments: string[]): string {
  if (segments.length === 0) return "/";
  const escaped = segments.map((s) => escapeDiscordMarkdown(s.trim()));
  const rawPath = `/${escaped.join("/")}/`;
  return truncatePathMiddle(rawPath);
}

/**
 * Fetches folder metadata using the 3-tier lookup:
 * 1. In-batch memory cache (Map)
 * 2. Persistent Postgres cache (drive_folder_cache)
 * 3. Google Drive files.get API fallback
 *
 * Error handling:
 * - 403 / 404: Returns null (unmapped/inaccessible), does not throw.
 * - 429 / 5xx: Re-throws to trigger batch retry.
 */
async function getFolderNode(
  drive: drive_v3.Drive,
  folderId: string,
  batchCache?: Map<string, FolderNode | null>
): Promise<FolderNode | null> {
  // 1. Batch cache check
  if (batchCache && batchCache.has(folderId)) {
    return batchCache.get(folderId) ?? null;
  }

  // 2. Postgres database cache check
  try {
    const cached = await getCachedFolder(folderId);
    if (cached) {
      const node: FolderNode = {
        id: cached.folder_id,
        name: cached.name,
        parentId: cached.parent_id,
        isTrashed: cached.is_trashed,
      };
      batchCache?.set(folderId, node);
      return node;
    }
  } catch (err) {
    // If cache lookup encounters a transient DB error, proceed to Drive API
    logger.warn(`[Hierarchy] DB cache read error for folder ${folderId}:`, { error: err });
  }

  // 3. Google Drive API fetch
  try {
    const res = await drive.files.get({
      fileId: folderId,
      supportsAllDrives: true,
      fields: "id, name, parents, trashed",
    });

    const file = res.data;
    if (!file || !file.id || file.trashed) {
      batchCache?.set(folderId, null);
      return null;
    }

    const node: FolderNode = {
      id: file.id,
      name: file.name || "Untitled Folder",
      parentId: file.parents?.[0] ?? null,
      isTrashed: Boolean(file.trashed),
    };

    batchCache?.set(folderId, node);

    // Save to Postgres cache asynchronously in background
    upsertCachedFolder({
      folderId: node.id,
      name: node.name,
      parentId: node.parentId,
      isTrashed: node.isTrashed,
    }).catch((cacheErr) => {
      logger.warn(`[Hierarchy] DB cache write error for folder ${folderId}:`, { error: cacheErr });
    });

    return node;
  } catch (err: unknown) {
    const status = (err as { status?: number; code?: number })?.status ||
      (err as { status?: number; code?: number })?.code;

    // 403 (Permission denied) or 404 (Not found) -> non-blocking, treat as unmapped
    if (status === 403 || status === 404) {
      logger.warn(`[Hierarchy] Folder ${folderId} returned ${status}, marking unmapped`, { folderId, status });
      batchCache?.set(folderId, null);
      return null;
    }

    // 429 (Rate limited) or 5xx (Server error) -> throw to retry the batch
    throw err;
  }
}

/**
 * Resolves a file's ancestor chain to the NEAREST mapped folder.
 * Returns the mappedFolderId, the matching channelId, and the relativePath.
 * Stops at the first (nearest) mapped ancestor found when walking upwards.
 */
export async function resolveMappedAncestor(
  params: ResolveAncestorParams
): Promise<ResolvedAncestor | null> {
  const { drive, fileParents, mappings, batchCache } = params;

  if (!fileParents || fileParents.length === 0 || mappings.length === 0) {
    return null;
  }

  // Build quick map of folder_id -> channel_id
  const mappingMap = new Map<string, string>();
  for (const m of mappings) {
    mappingMap.set(m.folder_id, m.channel_id);
  }

  // FAST PATH: Immediate parent match (depth 0, 0 API calls)
  for (const parentId of fileParents) {
    const channelId = mappingMap.get(parentId);
    if (channelId) {
      return {
        mappedFolderId: parentId,
        channelId,
        relativePath: "/",
      };
    }
  }

  // SLOW PATH: Walk upward from each parent until hitting the nearest mapped folder
  for (const initialParentId of fileParents) {
    const visited = new Set<string>();
    const pathSegments: string[] = []; // Subfolder names in top-down order
    let currentId: string | null = initialParentId;
    let depth = 0;

    while (currentId && depth < MAX_DEPTH) {
      // Check if this ancestor is mapped
      const mappedChannelId = mappingMap.get(currentId);
      if (mappedChannelId) {
        // Nearest mapped ancestor found!
        return {
          mappedFolderId: currentId,
          channelId: mappedChannelId,
          relativePath: formatRelativePath(pathSegments),
        };
      }

      // Cycle protection
      if (visited.has(currentId)) {
        logger.warn(`[Hierarchy] Cycle detected at folder ${currentId}`, { folderId: currentId });
        break;
      }
      visited.add(currentId);
      depth++;

      const node: FolderNode | null = await getFolderNode(drive, currentId, batchCache);
      if (!node || node.isTrashed) {
        break;
      }

      pathSegments.unshift(node.name);
      currentId = node.parentId;
    }
  }

  return null;
}
