import { DiscordRestClient } from "@/lib/discord/client";
import { getChannelMapping } from "@/lib/bridge/channel-mapping";
import { recordFileEventIdempotent } from "@/lib/bridge/idempotency";
import { uploadFromUrl } from "@/lib/drive/upload";
import { getDriveClient } from "@/lib/drive/client";
import { logger } from "@/lib/log";

export interface AttachmentItem {
  id: string;
  filename: string;
  size: number;
  url: string;
  content_type?: string;
}

export interface SaveToDriveJobParams {
  applicationId: string;
  interactionToken: string;
  channelId: string;
  targetMessageId: string;
  attachments: AttachmentItem[];
}

/**
 * Downloads Discord attachment as stream and pipes directly to Google Drive.
 * Tracks idempotency, updates file_events, sends ephemeral confirmation to invoker,
 * and posts a public reply to the target message in the channel with the Drive links.
 */
export async function executeSaveToDriveJob(
  params: SaveToDriveJobParams,
  discordClient = new DiscordRestClient(),
  drive = getDriveClient()
): Promise<void> {
  const { applicationId, interactionToken, channelId, targetMessageId, attachments } = params;

  try {
    // 1. Verify channel mapping exists
    const mapping = await getChannelMapping(channelId);
    if (!mapping) {
      await discordClient.editOriginalInteractionResponse({
        applicationId,
        interactionToken,
        content: "❌ This channel is not linked to a Google Drive folder. An admin must run `/link` first.",
      });
      return;
    }

    if (!attachments || attachments.length === 0) {
      await discordClient.editOriginalInteractionResponse({
        applicationId,
        interactionToken,
        content: "⚠️ The selected message has no attachments to save.",
      });
      return;
    }

    const uploadedLinks: Array<{ filename: string; link: string }> = [];

    // 2. Stream each attachment to Drive
    for (const att of attachments) {
      // Stream directly from Discord CDN with unified retry (re-fetches stream on retry)
      const upload = await uploadFromUrl(
        {
          filename: att.filename,
          mimeType: att.content_type || "application/octet-stream",
          folderId: mapping.folder_id,
          url: att.url,
        },
        drive
      );

      const modifiedTimeIso = new Date().toISOString();

      // Record in file_events idempotency table
      const eventRow = await recordFileEventIdempotent({
        fileId: upload.fileId,
        modifiedTime: modifiedTimeIso,
        direction: "discord_to_drive",
        discordMessageId: targetMessageId,
      });

      const driveUrl =
        upload.webViewLink || `https://drive.google.com/file/d/${upload.fileId}/view`;

      uploadedLinks.push({
        filename: att.filename,
        link: driveUrl,
      });

      // Keep eventRow reference for rollback if later post fails
      if (eventRow) {
        // saved
      }
    }

    // 3. Post a PUBLIC reply to the target message in the channel with the Drive links
    const publicContent =
      `📁 **Saved to Drive** (${mapping.folder_name ? `Folder: ${mapping.folder_name}` : "Mapped folder"}):\n` +
      uploadedLinks.map((item) => `• [${item.filename}](${item.link})`).join("\n");

    try {
      await discordClient.postMessage({
        channelId,
        content: publicContent,
        messageReference: { message_id: targetMessageId },
      });
    } catch (postErr) {
      logger.error("Failed to post public reply in channel", { channelId, error: postErr });
      // Let ephemeral confirmation still inform user
    }

    // 4. Update the EPHEMERAL response to the invoker
    const ephemeralContent =
      `✅ Successfully saved ${uploadedLinks.length} attachment(s) to Google Drive:\n` +
      uploadedLinks.map((item) => `• [${item.filename}](${item.link})`).join("\n");

    await discordClient.editOriginalInteractionResponse({
      applicationId,
      interactionToken,
      content: ephemeralContent,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("Save to Drive failed", { error: err });

    await discordClient.editOriginalInteractionResponse({
      applicationId,
      interactionToken,
      content: `❌ Error saving attachments to Drive: ${errorMsg}`,
    });
  }
}
