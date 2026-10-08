import { describe, it, expect } from "vitest";
import { formatDriveNotification, formatFileSize } from "./embeds";

describe("embeds formatter", () => {
  it("formats file sizes accurately", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1048576)).toBe("1 MB");
    expect(formatFileSize("5242880")).toBe("5 MB");
    expect(formatFileSize(null)).toBe("Unknown size");
  });

  it("formats new file notification with green color (#57F287) and 'Added by <name>'", () => {
    const { embed, components } = formatDriveNotification({
      filename: "proposal.pdf",
      fileId: "file-99",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      modifiedTime: "2026-10-07T12:00:00Z",
      modifyingUserName: "Alice Cooper",
      isNew: true,
      hasThumbnail: true,
      webViewLink: "https://drive.google.com/file/d/file-99/view",
    });

    expect(embed.title).toBe("proposal.pdf");
    expect(embed.color).toBe(0x57f287); // Green
    expect(embed.author?.name).toBe("Added by Alice Cooper");
    expect(embed.thumbnail?.url).toBe("attachment://thumb.png");
    expect(embed.fields).toEqual([
      { name: "Type", value: "PDF Document", inline: true },
      { name: "Size", value: "2 KB", inline: true },
    ]);

    // Action row with link button
    expect(components).toHaveLength(1);
    expect(components[0].components?.[0]).toEqual({
      type: 2,
      style: 5,
      label: "Open in Drive",
      url: "https://drive.google.com/file/d/file-99/view",
    });
  });

  it("formats updated file notification with blurple color (#5865F2) and 'Updated by <name>'", () => {
    const { embed } = formatDriveNotification({
      filename: "presentation.key",
      fileId: "file-100",
      mimeType: "application/vnd.apple.keynote",
      sizeBytes: 10485760,
      modifiedTime: "2026-10-07T13:00:00Z",
      modifyingUserName: "Bob Ross",
      isNew: false,
      hasThumbnail: false,
      webViewLink: "https://drive.google.com/file/d/file-100/view",
    });

    expect(embed.color).toBe(0x5865f2); // Blurple
    expect(embed.author?.name).toBe("Updated by Bob Ross");
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.fields?.find((f) => f.name === "Type")?.value).toBe("application/vnd.apple.keynote");
  });

  it("includes Path field when file is inside a subfolder", () => {
    const { embed } = formatDriveNotification({
      filename: "brief.pdf",
      fileId: "file-101",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      modifiedTime: "2026-10-07T14:00:00Z",
      modifyingUserName: "Charlie Day",
      isNew: true,
      hasThumbnail: false,
      relativePath: "/2026 Campaigns/Briefs/",
    });

    expect(embed.fields).toEqual([
      { name: "Path", value: "📂 `/2026 Campaigns/Briefs/`", inline: true },
      { name: "Type", value: "PDF Document", inline: true },
      { name: "Size", value: "1 KB", inline: true },
    ]);
  });

  it("omits Path field when file is at root level '/'", () => {
    const { embed } = formatDriveNotification({
      filename: "root.pdf",
      fileId: "file-102",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      modifiedTime: "2026-10-07T14:00:00Z",
      modifyingUserName: "Charlie Day",
      isNew: true,
      hasThumbnail: false,
      relativePath: "/",
    });

    expect(embed.fields?.some((f) => f.name === "Path")).toBe(false);
  });
});
