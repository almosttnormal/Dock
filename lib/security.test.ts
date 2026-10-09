import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment
let mockPollingOnly = false;
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    CRON_SECRET: "secure-cron-secret",
    DRIVE_WEBHOOK_TOKEN: "secure-drive-token",
    ALLOWED_USER_IDS: ["admin-user-1"],
    DISCORD_PUBLIC_KEY: "mock-public-key",
    get POLLING_ONLY() {
      return mockPollingOnly;
    },
  }),
}));

vi.mock("@/lib/discord/verify", () => ({
  verifyDiscordRequest: vi.fn(),
}));

vi.mock("@/lib/bridge/sync-state", () => ({
  getDriveWatch: vi.fn(),
  getLatestActiveWatch: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/drive/changes", () => ({
  processDriveChanges: vi.fn(),
}));

vi.mock("@/lib/bridge/folder-cache", () => ({
  cleanExpiredFolders: vi.fn().mockResolvedValue(2),
}));

vi.mock("@/lib/drive/watch", () => ({
  createOrRenewDriveWatch: vi.fn(),
  stopDriveWatch: vi.fn(),
}));

import { POST as pollHandler } from "@/app/api/drive/poll/route";
import { POST as webhookHandler } from "@/app/api/drive/webhook/route";
import { POST as interactionsHandler } from "@/app/api/discord/interactions/route";
import { GET as cronHandler } from "@/app/api/cron/renew-watches/route";
import { verifyDiscordRequest } from "@/lib/discord/verify";
import { cleanExpiredFolders } from "@/lib/bridge/folder-cache";
import { getDriveWatch } from "@/lib/bridge/sync-state";
import { processDriveChanges } from "@/lib/drive/changes";
import { createOrRenewDriveWatch } from "@/lib/drive/watch";

describe("Endpoint Security & Gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/api/drive/poll", () => {
    it("rejects requests without Bearer CRON_SECRET", async () => {
      const req = new Request("http://localhost/api/drive/poll", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-secret",
        },
      });

      const res = await pollHandler(req);
      expect(res.status).toBe(401);
      expect(processDriveChanges).not.toHaveBeenCalled();
    });

    it("accepts requests with valid Bearer CRON_SECRET", async () => {
      vi.mocked(processDriveChanges).mockResolvedValue({
        processedChanges: 5,
        announcedFiles: 1,
        skippedLoopFiles: 0,
        skippedUnmapped: 4,
        advancedPageToken: "new-token",
      });

      const req = new Request("http://localhost/api/drive/poll", {
        method: "POST",
        headers: {
          authorization: "Bearer secure-cron-secret",
        },
      });

      const res = await pollHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.result.announcedFiles).toBe(1);
    });
  });

  describe("/api/cron/renew-watches", () => {
    it("rejects unauthorized cron triggers", async () => {
      const req = new Request("http://localhost/api/cron/renew-watches", {
        method: "GET",
      });

      const res = await cronHandler(req);
      expect(res.status).toBe(401);
      expect(createOrRenewDriveWatch).not.toHaveBeenCalled();
    });

    it("authorizes valid cron call with Bearer CRON_SECRET", async () => {
      vi.mocked(createOrRenewDriveWatch).mockResolvedValue({
        channelId: "new-ch-id",
        resourceId: "new-res-id",
        expiration: "2026-10-14T00:00:00Z",
        pageToken: "token-abc",
      });

      const req = new Request("http://localhost/api/cron/renew-watches", {
        method: "GET",
        headers: {
          authorization: "Bearer secure-cron-secret",
        },
      });

      const res = await cronHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.watch.channelId).toBe("new-ch-id");
    });

    it("skips watch creation and calls processChanges and cleanExpiredFolders in POLLING_ONLY mode", async () => {
      mockPollingOnly = true;
      vi.mocked(processDriveChanges).mockResolvedValue({
        processedChanges: 2,
        announcedFiles: 1,
        skippedLoopFiles: 0,
        skippedUnmapped: 1,
        advancedPageToken: "token-new",
      });

      const req = new Request("http://localhost/api/cron/renew-watches", {
        method: "GET",
        headers: {
          authorization: "Bearer secure-cron-secret",
        },
      });

      try {
        const res = await cronHandler(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.pollingOnly).toBe(true);
        expect(json.evictedFolders).toBe(2);
        expect(processDriveChanges).toHaveBeenCalled();
        expect(cleanExpiredFolders).toHaveBeenCalled();
        expect(createOrRenewDriveWatch).not.toHaveBeenCalled();
      } finally {
        mockPollingOnly = false;
      }
    });
  });

  describe("/api/drive/webhook", () => {
    it("rejects mismatched X-Goog-Channel-Token", async () => {
      const req = new Request("http://localhost/api/drive/webhook", {
        method: "POST",
        headers: {
          "x-goog-channel-id": "ch-123",
          "x-goog-channel-token": "invalid-token",
        },
      });

      const res = await webhookHandler(req);
      expect(res.status).toBe(401);
    });

    it("handles Google sync handshake with 200 OK", async () => {
      vi.mocked(getDriveWatch).mockResolvedValue({
        channel_id: "ch-123",
        resource_id: "res-123",
        token: "secure-drive-token",
        expiration: "",
        created_at: "",
      });

      const req = new Request("http://localhost/api/drive/webhook", {
        method: "POST",
        headers: {
          "x-goog-channel-id": "ch-123",
          "x-goog-channel-token": "secure-drive-token",
          "x-goog-resource-state": "sync",
        },
      });

      const res = await webhookHandler(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("Sync acknowledged");
    });
  });

  describe("/api/discord/interactions", () => {
    it("rejects invalid request signatures with 401", async () => {
      vi.mocked(verifyDiscordRequest).mockResolvedValue({
        isValid: false,
        rawBody: "",
      });

      const req = new Request("http://localhost/api/discord/interactions", {
        method: "POST",
      });

      const res = await interactionsHandler(req);
      expect(res.status).toBe(401);
    });

    it("denies unauthorized users attempting /link", async () => {
      vi.mocked(verifyDiscordRequest).mockResolvedValue({
        isValid: true,
        rawBody: JSON.stringify({
          type: 2, // APPLICATION_COMMAND
          data: {
            name: "link",
            options: [{ name: "folder_id", value: "f-123" }],
          },
          user: { id: "unauthorized-user-99" },
          channel_id: "c-123",
        }),
      });

      const req = new Request("http://localhost/api/discord/interactions", {
        method: "POST",
      });

      const res = await interactionsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.content).toContain("not authorized");
      expect(json.data.flags).toBe(64); // Ephemeral
    });
  });
});
