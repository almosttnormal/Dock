import http from "node:http";
import url from "node:url";
import { google } from "googleapis";

/**
 * One-time interactive OAuth consent script to generate the owner's refresh token.
 * Usage: npx tsx scripts/get-google-refresh-token.ts
 */
async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in your environment before running this script."
    );
    process.exit(1);
  }

  const port = 3000;
  const redirectUri = `http://localhost:${port}/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/drive",
    ],
  });

  console.log("\n=======================================================");
  console.log("GOOGLE OAUTH REFRESH TOKEN GENERATOR");
  console.log("=======================================================");
  console.log("1. Open the following URL in your browser:\n");
  console.log(authUrl);
  console.log("\n2. Grant permissions with the Google account owning the Drive folders.");
  console.log(`3. Waiting for authorization callback on http://localhost:${port} ...\n`);

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith("/oauth2callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const query = url.parse(req.url, true).query;
      const code = query.code as string;

      if (!code) {
        res.writeHead(400);
        res.end("Missing authorization code.");
        return;
      }

      const { tokens } = await oauth2Client.getToken(code);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #10b981;">Authorization Successful!</h2>
            <p>You can close this window and return to your terminal.</p>
          </body>
        </html>
      `);

      console.log("\n=======================================================");
      console.log("SUCCESS! Copy this refresh token into your .env file:");
      console.log("=======================================================");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log("=======================================================\n");

      server.close(() => {
        process.exit(0);
      });
    } catch (error) {
      console.error("Error exchanging authorization code:", error);
      res.writeHead(500);
      res.end("Error retrieving access token.");
      server.close(() => {
        process.exit(1);
      });
    }
  });

  server.listen(port);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
