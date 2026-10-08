import { verifyKey } from "discord-interactions";
import { getEnv } from "@/lib/env";

/**
 * Verifies Ed25519 signature of incoming Discord interactions.
 * Strictly verifies raw body BEFORE parsing or acting on the request.
 */
export async function verifyDiscordRequest(request: Request): Promise<{
  isValid: boolean;
  rawBody: string;
}> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");

  if (!signature || !timestamp) {
    return { isValid: false, rawBody: "" };
  }

  const rawBody = await request.text();
  const env = getEnv();

  const isValid = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);

  return { isValid, rawBody };
}
