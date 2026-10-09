import http from "node:http";
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

      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      const code = reqUrl.searchParams.get("code");
      const urlError = reqUrl.searchParams.get("error");
      const urlErrorDesc = reqUrl.searchParams.get("error_description");

      if (urlError) {
        console.error("\n=======================================================");
        console.error("GOOGLE OAUTH AUTHORIZATION ERROR (Consent Denied)");
        console.error("=======================================================");
        console.error(`Error Code:        ${urlError}`);
        if (urlErrorDesc) {
          console.error(`Description:       ${urlErrorDesc}`);
        }
        console.error(`Redirect URI used: ${redirectUri}`);
        console.error("Hint:              Ensure you click 'Continue' / 'Allow' during the Google consent screen.");
        console.error("=======================================================\n");

        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("Authorization was cancelled or denied by the user. Check terminal for details.");
        server.close(() => {
          process.exit(1);
        });
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("Missing authorization code.");
        return;
      }

      const tokenParams = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tokenParams.toString(),
      });

      const tokenData = await tokenRes.json().catch(() => null);

      if (!tokenRes.ok) {
        const status = tokenRes.status;
        const errorCode = tokenData?.error || "token_exchange_error";
        const errorDescription = tokenData?.error_description || tokenRes.statusText;

        console.error("\n=======================================================");
        console.error("GOOGLE OAUTH TOKEN EXCHANGE FAILED");
        console.error("=======================================================");
        console.error(`HTTP Status:       ${status}`);
        console.error(`Error Code:        ${errorCode}`);
        if (errorDescription) {
          console.error(`Error Description: ${errorDescription}`);
        }
        console.error(`Redirect URI used: ${redirectUri}`);

        const codeStr = String(errorCode || "");
        const descStr = String(errorDescription || "");

        if (codeStr.includes("invalid_client") || descStr.includes("invalid_client")) {
          console.error("Hint:              Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. The client secret might be mistyped or revoked.");
        } else if (codeStr.includes("redirect_uri_mismatch") || descStr.includes("redirect_uri_mismatch")) {
          console.error(`Hint:              Add "${redirectUri}" to Authorized redirect URIs in Google Cloud Console.`);
        } else if (codeStr.includes("invalid_grant") || descStr.includes("invalid_grant")) {
          console.error("Hint:              The authorization code has expired, already been redeemed, or the user revoked access. Run the script again to get a fresh code.");
        } else {
          console.error("Hint:              Verify your Google Cloud Console OAuth 2.0 Web Client settings and network connectivity.");
        }
        console.error("=======================================================\n");

        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`Error retrieving access token: ${errorCode}. Check your terminal output.`);
        server.close(() => {
          process.exit(1);
        });
        return;
      }

      const refreshToken = tokenData?.refresh_token;

      if (!refreshToken) {
        console.error("\n=======================================================");
        console.error("GOOGLE OAUTH WARNING: NO REFRESH TOKEN RETURNED");
        console.error("=======================================================");
        console.error("Hint:              Google did not return a refresh_token. This usually happens if you already authorized the app without prompt=consent or access_type=offline.");
        console.error("Hint:              Go to https://myaccount.google.com/connections, remove access for this app, and run the script again.");
        console.error("=======================================================\n");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("Connected, but no refresh_token was returned. Check terminal for instructions.");
        server.close(() => {
          process.exit(1);
        });
        return;
      }

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
      console.log(`GOOGLE_REFRESH_TOKEN=${refreshToken}`);
      console.log("=======================================================\n");

      server.close(() => {
        process.exit(0);
      });
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      const errorCode = err?.code || "network_error";
      const errorDescription = err?.message || String(error);

      console.error("\n=======================================================");
      console.error("GOOGLE OAUTH TOKEN EXCHANGE FAILED");
      console.error("=======================================================");
      if (errorCode) {
        console.error(`Error Code:        ${errorCode}`);
      }
      if (errorDescription) {
        console.error(`Error Description: ${errorDescription}`);
      }
      console.error(`Redirect URI used: ${redirectUri}`);
      console.error("Hint:              Network failure communicating with Google OAuth. Check your internet/proxy connection.");
      console.error("=======================================================\n");

      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`Error retrieving access token: ${errorCode}. Check your terminal output.`);
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
