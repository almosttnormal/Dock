import { createOrRenewDriveWatch } from "@/lib/drive/watch";
import { getDriveClient } from "@/lib/drive/client";
import { getEnv } from "@/lib/env";
import { getDriveSyncToken, setDriveSyncToken } from "@/lib/bridge/sync-state";

/**
 * Bootstraps Drive sync: gets the start page token and registers the initial watch channel,
 * or in POLLING_ONLY mode, only fetches and stores the start page token without registering a watch channel.
 * Usage: npx tsx scripts/bootstrap-drive.ts
 */
export async function bootstrapDrive() {
  const env = getEnv();
  const drive = getDriveClient();

  if (env.POLLING_ONLY) {
    console.log("Polling-only mode is enabled (POLLING_ONLY=true). Push watch creation skipped.");
    console.log("Fetching and storing start page token...");

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

    console.log("\n=======================================================");
    console.log("DRIVE SYNC BOOTSTRAPPED SUCCESSFULLY (POLLING ONLY)");
    console.log("=======================================================");
    console.log(`Page Token:   ${pageToken}`);
    console.log("Push Watch:   SKIPPED (Polling Mode)");
    console.log("=======================================================\n");
    return { pageToken, pollingOnly: true };
  }

  console.log("Bootstrapping Google Drive push notifications...");

  const watch = await createOrRenewDriveWatch(drive);

  console.log("\n=======================================================");
  console.log("DRIVE SYNC BOOTSTRAPPED SUCCESSFULLY");
  console.log("=======================================================");
  console.log(`Page Token:   ${watch.pageToken}`);
  console.log(`Channel ID:   ${watch.channelId}`);
  console.log(`Resource ID:  ${watch.resourceId}`);
  console.log(`Expiration:   ${watch.expiration}`);
  console.log("=======================================================\n");
  return { ...watch, pollingOnly: false };
}

async function main() {
  await bootstrapDrive();
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
