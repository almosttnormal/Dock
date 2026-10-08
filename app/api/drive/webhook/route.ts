import { NextResponse } from "next/server";
import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { getDriveWatch } from "@/lib/bridge/sync-state";
import { processDriveChanges } from "@/lib/drive/changes";
import { logger } from "@/lib/log";

// Set maxDuration = 300 (or 60 on Hobby if build limits enforce)
export const maxDuration = 300;

export async function POST(req: Request) {
  const env = getEnv();

  // 1. Google Drive push notifications headers
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceState = req.headers.get("x-goog-resource-state");

  if (!channelId || !channelToken) {
    return new NextResponse("Missing Google Channel headers", { status: 400 });
  }

  // 2. Validate token header against our expected DRIVE_WEBHOOK_TOKEN
  if (channelToken !== env.DRIVE_WEBHOOK_TOKEN) {
    return new NextResponse("Unauthorized webhook token", { status: 401 });
  }

  // Check channel exists in our database
  const watch = await getDriveWatch(channelId);
  if (!watch) {
    // Unknown or expired channel, still ACK 200 so Google doesn't aggressively retry
    return new NextResponse("Channel not registered", { status: 200 });
  }

  // 3. Handle 'sync' handshake message from Google (sent when watch is first created)
  if (resourceState === "sync") {
    return new NextResponse("Sync acknowledged", { status: 200 });
  }

  // 4. ACK 200 immediately to Google, process changes asynchronously in after()
  const response = new NextResponse("Event received", { status: 200 });

  after(async () => {
    try {
      await processDriveChanges();
    } catch (err) {
      logger.error("Error processing Drive changes in webhook after()", { error: err });
    }
  });

  return response;
}
