import type { DiscordEmbed, DiscordComponent } from "./client";

export interface FormatEmbedParams {
  filename: string;
  fileId: string;
  mimeType?: string | null;
  sizeBytes?: string | number | null;
  modifiedTime: string;
  modifyingUserName?: string | null;
  isNew: boolean;
  hasThumbnail: boolean;
  webViewLink?: string | null;
  relativePath?: string | null;
}

export interface FormattedNotification {
  embed: DiscordEmbed;
  components: DiscordComponent[];
}

/**
 * Maps standard MIME types to concise, human-friendly labels.
 */
export function friendlyFileType(mimeType?: string | null): string {
  if (!mimeType) return "File";
  if (mimeType === "application/pdf") return "PDF Document";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("audio/")) return "Audio";
  if (mimeType === "application/vnd.google-apps.document") return "Google Doc";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "Google Sheet";
  if (mimeType === "application/vnd.google-apps.presentation") return "Google Slide";
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword")) return "Word Document";
  if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel")) return "Spreadsheet";
  if (mimeType.includes("presentationml") || mimeType.includes("ms-powerpoint")) return "Presentation";
  if (mimeType === "application/zip" || mimeType.includes("compressed") || mimeType.includes("tar")) return "Archive";
  if (mimeType.startsWith("text/")) return "Text Document";
  return mimeType;
}

/**
 * Formats size in bytes to human-readable string (KB, MB, GB).
 */
export function formatFileSize(bytes?: string | number | null): string {
  if (bytes === undefined || bytes === null) return "Unknown size";
  const num = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (Number.isNaN(num) || num < 0) return "Unknown size";
  if (num === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return `${parseFloat((num / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Builds rich embed and link button for Drive file notifications.
 * - Green (#57F287 / 0x57F287) + "Added by <name>" for new files (no prior file_events)
 * - Blurple (#5865F2 / 0x5865F2) + "Updated by <name>" for modified files
 * - Thumbnail attached as attachment://thumb.png if present
 * - Path field shown only for subfolders (omitted for root files)
 * - "Open in Drive" Link Button component
 */
export function formatDriveNotification(params: FormatEmbedParams): FormattedNotification {
  const {
    filename,
    fileId,
    mimeType,
    sizeBytes,
    modifiedTime,
    modifyingUserName,
    isNew,
    hasThumbnail,
    webViewLink,
    relativePath,
  } = params;

  const actor = modifyingUserName || "Someone";
  const actionLabel = isNew ? `Added by ${actor}` : `Updated by ${actor}`;
  const color = isNew ? 0x57f287 : 0x5865f2; // Green for new, blurple for updated
  const driveUrl = webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  // Show relative path only if file is inside a subfolder (omit for root level "/")
  if (relativePath && relativePath !== "/") {
    fields.push({
      name: "Path",
      value: `📂 \`${relativePath}\``,
      inline: true,
    });
  }

  fields.push(
    {
      name: "Type",
      value: friendlyFileType(mimeType),
      inline: true,
    },
    {
      name: "Size",
      value: formatFileSize(sizeBytes),
      inline: true,
    }
  );

  const embed: DiscordEmbed = {
    title: filename,
    url: driveUrl,
    color,
    timestamp: modifiedTime,
    author: {
      name: actionLabel,
    },
    fields,
    footer: {
      text: "Dock",
    },
  };

  if (hasThumbnail) {
    embed.thumbnail = {
      url: "attachment://thumb.png",
    };
  }

  // ActionRow (type 1) with Link Button (type 2, style 5)
  const components: DiscordComponent[] = [
    {
      type: 1, // ActionRow
      components: [
        {
          type: 2, // Button
          style: 5, // Link button
          label: "Open in Drive",
          url: driveUrl,
        },
      ],
    },
  ];

  return { embed, components };
}
