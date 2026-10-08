import { createOrRenewDriveWatch } from "@/lib/drive/watch";
import { getDriveClient } from "@/lib/drive/client";

/**
 * Bootstraps Drive sync: gets the start page token and registers the initial watch channel.
 * Usage: npx tsx scripts/bootstrap-drive.ts
 */
async function main() {
  console.log("Bootstrapping Google Drive push notifications...");

  const drive = getDriveClient();
  const watch = await createOrRenewDriveWatch(drive);

  console.log("\n=======================================================");
  console.log("DRIVE SYNC BOOTSTRAPPED SUCCESSFULLY");
  console.log("=======================================================");
  console.log(`Page Token:   ${watch.pageToken}`);
  console.log(`Channel ID:   ${watch.channelId}`);
  console.log(`Resource ID:  ${watch.resourceId}`);
  console.log(`Expiration:   ${watch.expiration}`);
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
