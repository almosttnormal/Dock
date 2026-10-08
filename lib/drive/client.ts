import { google, drive_v3 } from "googleapis";
import { getEnv } from "@/lib/env";

let driveClientInstance: drive_v3.Drive | null = null;

/**
 * Initializes and returns a Google Drive v3 client using the owner's OAuth2 refresh token.
 */
export function getDriveClient(): drive_v3.Drive {
  if (driveClientInstance) {
    return driveClientInstance;
  }

  const env = getEnv();

  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    // Redirect URI is only needed during initial code exchange; dummy is fine for refresh token flow
    "http://localhost:3000/oauth2callback"
  );

  oauth2Client.setCredentials({
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
  });

  driveClientInstance = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  return driveClientInstance;
}
