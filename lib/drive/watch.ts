import crypto from "node:crypto";
import type { drive_v3 } from "googleapis";
import { getDriveClient } from "./client";
import { getEnv } from "@/lib/env";
import { saveDriveWatch, setDriveSyncToken, getDriveSyncToken } from "@/lib/bridge/sync-state";
import { logger } from "@/lib/log";
import { withBackoff } from "@/lib/retry";

export interface CreateWatchResult {
  channelId: string;
  resourceId: string | null;
  expiration: string;
  pageToken: string;
}

/**
 * Ensures a valid start page token exists and sets up a changes.watch push subscription.
 * Webhook address is strictly ${PUBLIC_BASE_URL}/api/drive/webhook
 */
export async function createOrRenewDriveWatch(
  drive: drive_v3.Drive = getDriveClient()
): Promise<CreateWatchResult> {
  const env = getEnv();

  // 1. Get or generate startPageToken
  let pageToken = await getDriveSyncToken();
  if (!pageToken) {
    const tokenRes = await drive.changes.getStartPageToken({
      supportsAllDrives: true,
    });
    if (!tokenRes.data.startPageToken) {
      throw new Error("Failed to get Google Drive start page token");
    }
    pageToken = tokenRes.data.startPageToken;
    await setDriveSyncToken(pageToken);
  }

  // 2. Set up watch channel
  const channelId = crypto.randomUUID();
  const webhookUrl = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/drive/webhook`;

  const watchRes = await withBackoff(() =>
    drive.changes.watch({
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      requestBody: {
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: env.DRIVE_WEBHOOK_TOKEN,
      },
    })
  );

  const { resourceId, expiration } = watchRes.data;
  if (!resourceId) {
    throw new Error("Drive changes.watch did not return a resourceId");
  }

  // Expiration timestamp from Google (usually unix milliseconds string or date)
  const expirationIso = expiration
    ? new Date(parseInt(expiration, 10)).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await saveDriveWatch({
    channelId,
    resourceId,
    token: env.DRIVE_WEBHOOK_TOKEN,
    expiration: expirationIso,
  });

  return {
    channelId,
    resourceId,
    expiration: expirationIso,
    pageToken,
  };
}

/**
 * Stops an active watch channel if requested.
 */
export async function stopDriveWatch(
  channelId: string,
  resourceId: string,
  drive: drive_v3.Drive = getDriveClient()
): Promise<void> {
  try {
    await withBackoff(() =>
      drive.channels.stop({
        requestBody: {
          id: channelId,
          resourceId,
        },
      })
    );
  } catch (err) {
    // If channel is already expired/stopped Google may throw 404; ignore
    logger.warn(`Drive channels.stop warning for channel ${channelId}`, { channelId, error: err });
  }
}
