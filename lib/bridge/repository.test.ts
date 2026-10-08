import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  setChannelMapping,
  removeChannelMapping,
  getChannelMapping,
  getMappingsByFolderId,
} from "./channel-mapping";
import {
  recordFileEventIdempotent,
  deleteFileEvent,
  hasPriorFileEvents,
} from "./idempotency";
import {
  getCachedFolder,
  upsertCachedFolder,
  evictCachedFolder,
  cleanExpiredFolders,
} from "./folder-cache";
import {
  getDriveSyncToken,
  setDriveSyncToken,
  saveDriveWatch,
  getDriveWatch,
} from "./sync-state";

describe("Database repository layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("channel-mapping", () => {
    it("setChannelMapping calls upsert on channel_mappings", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          channel_id: "c1",
          folder_id: "f1",
          folder_name: "Folder 1",
          linked_by: "u1",
          created_at: "2026-10-07T00:00:00Z",
          updated_at: "2026-10-07T00:00:00Z",
        },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ upsert: mockUpsert });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const result = await setChannelMapping(
        {
          channelId: "c1",
          folderId: "f1",
          folderName: "Folder 1",
          linkedBy: "u1",
        },
        client
      );

      expect(mockFrom).toHaveBeenCalledWith("channel_mappings");
      expect(mockUpsert).toHaveBeenCalled();
      expect(result.channel_id).toBe("c1");
      expect(result.folder_id).toBe("f1");
    });

    it("getChannelMapping retrieves mapping by channel_id", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: { channel_id: "c1", folder_id: "f1" },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const result = await getChannelMapping("c1", client);
      expect(result?.folder_id).toBe("f1");
    });

    it("removeChannelMapping returns true when row is deleted", async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null, count: 1 });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const result = await removeChannelMapping("c1", client);
      expect(result).toBe(true);
    });

    it("getMappingsByFolderId returns matching rows", async () => {
      const mockEq = vi.fn().mockResolvedValue({
        data: [{ channel_id: "c1", folder_id: "f1" }],
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const result = await getMappingsByFolderId("f1", client);
      expect(result).toHaveLength(1);
      expect(result[0].channel_id).toBe("c1");
    });
  });

  describe("idempotency", () => {
    it("recordFileEventIdempotent returns row on successful insert", async () => {
      const row = {
        id: 1,
        file_id: "file-123",
        modified_time: "2026-10-07T12:00:00Z",
        direction: "drive_to_discord",
        discord_message_id: null,
        created_at: "2026-10-07T12:00:00Z",
      };
      const mockSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await recordFileEventIdempotent(
        {
          fileId: "file-123",
          modifiedTime: "2026-10-07T12:00:00Z",
          direction: "drive_to_discord",
        },
        client
      );

      expect(res).toEqual(row);
    });

    it("recordFileEventIdempotent returns null on duplicate key error (23505)", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await recordFileEventIdempotent(
        {
          fileId: "file-123",
          modifiedTime: "2026-10-07T12:00:00Z",
          direction: "drive_to_discord",
        },
        client
      );

      expect(res).toBeNull();
    });

    it("deleteFileEvent calls delete for given event id", async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      await expect(deleteFileEvent(42, client)).resolves.not.toThrow();
      expect(mockEq).toHaveBeenCalledWith("id", 42);
    });

    it("hasPriorFileEvents returns true when previous rows exist", async () => {
      const mockEq = vi.fn().mockResolvedValue({ count: 2, error: null });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await hasPriorFileEvents("file-123", undefined, undefined, client);
      expect(res).toBe(true);
    });

    it("recordFileEventIdempotent uses custom version if provided", async () => {
      const row = {
        id: 2,
        file_id: "file-123",
        modified_time: "2026-10-07T12:00:00Z",
        version: "2026-10-07T12:00:00Z|folder-abc",
        direction: "drive_to_discord",
        discord_message_id: null,
        created_at: "2026-10-07T12:00:00Z",
      };
      const mockSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await recordFileEventIdempotent(
        {
          fileId: "file-123",
          modifiedTime: "2026-10-07T12:00:00Z",
          version: "2026-10-07T12:00:00Z|folder-abc",
          direction: "drive_to_discord",
        },
        client
      );

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "2026-10-07T12:00:00Z|folder-abc",
        })
      );
      expect(res).toEqual(row);
    });

    it("hasPriorFileEvents filters by mappedFolderId when supplied", async () => {
      const mockLike = vi.fn().mockResolvedValue({ count: 1, error: null });
      const mockEq = vi.fn().mockReturnValue({ like: mockLike });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await hasPriorFileEvents("file-123", undefined, "folder-xyz", client);
      expect(mockLike).toHaveBeenCalledWith("version", "%|folder-xyz");
      expect(res).toBe(true);
    });

    it("hasPriorFileEvents escapes LIKE wildcards in folder ID with _ and -", async () => {
      const mockLike = vi.fn().mockImplementation((_column: string, pattern: string) => {
        // In SQL LIKE, with escaped pattern \%\|folder\\_a\-b, only literal "folder_a-b" matches
        // It does NOT match "folder-a-b" or "folderXa-b"
        if (pattern === "%|folder\\_a-b") {
          return Promise.resolve({ count: 1, error: null });
        }
        return Promise.resolve({ count: 0, error: null });
      });
      const mockEq = vi.fn().mockReturnValue({ like: mockLike });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      // 1. Folder ID containing underscore and hyphen
      const resTarget = await hasPriorFileEvents("file-123", undefined, "folder_a-b", client);
      expect(mockLike).toHaveBeenCalledWith("version", "%|folder\\_a-b");
      expect(resTarget).toBe(true);

      // 2. Different folder ID with hyphen instead of underscore ("folder-a-b") produces different escaped pattern
      const resDifferent = await hasPriorFileEvents("file-123", undefined, "folder-a-b", client);
      expect(mockLike).toHaveBeenCalledWith("version", "%|folder-a-b");
      expect(resDifferent).toBe(false);
    });
  });

  describe("folder-cache", () => {
    it("getCachedFolder returns unexpired folder record", async () => {
      const folderRecord = {
        folder_id: "f-sub",
        name: "Subfolder",
        parent_id: "f-root",
        is_trashed: false,
        updated_at: "2026-10-07T00:00:00Z",
        expires_at: "2026-10-08T00:00:00Z",
      };

      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: folderRecord, error: null });
      const mockGt = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq = vi.fn().mockReturnValue({ gt: mockGt });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await getCachedFolder("f-sub", client);
      expect(mockFrom).toHaveBeenCalledWith("drive_folder_cache");
      expect(mockEq).toHaveBeenCalledWith("folder_id", "f-sub");
      expect(res).toEqual(folderRecord);
    });

    it("upsertCachedFolder saves folder with TTL", async () => {
      const folderRecord = {
        folder_id: "f-sub",
        name: "Subfolder",
        parent_id: "f-root",
        is_trashed: false,
        updated_at: "2026-10-07T00:00:00Z",
        expires_at: "2026-10-08T00:00:00Z",
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: folderRecord, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ upsert: mockUpsert });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await upsertCachedFolder(
        {
          folderId: "f-sub",
          name: "Subfolder",
          parentId: "f-root",
        },
        client
      );

      expect(mockFrom).toHaveBeenCalledWith("drive_folder_cache");
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_id: "f-sub",
          name: "Subfolder",
          parent_id: "f-root",
        }),
        { onConflict: "folder_id" }
      );
      expect(res).toEqual(folderRecord);
    });

    it("evictCachedFolder deletes folder row", async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      await expect(evictCachedFolder("f-sub", client)).resolves.not.toThrow();
      expect(mockFrom).toHaveBeenCalledWith("drive_folder_cache");
      expect(mockEq).toHaveBeenCalledWith("folder_id", "f-sub");
    });

    it("cleanExpiredFolders removes expired rows", async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: [{ folder_id: "f-old-1" }, { folder_id: "f-old-2" }],
        error: null,
      });
      const mockLt = vi.fn().mockReturnValue({ select: mockSelect });
      const mockDelete = vi.fn().mockReturnValue({ lt: mockLt });
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const count = await cleanExpiredFolders(client);
      expect(mockDelete).toHaveBeenCalled();
      expect(mockLt).toHaveBeenCalled();
      expect(count).toBe(2);
    });
  });

  describe("sync-state", () => {
    it("getDriveSyncToken retrieves token from drive_sync_state", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: { page_token: "token_123" },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const token = await getDriveSyncToken(client);
      expect(token).toBe("token_123");
    });

    it("setDriveSyncToken upserts global sync row", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: "global_drive_sync", page_token: "token_456" },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ upsert: mockUpsert });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const res = await setDriveSyncToken("token_456", client);
      expect(res.page_token).toBe("token_456");
    });

    it("saveDriveWatch upserts a watch registration", async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          channel_id: "uuid-1",
          resource_id: "res-1",
          token: "secret",
          expiration: "2026-10-08T00:00:00Z",
        },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ upsert: mockUpsert });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const watch = await saveDriveWatch(
        {
          channelId: "uuid-1",
          resourceId: "res-1",
          token: "secret",
          expiration: "2026-10-08T00:00:00Z",
        },
        client
      );

      expect(watch.channel_id).toBe("uuid-1");
    });

    it("getDriveWatch finds watch by channelId", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: { channel_id: "uuid-1", token: "secret" },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      const client = { from: mockFrom } as unknown as SupabaseClient<Database>;

      const watch = await getDriveWatch("uuid-1", client);
      expect(watch?.token).toBe("secret");
    });
  });
});
