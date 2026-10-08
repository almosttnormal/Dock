import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { uploadStreamToDrive, uploadFromUrl } from "./upload";
import { createOrRenewDriveWatch, stopDriveWatch } from "./watch";
import type { drive_v3 } from "googleapis";

// Mock env
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    PUBLIC_BASE_URL: "https://bridge.example.com",
    DRIVE_WEBHOOK_TOKEN: "mock-webhook-token",
  }),
}));

// Mock sync-state
vi.mock("@/lib/bridge/sync-state", () => ({
  getDriveSyncToken: vi.fn().mockResolvedValue("existing-page-token"),
  setDriveSyncToken: vi.fn().mockResolvedValue(undefined),
  saveDriveWatch: vi.fn().mockResolvedValue(undefined),
}));

describe("Google Drive layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("uploadFromUrl", () => {
    it("wraps download + upload together re-creating the stream so consumed streams succeed on second attempt", async () => {
      let downloadAttempt = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        downloadAttempt++;
        // Create fresh ReadableStream for each download attempt
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`content-chunk-attempt-${downloadAttempt}`));
            controller.close();
          },
        });
        return {
          ok: true,
          body: stream,
        } as unknown as Response;
      });

      let uploadAttempt = 0;
      const chunksReceived: string[] = [];

      const mockCreate = vi.fn().mockImplementation(async (opts: { media: { body: Readable } }) => {
        uploadAttempt++;
        // Read stream to consume it
        const chunks: Buffer[] = [];
        for await (const chunk of opts.media.body) {
          chunks.push(Buffer.from(chunk));
        }
        const text = Buffer.concat(chunks).toString("utf-8");
        chunksReceived.push(text);

        // Fail attempt 1 after consuming stream
        if (uploadAttempt === 1) {
          const err = new Error("Drive Rate Limit 429") as Error & { status: number };
          err.status = 429;
          throw err;
        }

        return {
          data: {
            id: "drive-retry-file-999",
            name: "report.pdf",
            webViewLink: "https://drive.google.com/report.pdf",
            mimeType: "application/pdf",
            size: "2048",
          },
        };
      });

      const mockDrive = {
        files: {
          create: mockCreate,
        },
      } as unknown as drive_v3.Drive;

      const result = await uploadFromUrl(
        {
          filename: "report.pdf",
          mimeType: "application/pdf",
          folderId: "target-folder-123",
          url: "https://cdn.example.com/report.pdf",
        },
        mockDrive
      );

      // Verify fetch (download) was called twice (once per attempt)
      expect(downloadAttempt).toBe(2);
      // Verify files.create was called twice
      expect(uploadAttempt).toBe(2);
      // Verify both attempts received full, fresh content
      expect(chunksReceived[0]).toBe("content-chunk-attempt-1");
      expect(chunksReceived[1]).toBe("content-chunk-attempt-2");
      // Succeeded with full result
      expect(result.fileId).toBe("drive-retry-file-999");
    });
  });

  describe("uploadStreamToDrive", () => {
    it("sets appProperties.source = discord to prevent loops and streams content", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: {
          id: "drive-file-123",
          name: "contract.pdf",
          webViewLink: "https://drive.google.com/file/d/drive-file-123/view",
          mimeType: "application/pdf",
          size: "1024",
        },
      });

      const mockDrive = {
        files: {
          create: mockCreate,
        },
      } as unknown as drive_v3.Drive;

      const dummyStream = Readable.from(["file chunk 1", "file chunk 2"]);

      const result = await uploadStreamToDrive(
        {
          filename: "contract.pdf",
          mimeType: "application/pdf",
          folderId: "target-folder-abc",
          bodyStream: dummyStream,
        },
        mockDrive
      );

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];

      // CRITICAL LOOP BREAKER CHECK
      expect(callArgs.requestBody.appProperties).toEqual({ source: "discord" });
      expect(callArgs.requestBody.parents).toEqual(["target-folder-abc"]);
      expect(callArgs.requestBody.name).toBe("contract.pdf");
      expect(callArgs.media.mimeType).toBe("application/pdf");
      expect(callArgs.media.body).toBe(dummyStream);

      expect(result.fileId).toBe("drive-file-123");
      expect(result.webViewLink).toBe("https://drive.google.com/file/d/drive-file-123/view");
    });
  });

  describe("createOrRenewDriveWatch", () => {
    it("registers watch channel pointing to ${PUBLIC_BASE_URL}/api/drive/webhook", async () => {
      const mockWatch = vi.fn().mockResolvedValue({
        data: {
          resourceId: "google-resource-id-999",
          expiration: "1791331200000",
        },
      });

      const mockDrive = {
        changes: {
          getStartPageToken: vi.fn(),
          watch: mockWatch,
        },
      } as unknown as drive_v3.Drive;

      const res = await createOrRenewDriveWatch(mockDrive);

      expect(mockWatch).toHaveBeenCalledTimes(1);
      const watchArgs = mockWatch.mock.calls[0][0];

      expect(watchArgs.pageToken).toBe("existing-page-token");
      expect(watchArgs.requestBody.address).toBe("https://bridge.example.com/api/drive/webhook");
      expect(watchArgs.requestBody.token).toBe("mock-webhook-token");
      expect(watchArgs.requestBody.type).toBe("web_hook");

      expect(res.resourceId).toBe("google-resource-id-999");
    });
  });

  describe("stopDriveWatch", () => {
    it("calls channels.stop with channel id and resource id", async () => {
      const mockStop = vi.fn().mockResolvedValue({});
      const mockDrive = {
        channels: {
          stop: mockStop,
        },
      } as unknown as drive_v3.Drive;

      await stopDriveWatch("ch-1", "res-1", mockDrive);
      expect(mockStop).toHaveBeenCalledWith({
        requestBody: {
          id: "ch-1",
          resourceId: "res-1",
        },
      });
    });
  });
});
