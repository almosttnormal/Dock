/**
 * lib/retry.ts - Exponential backoff and retry utility with jitter.
 * Honors Discord retry_after and Google Drive rate-limit errors (429, userRateLimitExceeded, 5xx).
 */

import { logger } from "@/lib/log";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface RateLimitErrorLike {
  status?: number;
  code?: number | string;
  statusCode?: number;
  response?: {
    status?: number;
    headers?: Headers | Record<string, string | string[]>;
    data?: unknown;
  };
  headers?: Headers | Record<string, string | string[]>;
  retryAfter?: number;
  retry_after?: number;
  errors?: Array<{ reason?: string }>;
  message?: string;
}

/**
 * Extracts retry delay from Discord or Drive rate limit headers/errors if available.
 */
export function extractRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;

  const errorObj = err as RateLimitErrorLike;

  // Direct property check (e.g. Discord 429 response body parsed: { retry_after: 1.5 })
  if (typeof errorObj.retry_after === "number") {
    return Math.ceil(errorObj.retry_after * 1000);
  }
  if (typeof errorObj.retryAfter === "number") {
    return Math.ceil(errorObj.retryAfter * 1000);
  }

  // Response headers (fetch Response or googleapis)
  const headers = errorObj.response?.headers || errorObj.headers;
  if (headers) {
    let headerVal: string | null = null;
    if (typeof (headers as Headers).get === "function") {
      headerVal = (headers as Headers).get("retry-after");
    } else if (typeof headers === "object") {
      const rec = headers as Record<string, string | string[]>;
      const val = rec["retry-after"] || rec["Retry-After"];
      headerVal = Array.isArray(val) ? val[0] : (val ?? null);
    }

    if (headerVal) {
      const parsedSec = parseFloat(headerVal);
      if (!Number.isNaN(parsedSec)) {
        return Math.ceil(parsedSec * 1000);
      }
    }
  }

  return null;
}

/**
 * Determines whether an error is transient / rate-limited.
 */
export function isRetryableError(err: unknown): boolean {
  if (!err) return false;

  const errorObj = err as RateLimitErrorLike;
  const status =
    errorObj.status ||
    errorObj.statusCode ||
    errorObj.response?.status ||
    (typeof errorObj.code === "number" ? errorObj.code : undefined);

  if (status === 429) return true;
  if (status && status >= 500 && status <= 599) return true;

  // Google Drive specific rate-limit / quota reasons
  const reason = errorObj.errors?.[0]?.reason;
  if (
    reason === "rateLimitExceeded" ||
    reason === "userRateLimitExceeded" ||
    reason === "quotaExceeded"
  ) {
    return true;
  }

  const msg = errorObj.message?.toLowerCase() || "";
  if (
    msg.includes("rate limit") ||
    msg.includes("user_rate_limit_exceeded") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  ) {
    return true;
  }

  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an operation with exponential backoff and jitter.
 * Defaults: 4 retries, base delay 500ms, max delay 10,000ms.
 */
export async function withBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const shouldRetry = options.shouldRetry ?? isRetryableError;

  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt);
    } catch (err: unknown) {
      attempt++;

      if (attempt > maxRetries || !shouldRetry(err, attempt)) {
        throw err;
      }

      // Check explicit Retry-After from Discord / Drive
      const retryAfterMs = extractRetryAfterMs(err);
      let delayMs: number;

      if (retryAfterMs !== null && retryAfterMs > 0) {
        // C. Cap retry_after at 10 seconds (10,000ms); beyond that, throw.
        if (retryAfterMs > maxDelayMs) {
          throw new Error(
            `Rate limit retry_after (${Math.round(retryAfterMs / 1000)}s) exceeds max allowed delay (${Math.round(maxDelayMs / 1000)}s). Aborting retry.`
          );
        }
        delayMs = retryAfterMs;
      } else {
        // Exponential backoff: base * 2^(attempt-1) + jitter (0 - 250ms)
        const exponential = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 250;
        delayMs = Math.min(exponential + jitter, maxDelayMs);
      }

      logger.warn(`Retry attempt ${attempt}/${maxRetries} after ${Math.round(delayMs)}ms`, {
        attempt,
        delayMs,
        error: err instanceof Error ? err.message : String(err),
      });

      await sleep(delayMs);
    }
  }
}
