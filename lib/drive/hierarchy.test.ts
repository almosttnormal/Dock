import { describe, it, expect, vi, beforeEach } from "vitest";
import type { drive_v3 } from "googleapis";
import {
  resolveMappedAncestor,
  escapeDiscordMarkdown,
  truncatePathMiddle,
  formatRelativePath,
} from "./hierarchy";
import * as folderCache from "@/lib/bridge/folder-cache";
import type { ChannelMappingRow } from "@/lib/supabase/types";

vi.mock("@/lib/bridge/folder-cache", () => ({
  getCachedFolder: vi.fn(),
  upsertCachedFolder: vi.fn().mockResolvedValue({}),
  evictCachedFolder: vi.fn(),
}));

describe("lib/drive/hierarchy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("path string formatters", () => {
    it("escapeDiscordMarkdown escapes markdown characters", () => {
      expect(escapeDiscordMarkdown("Draft *v1* _final_ ~old~ `code` |test| \\slash\\")).toBe(
        "Draft \\*v1\\* \\_final\\_ \\~old\\~ \\`code\\` \\|test\\| \\\\slash\\\\"
      );
    });

    it("escapeDiscordMarkdown renders links [click](http://x) and mentions <#123> inert", () => {
      expect(escapeDiscordMarkdown("[click](http://x)")).toBe("\\[click\\]\\(http://x\\)");
      expect(escapeDiscordMarkdown("<#123>")).toBe("\\<#123\\>");
    });

    it("truncatePathMiddle preserves short paths", () => {
      const path = "/2026 Campaigns/Briefs/";
      expect(truncatePathMiddle(path, 100)).toBe(path);
    });

    it("truncatePathMiddle truncates long paths in the middle with /.../", () => {
      const longPath = "/A".repeat(600) + "/";
      const truncated = truncatePathMiddle(longPath, 100);
      expect(truncated.length).toBeLessThanOrEqual(100);
      expect(truncated).toContain("/.../");
    });

    it("formatRelativePath returns / for root level", () => {
      expect(formatRelativePath([])).toBe("/");
    });

    it("formatRelativePath builds clean escaped paths", () => {
      expect(formatRelativePath(["Campaigns *2026*", "Briefs"])).toBe(
        "/Campaigns \\*2026\\*/Briefs/"
      );
    });
  });

  describe("resolveMappedAncestor", () => {
    const mockMappings: ChannelMappingRow[] = [
      {
        channel_id: "chan-client-a",
        folder_id: "folder-client-a",
        folder_name: "Client A",
        linked_by: "user-1",
        created_at: "",
        updated_at: "",
      },
      {
        channel_id: "chan-sub-special",
        folder_id: "folder-sub-special",
        folder_name: "Special Subfolder",
        linked_by: "user-1",
        created_at: "",
        updated_at: "",
      },
    ];

    it("Fast path: returns immediate parent match without API calls", async () => {
      const mockDrive = {
        files: { get: vi.fn() },
      } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["folder-client-a"],
        mappings: mockMappings,
      });

      expect(res).toEqual({
        mappedFolderId: "folder-client-a",
        channelId: "chan-client-a",
        relativePath: "/",
      });
      expect(mockDrive.files.get).not.toHaveBeenCalled();
    });

    it("Resolves 3-level deep nested folder and constructs relative path", async () => {
      // Structure: folder-client-a -> sub-1 ("2026") -> sub-2 ("Campaigns") -> sub-3 ("Briefs") -> file
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      const mockGet = vi.fn().mockImplementation(({ fileId }: { fileId: string }) => {
        if (fileId === "sub-3") {
          return Promise.resolve({
            data: { id: "sub-3", name: "Briefs", parents: ["sub-2"], trashed: false },
          });
        }
        if (fileId === "sub-2") {
          return Promise.resolve({
            data: { id: "sub-2", name: "Campaigns", parents: ["sub-1"], trashed: false },
          });
        }
        if (fileId === "sub-1") {
          return Promise.resolve({
            data: { id: "sub-1", name: "2026", parents: ["folder-client-a"], trashed: false },
          });
        }
        if (fileId === "folder-client-a") {
          return Promise.resolve({
            data: { id: "folder-client-a", name: "Client A", parents: ["root"], trashed: false },
          });
        }
        return Promise.reject(new Error("Unknown ID"));
      });

      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["sub-3"],
        mappings: mockMappings,
      });

      expect(res).toEqual({
        mappedFolderId: "folder-client-a",
        channelId: "chan-client-a",
        relativePath: "/2026/Campaigns/Briefs/",
      });
      expect(folderCache.upsertCachedFolder).toHaveBeenCalled();
    });

    it("Nested mappings: stops at the FIRST (nearest) mapped ancestor", async () => {
      // Structure: folder-client-a -> folder-sub-special -> sub-deep -> file
      // Both folder-client-a and folder-sub-special are in mockMappings!
      // Nearest ancestor is folder-sub-special.
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      const mockGet = vi.fn().mockImplementation(({ fileId }: { fileId: string }) => {
        if (fileId === "sub-deep") {
          return Promise.resolve({
            data: { id: "sub-deep", name: "Deep", parents: ["folder-sub-special"], trashed: false },
          });
        }
        if (fileId === "folder-sub-special") {
          return Promise.resolve({
            data: { id: "folder-sub-special", name: "Special Subfolder", parents: ["folder-client-a"], trashed: false },
          });
        }
        return Promise.reject(new Error("Unknown ID"));
      });

      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["sub-deep"],
        mappings: mockMappings,
      });

      expect(res).toEqual({
        mappedFolderId: "folder-sub-special",
        channelId: "chan-sub-special",
        relativePath: "/Deep/",
      });
      // Should NOT have traversed above folder-sub-special to folder-client-a
      expect(mockGet).not.toHaveBeenCalledWith(expect.objectContaining({ fileId: "folder-client-a" }));
    });

    it("Unmapped tree returns null when no ancestor matches mappings", async () => {
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      const mockGet = vi.fn().mockResolvedValue({
        data: { id: "other-folder", name: "Personal", parents: [], trashed: false },
      });
      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["other-folder"],
        mappings: mockMappings,
      });

      expect(res).toBeNull();
    });

    it("Cycle protection: detects cyclic parent relationships and aborts cleanly", async () => {
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      // Cycle: cycle-1 -> cycle-2 -> cycle-1
      const mockGet = vi.fn().mockImplementation(({ fileId }: { fileId: string }) => {
        if (fileId === "cycle-1") {
          return Promise.resolve({
            data: { id: "cycle-1", name: "Cycle 1", parents: ["cycle-2"], trashed: false },
          });
        }
        if (fileId === "cycle-2") {
          return Promise.resolve({
            data: { id: "cycle-2", name: "Cycle 2", parents: ["cycle-1"], trashed: false },
          });
        }
        return Promise.reject(new Error("Unknown ID"));
      });

      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["cycle-1"],
        mappings: mockMappings,
      });

      expect(res).toBeNull();
    });

    it("Depth cap: halts traversal at depth 10", async () => {
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      let callCount = 0;
      const mockGet = vi.fn().mockImplementation(({ fileId }: { fileId: string }) => {
        callCount++;
        return Promise.resolve({
          data: { id: fileId, name: `Level ${callCount}`, parents: [`level-${callCount + 1}`], trashed: false },
        });
      });

      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["level-1"],
        mappings: mockMappings,
      });

      expect(res).toBeNull();
      expect(callCount).toBe(10); // Capped at MAX_DEPTH = 10
    });

    it("Error handling: 403 / 404 does NOT throw and treats branch as unmapped", async () => {
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      const err404 = new Error("File not found");
      (err404 as unknown as { status: number }).status = 404;

      const mockGet = vi.fn().mockRejectedValue(err404);
      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["missing-folder"],
        mappings: mockMappings,
      });

      expect(res).toBeNull();
    });

    it("Error handling: 429 / 5xx THROWS so batch can retry", async () => {
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      const err429 = new Error("Rate limit exceeded");
      (err429 as unknown as { status: number }).status = 429;

      const mockGet = vi.fn().mockRejectedValue(err429);
      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      await expect(
        resolveMappedAncestor({
          drive: mockDrive,
          fileParents: ["rate-limited-folder"],
          mappings: mockMappings,
        })
      ).rejects.toThrow("Rate limit exceeded");
    });

    it("In-batch memoization: sibling files sharing same folder cause only 1 API lookup", async () => {
      vi.mocked(folderCache.getCachedFolder).mockResolvedValue(null);

      const mockGet = vi.fn().mockResolvedValue({
        data: { id: "shared-sub", name: "Assets", parents: ["folder-client-a"], trashed: false },
      });
      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const sharedBatchCache = new Map();

      // First sibling file resolution
      const res1 = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["shared-sub"],
        mappings: mockMappings,
        batchCache: sharedBatchCache,
      });

      // Second sibling file resolution
      const res2 = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["shared-sub"],
        mappings: mockMappings,
        batchCache: sharedBatchCache,
      });

      expect(res1?.relativePath).toBe("/Assets/");
      expect(res2?.relativePath).toBe("/Assets/");
      // files.get should only be invoked for "shared-sub" once; "folder-client-a" is recognized immediately as mapped
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it("Cache hit in DB avoids Drive API call entirely", async () => {
      vi.mocked(folderCache.getCachedFolder).mockImplementation(async (folderId: string) => {
        if (folderId === "cached-sub") {
          return {
            folder_id: "cached-sub",
            name: "CachedAssets",
            parent_id: "folder-client-a",
            is_trashed: false,
            updated_at: "",
            expires_at: "2026-10-08T00:00:00Z",
          };
        }
        return null;
      });

      const mockGet = vi.fn().mockResolvedValue({
        data: { id: "folder-client-a", name: "Client A", parents: [], trashed: false },
      });
      const mockDrive = { files: { get: mockGet } } as unknown as drive_v3.Drive;

      const res = await resolveMappedAncestor({
        drive: mockDrive,
        fileParents: ["cached-sub"],
        mappings: mockMappings,
      });

      expect(res?.relativePath).toBe("/CachedAssets/");
      // "cached-sub" should not be requested via files.get
      expect(mockGet).not.toHaveBeenCalledWith(expect.objectContaining({ fileId: "cached-sub" }));
    });
  });
});
