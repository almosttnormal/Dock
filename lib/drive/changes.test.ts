import { describe, it, expect, vi, beforeEach } from "vitest";
import { processDriveChanges } from "./changes";
import type { drive_v3 } from "googleapis";
import type { DiscordRestClient } from "@/lib/discord/client";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    DEBOUNCE_SECONDS: 0,
  }),
}));

vi.mock("@/lib/bridge/channel-mapping", () => ({
  getAllChannelMappings: vi.fn(),
  getMappingsByFolderId: vi.fn(),
}));

vi.mock("@/lib/bridge/idempotency", () => ({
  recordFileEventIdempotent: vi.fn(),
  deleteFileEvent: vi.fn(),
  hasPriorFileEvents: vi.fn(),
}));

vi.mock("@/lib/bridge/folder-cache", () => ({
  getCachedFolder: vi.fn().mockResolvedValue(null),
  upsertCachedFolder: vi.fn().mockResolvedValue({}),
  evictCachedFolder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/bridge/sync-state", () => ({
  getDriveSyncToken: vi.fn(),
  setDriveSyncToken: vi.fn(),
}));

import { getAllChannelMappings } from "@/lib/bridge/channel-mapping";
import {
  recordFileEventIdempotent,
  deleteFileEvent,
  hasPriorFileEvents,
} from "@/lib/bridge/idempotency";
import { evictCachedFolder } from "@/lib/bridge/folder-cache";
import { getDriveSyncToken, setDriveSyncToken } from "@/lib/bridge/sync-state";

describe("processDriveChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllChannelMappings).mockResolvedValue([
      {
        channel_id: "chan-1",
        folder_id: "folder-target",
        folder_name: "Client Folder",
        linked_by: "user-1",
        created_at: "",
        updated_at: "",
      },
      {
        channel_id: "chan-2",
        folder_id: "folder-other",
        folder_name: "Other Client",
        linked_by: "user-1",
        created_at: "",
        updated_at: "",
      },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    });
  });

  it("skips changes originating from Discord to break loops (appProperties.source === 'discord')", async () => {
    vi.mocked(getDriveSyncToken).mockResolvedValue("token-1");

    const mockDrive = {
      changes: {
        list: vi.fn().mockResolvedValue({
          data: {
            newStartPageToken: "token-2",
            changes: [
              {
                fileId: "f-loop",
                file: {
                  id: "f-loop",
                  name: "uploaded-from-discord.png",
                  parents: ["folder-1"],
                  appProperties: { source: "discord" },
                },
              },
            ],
          },
        }),
      },
    } as unknown as drive_v3.Drive;

    const mockDiscord = {
      postMessage: vi.fn(),
    } as unknown as DiscordRestClient;

    const res = await processDriveChanges(mockDrive, mockDiscord);

    expect(res.skippedLoopFiles).toBe(1);
    expect(res.announcedFiles).toBe(0);
    expect(mockDiscord.postMessage).not.toHaveBeenCalled();
    expect(setDriveSyncToken).toHaveBeenCalledWith("token-2");
  });

  it("rolls back file_events row and does NOT advance page token if Discord post fails", async () => {
    vi.mocked(getDriveSyncToken).mockResolvedValue("token-start");
    vi.mocked(getAllChannelMappings).mockResolvedValue([
      {
        channel_id: "chan-1",
        folder_id: "folder-target",
        folder_name: "Client Folder",
        linked_by: "user-1",
        created_at: "",
        updated_at: "",
      },
    ]);

    vi.mocked(recordFileEventIdempotent).mockResolvedValue({
      id: 777,
      file_id: "file-xyz",
      modified_time: "2026-10-07T12:00:00Z",
      version: "2026-10-07T12:00:00Z",
      direction: "drive_to_discord",
      discord_message_id: null,
      created_at: "",
    });

    vi.mocked(hasPriorFileEvents).mockResolvedValue(false);

    const mockDrive = {
      changes: {
        list: vi.fn().mockResolvedValue({
          data: {
            newStartPageToken: "token-next",
            changes: [
              {
                fileId: "file-xyz",
                file: {
                  id: "file-xyz",
                  name: "brief.docx",
                  parents: ["folder-target"],
                  modifiedTime: "2026-10-07T12:00:00Z",
                  appProperties: {},
                },
              },
            ],
          },
        }),
      },
    } as unknown as drive_v3.Drive;

    const mockDiscord = {
      postMessage: vi.fn().mockRejectedValue(new Error("Discord Network Down")),
    } as unknown as DiscordRestClient;

    await expect(processDriveChanges(mockDrive, mockDiscord)).rejects.toThrow(
      /Aborting Drive change sync: Discord post failed/
    );

    // Verifies rollback: deleted file_events row
    expect(deleteFileEvent).toHaveBeenCalledWith(777);

    // Verifies page token was NOT advanced
    expect(setDriveSyncToken).not.toHaveBeenCalled();
  });

  it("evicts folder from cache on folder change event and does NOT announce folders", async () => {
    vi.mocked(getDriveSyncToken).mockResolvedValue("token-start");

    const mockDrive = {
      changes: {
        list: vi.fn().mockResolvedValue({
          data: {
            newStartPageToken: "token-done",
            changes: [
              {
                fileId: "folder-renamed",
                file: {
                  id: "folder-renamed",
                  name: "New Folder Name",
                  mimeType: "application/vnd.google-apps.folder",
                  parents: ["folder-target"],
                },
              },
            ],
          },
        }),
      },
    } as unknown as drive_v3.Drive;

    const mockDiscord = {
      postMessage: vi.fn(),
    } as unknown as DiscordRestClient;

    const res = await processDriveChanges(mockDrive, mockDiscord);

    expect(evictCachedFolder).toHaveBeenCalledWith("folder-renamed");
    expect(res.announcedFiles).toBe(0);
    expect(mockDiscord.postMessage).not.toHaveBeenCalled();
  });

  it("announces files in subfolders with relative path to the nearest mapped channel", async () => {
    vi.mocked(getDriveSyncToken).mockResolvedValue("token-start");

    const mockDrive = {
      changes: {
        list: vi.fn().mockResolvedValue({
          data: {
            newStartPageToken: "token-done",
            changes: [
              {
                fileId: "file-nested",
                file: {
                  id: "file-nested",
                  name: "nested-report.pdf",
                  mimeType: "application/pdf",
                  parents: ["subfolder-q1"],
                  modifiedTime: "2026-10-07T15:00:00Z",
                  appProperties: {},
                },
              },
            ],
          },
        }),
      },
      files: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: "subfolder-q1",
            name: "Q1 Reports",
            parents: ["folder-target"],
            trashed: false,
          },
        }),
      },
    } as unknown as drive_v3.Drive;

    vi.mocked(recordFileEventIdempotent).mockResolvedValue({
      id: 888,
      file_id: "file-nested",
      modified_time: "2026-10-07T15:00:00Z",
      version: "2026-10-07T15:00:00Z|folder-target",
      direction: "drive_to_discord",
      discord_message_id: null,
      created_at: "",
    });

    vi.mocked(hasPriorFileEvents).mockResolvedValue(false);

    const mockDiscord = {
      postMessage: vi.fn().mockResolvedValue({ id: "msg-nested" }),
    } as unknown as DiscordRestClient;

    const res = await processDriveChanges(mockDrive, mockDiscord);

    expect(res.announcedFiles).toBe(1);
    expect(mockDiscord.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "chan-1",
        embeds: [
          expect.objectContaining({
            title: "nested-report.pdf",
            fields: expect.arrayContaining([
              { name: "Path", value: "📂 `/Q1 Reports/`", inline: true },
            ]),
          }),
        ],
      })
    );
  });
});
