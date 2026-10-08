import { describe, it, expect, beforeEach } from "vitest";
import { getEnv } from "@/lib/env";

describe("lib/env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when required environment variables are missing", () => {
    process.env = { NODE_ENV: "test" };
    expect(() => getEnv()).toThrowError(/Invalid environment configuration/);
  });

  it("parses valid environment configuration correctly", () => {
    process.env = {
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "https://bridge.example.com",
      DISCORD_APPLICATION_ID: "1234567890",
      DISCORD_PUBLIC_KEY: "abcdef123456",
      DISCORD_BOT_TOKEN: "discord-bot-token-xyz",
      DISCORD_GUILD_ID: "9876543210",
      ALLOWED_USER_IDS: "user1, user2, user3",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      GOOGLE_REFRESH_TOKEN: "google-refresh-token",
      DRIVE_WEBHOOK_TOKEN: "webhook-secret-token",
      NEXT_PUBLIC_SUPABASE_URL: "https://xyz.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "supabase-service-role-key",
      CRON_SECRET: "cron-secret-123",
      DEBOUNCE_SECONDS: "5",
    };

    const env = getEnv();
    expect(env.PUBLIC_BASE_URL).toBe("https://bridge.example.com");
    expect(env.ALLOWED_USER_IDS).toEqual(["user1", "user2", "user3"]);
    expect(env.DEBOUNCE_SECONDS).toBe(5);
  });
});
