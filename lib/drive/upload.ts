import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";
import { getDriveClient } from "./client";
import { withBackoff } from "@/lib/retry";

export interface UploadStreamParams {
  filename: string;
  mimeType: string;
  folderId: string;
  bodyStream: Readable;
}

export interface UploadResult {
  fileId: string;
  name: string;
  webViewLink?: string | null;
  mimeType?: string | null;
  size?: string | null;
}

export interface UploadFromUrlParams {
  filename: string;
  mimeType: string;
  folderId: string;
  url: string;
}

/**
 * Downloads from URL and streams to Google Drive under a single withBackoff retry wrapper.
 * Re-creates the download stream on each retry attempt so consumed streams are never reused.
 */
export async function uploadFromUrl(
  params: UploadFromUrlParams,
  drive: drive_v3.Drive = getDriveClient()
): Promise<UploadResult> {
  return withBackoff(async () => {
    // 1. Download stream from URL (fresh stream per attempt)
    const res = await fetch(params.url);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download attachment ${params.filename}: ${res.statusText}`);
    }

    const nodeReadable = Readable.fromWeb(res.body as import("stream/web").ReadableStream);

    // 2. Upload stream to Drive
    const fileMetadata: drive_v3.Schema$File = {
      name: params.filename,
      parents: [params.folderId],
      appProperties: {
        source: "discord",
      },
    };

    const media = {
      mimeType: params.mimeType,
      body: nodeReadable,
    };

    const driveRes = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id, name, webViewLink, mimeType, size, appProperties",
      supportsAllDrives: true,
    });

    const file = driveRes.data;
    if (!file.id) {
      throw new Error(`Failed to upload file to Google Drive: no file ID returned`);
    }

    return {
      fileId: file.id,
      name: file.name || params.filename,
      webViewLink: file.webViewLink,
      mimeType: file.mimeType,
      size: file.size,
    };
  });
}

/**
 * Streams an attachment directly to a target Drive folder without buffering whole files in memory.
 * CRITICAL RULE: appProperties.source must be set to "discord" to break feedback loops.
 */
export async function uploadStreamToDrive(
  params: UploadStreamParams,
  drive: drive_v3.Drive = getDriveClient()
): Promise<UploadResult> {
  const fileMetadata: drive_v3.Schema$File = {
    name: params.filename,
    parents: [params.folderId],
    appProperties: {
      source: "discord",
    },
  };

  const media = {
    mimeType: params.mimeType,
    body: params.bodyStream,
  };

  const res = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id, name, webViewLink, mimeType, size, appProperties",
    supportsAllDrives: true,
  });

  const file = res.data;
  if (!file.id) {
    throw new Error(`Failed to upload file to Google Drive: no file ID returned`);
  }

  return {
    fileId: file.id,
    name: file.name || params.filename,
    webViewLink: file.webViewLink,
    mimeType: file.mimeType,
    size: file.size,
  };
}
