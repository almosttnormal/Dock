import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSaveToDriveJob } from "./save-to-drive";
import type { DiscordRestClient } from "./client";
import type { drive_v3 } from "googleapis";

vi.mock("@/lib/bridge/channel-mapping", () => ({
  getChannelMapping: vi.fn(),
}));

vi.mock("@/lib/bridge/idempotency", () => ({
  recordFileEventIdempotent: vi.fn(),
  deleteFileEvent: vi.fn(),
}));

vi.mock("@/lib/drive/upload", () => ({
  uploadFromUrl: vi.fn(),
  uploadStreamToDrive: vi.fn(),
}));

import { getChannelMapping } from "@/lib/bridge/channel-mapping";
import { recordFileEventIdempotent } from "@/lib/bridge/idempotency";
import { uploadFromUrl } from "@/lib/drive/upload";

describe("executeSaveToDriveJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("notifies user when channel is not linked", async () => {
    vi.mocked(getChannelMapping).mockResolvedValue(null);

    const mockDiscord = {
      editOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    } as unknown as DiscordRestClient;

    await executeSaveToDriveJob(
      {
        applicationId: "app-1",
        interactionToken: "tok-1",
        channelId: "c-1",
        targetMessageId: "msg-1",
        attachments: [{ id: "a1", filename: "test.pdf", size: 100, url: "https://discord.gg/test.pdf" }],
      },
      mockDiscord,
      {} as drive_v3.Drive
    );

    expect(mockDiscord.editOriginalInteractionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("not linked to a Google Drive folder"),
      })
    );
  });

  it("handles empty attachments gracefully", async () => {
    vi.mocked(getChannelMapping).mockResolvedValue({
      channel_id: "c-1",
      folder_id: "f-1",
      folder_name: "Client A",
      linked_by: "u-1",
      created_at: "",
      updated_at: "",
    });

    const mockDiscord = {
      editOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    } as unknown as DiscordRestClient;

    await executeSaveToDriveJob(
      {
        applicationId: "app-1",
        interactionToken: "tok-1",
        channelId: "c-1",
        targetMessageId: "msg-1",
        attachments: [],
      },
      mockDiscord,
      {} as drive_v3.Drive
    );

    expect(mockDiscord.editOriginalInteractionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("no attachments to save"),
      })
    );
  });

  it("streams attachments to Drive, records idempotency, and posts public + ephemeral confirmations", async () => {
    vi.mocked(getChannelMapping).mockResolvedValue({
      channel_id: "c-1",
      folder_id: "f-1",
      folder_name: "Folder Alpha",
      linked_by: "u-1",
      created_at: "",
      updated_at: "",
    });

    // Mock fetch for attachment download
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from("dummy-attachment-data")));
        controller.close();
      },
    });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      body: mockStream,
    } as unknown as Response);

    vi.mocked(uploadFromUrl).mockResolvedValue({
      fileId: "drive-file-abc",
      name: "design.png",
      webViewLink: "https://drive.google.com/design.png",
    });

    vi.mocked(recordFileEventIdempotent).mockResolvedValue({
      id: 10,
      file_id: "drive-file-abc",
      modified_time: "2026-10-07T12:00:00Z",
      version: "2026-10-07T12:00:00Z",
      direction: "discord_to_drive",
      discord_message_id: "msg-1",
      created_at: "",
    });

    const mockDiscord = {
      editOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn().mockResolvedValue({ id: "public-msg-1" }),
    } as unknown as DiscordRestClient;

    await executeSaveToDriveJob(
      {
        applicationId: "app-1",
        interactionToken: "tok-1",
        channelId: "c-1",
        targetMessageId: "msg-1",
        attachments: [
          {
            id: "att-1",
            filename: "design.png",
            size: 1024,
            url: "https://cdn.discordapp.com/attachments/design.png",
            content_type: "image/png",
          },
        ],
      },
      mockDiscord,
      {} as drive_v3.Drive
    );

    expect(uploadFromUrl).toHaveBeenCalledTimes(1);
    expect(uploadFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "design.png",
        url: "https://cdn.discordapp.com/attachments/design.png",
        folderId: "f-1",
      }),
      expect.anything()
    );
    expect(recordFileEventIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "drive-file-abc",
        direction: "discord_to_drive",
        discordMessageId: "msg-1",
      })
    );

    // Public message to channel
    expect(mockDiscord.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "c-1",
        content: expect.stringContaining("Saved to Drive"),
        messageReference: { message_id: "msg-1" },
      })
    );

    // Ephemeral response to invoker
    expect(mockDiscord.editOriginalInteractionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Successfully saved 1 attachment(s)"),
      })
    );
  });
});
