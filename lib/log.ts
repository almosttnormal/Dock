/**
 * lib/log.ts - Structured JSON logger with secret redaction.
 * Redacts any key or string pattern matching sensitive secrets:
 * token, secret, authorization, key, password, bearer.
 */

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  // Exact words or compound words containing token, secret, authorization, password, bearer
  if (
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("authorization") ||
    lower.includes("password") ||
    lower.includes("bearer")
  ) {
    return true;
  }
  // For 'key', only match if key is 'key', or compound with prefix/suffix like api_key, apiKey, privateKey, service_role_key
  if (
    lower === "key" ||
    lower.endsWith("_key") ||
    lower.startsWith("key_") ||
    lower.endsWith("-key") ||
    lower.startsWith("key-") ||
    /(?:^|[a-z])Key(?:[A-Z]|$)/.test(key)
  ) {
    // Exclude safe generic keys like safeKey, objectKey unless specifically sensitive
    if (lower === "safekey") return false;
    return true;
  }
  return false;
}

const SENSITIVE_VALUE_PATTERN = /(?:bearer\s+[a-zA-Z0-9_\-\.]+|(?:bot|ghp_[a-zA-Z0-9]+|ey[a-zA-Z0-9_\-\.]+)\b)/gi;

export type LogLevel = "info" | "warn" | "error" | "debug";

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MaxDepth]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.replace(SENSITIVE_VALUE_PATTERN, "[REDACTED]");
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactValue(value.message, depth + 1),
      stack: value.stack ? (redactValue(value.stack, depth + 1) as string) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = redactValue(v, depth + 1);
      }
    }
    return result;
  }

  return String(value);
}

export function logMessage(level: LogLevel, message: string, meta?: unknown): void {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message: typeof message === "string" ? (redactValue(message) as string) : message,
  };

  if (meta !== undefined) {
    payload.meta = redactValue(meta);
  }

  const jsonStr = JSON.stringify(payload);
  if (level === "error") {
    process.stderr.write(`${jsonStr}\n`);
  } else if (level === "warn") {
    process.stderr.write(`${jsonStr}\n`);
  } else {
    process.stdout.write(`${jsonStr}\n`);
  }
}

export const logger = {
  info: (msg: string, meta?: unknown) => logMessage("info", msg, meta),
  warn: (msg: string, meta?: unknown) => logMessage("warn", msg, meta),
  error: (msg: string, meta?: unknown) => logMessage("error", msg, meta),
  debug: (msg: string, meta?: unknown) => logMessage("debug", msg, meta),
};
