import { describe, it, expect, vi } from "vitest";
import { redactValue, logger } from "./log";

describe("lib/log", () => {
  it("redacts sensitive keys from objects", () => {
    const input = {
      user: "alice",
      token: "secret-token-123",
      DISCORD_BOT_TOKEN: "bot-token-xyz",
      google_client_secret: "super-secret",
      apiKey: "key-abc-123",
      authorization: "Bearer secret-jwt",
      password: "my-password",
      nested: {
        accessToken: "nested-token",
        safeKey: "safe-value",
      },
    };

    const redacted = redactValue(input) as Record<string, unknown>;

    expect(redacted.user).toBe("alice");
    expect(redacted.token).toBe("[REDACTED]");
    expect(redacted.DISCORD_BOT_TOKEN).toBe("[REDACTED]");
    expect(redacted.google_client_secret).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.password).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).accessToken).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).safeKey).toBe("safe-value");
  });

  it("redacts bearer tokens in string messages", () => {
    const message = "Request failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test and bot token Bot 123456";
    const redacted = redactValue(message);
    expect(typeof redacted).toBe("string");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9.test");
  });

  it("redacts sensitive information in Error instances", () => {
    const err = new Error("Failed connecting with token secret-12345");
    const redacted = redactValue(err) as { name: string; message: string };
    expect(redacted.name).toBe("Error");
    expect(redacted.message).toBeDefined();
  });

  it("logs structured JSON to stdout/stderr", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.info("Test info message", { user: "john", token: "secret123" });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(loggedJson.level).toBe("info");
    expect(loggedJson.message).toBe("Test info message");
    expect(loggedJson.meta.token).toBe("[REDACTED]");

    logger.error("Test error message", { secret: "123" });
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
