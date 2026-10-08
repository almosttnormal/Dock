import { getDriveClient } from "@/lib/drive/client";

/**
 * Diagnostic smoke test for Google Drive API credentials, owner identity, and folder access.
 * Usage: npx tsx scripts/smoke-drive.ts [optionalFolderId]
 */
async function main() {
  const folderId = process.argv[2];

  console.log("Checking Google Drive API connection & credentials...");
  const drive = getDriveClient();

  // 1. Check About / User info
  const about = await drive.about.get({
    fields: "user, storageQuota",
  });

  console.log("\n=======================================================");
  console.log("GOOGLE DRIVE CONNECTION: OK");
  console.log("=======================================================");
  console.log(`User:         ${about.data.user?.displayName} (${about.data.user?.emailAddress})`);
  console.log(`Permission ID:${about.data.user?.permissionId}`);
  console.log("=======================================================");

  // 2. If a folderId was provided, verify folder metadata and permissions
  if (folderId) {
    console.log(`\nVerifying folder access for ID: ${folderId} ...`);
    const folder = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType, capabilities, trashed",
      supportsAllDrives: true,
    });

    if (folder.data.mimeType !== "application/vnd.google-apps.folder") {
      console.warn(`WARNING: Item ${folderId} is not a folder! mimeType=${folder.data.mimeType}`);
    } else {
      console.log(`Folder Name:  ${folder.data.name}`);
      console.log(`Can Add Children: ${folder.data.capabilities?.canAddChildren}`);
      console.log(`Trashed:      ${folder.data.trashed}`);
    }
  }

  // 3. Verify startPageToken retrieval
  const token = await drive.changes.getStartPageToken({ supportsAllDrives: true });
  console.log(`Start Page Token reachable: ${token.data.startPageToken ? "YES" : "NO"}`);
  console.log("Smoke check completed successfully.\n");
}

main().catch((err) => {
  console.error("Smoke check failed:", err);
  process.exit(1);
});
