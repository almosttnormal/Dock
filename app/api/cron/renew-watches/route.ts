import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createOrRenewDriveWatch, stopDriveWatch } from "@/lib/drive/watch";
import { getLatestActiveWatch } from "@/lib/bridge/sync-state";
import { processDriveChanges } from "@/lib/drive/changes";
import { cleanExpiredFolders } from "@/lib/bridge/folder-cache";
import { logger } from "@/lib/log";

export async function GET(req: Request) {
  return handleRenewal(req);
}

export async function POST(req: Request) {
  return handleRenewal(req);
}

async function handleRenewal(req: Request) {
  const env = getEnv();

  // Strictly require Bearer CRON_SECRET (Vercel Cron sends Authorization: Bearer <CRON_SECRET>)
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    // If POLLING_ONLY mode is enabled, do NOT create or renew watch subscriptions.
    // Instead, process pending changes and evict expired folder-cache rows.
    if (env.POLLING_ONLY) {
      const changesResult = await processDriveChanges();
      const evictedCount = await cleanExpiredFolders();

      return NextResponse.json({
        success: true,
        pollingOnly: true,
        changes: changesResult,
        evictedFolders: evictedCount,
      });
    }

    const existingWatch = await getLatestActiveWatch();

    // 1. Create or renew the watch subscription
    const newWatch = await createOrRenewDriveWatch();

    // 2. Stop old watch if it exists and had a different channel ID
    if (existingWatch && existingWatch.channel_id !== newWatch.channelId && existingWatch.resource_id) {
      await stopDriveWatch(existingWatch.channel_id, existingWatch.resource_id);
    }

    return NextResponse.json({
      success: true,
      watch: {
        channelId: newWatch.channelId,
        resourceId: newWatch.resourceId,
        expiration: newWatch.expiration,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("Watch renewal failed", { error: err });
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
