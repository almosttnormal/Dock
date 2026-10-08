import { describe, it, expect, vi } from "vitest";
import { withBackoff, isRetryableError, extractRetryAfterMs } from "./retry";

describe("lib/retry", () => {
  it("identifies retryable HTTP status codes and reasons", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
    expect(isRetryableError({ errors: [{ reason: "userRateLimitExceeded" }] })).toBe(true);
    expect(isRetryableError({ errors: [{ reason: "rateLimitExceeded" }] })).toBe(true);
    expect(isRetryableError({ message: "Network connection reset ECONNRESET" })).toBe(true);

    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 404 })).toBe(false);
  });

  it("extracts retry_after delay in milliseconds from Discord and headers", () => {
    expect(extractRetryAfterMs({ retry_after: 2.5 })).toBe(2500);
    expect(extractRetryAfterMs({ retryAfter: 1.2 })).toBe(1200);

    const errorWithHeader = {
      headers: {
        "retry-after": "3",
      },
    };
    expect(extractRetryAfterMs(errorWithHeader)).toBe(3000);
  });

  it("resolves immediately when operation succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withBackoff(fn, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and respects maxRetries", async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        const err = new Error("Rate limit 429") as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return Promise.resolve("ok");
    });

    const result = await withBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws when non-retryable error occurs without retrying", async () => {
    const fn = vi.fn().mockImplementation(() => {
      const err = new Error("Bad Request 400") as Error & { status: number };
      err.status = 400;
      throw err;
    });

    await expect(withBackoff(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow("Bad Request 400");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors Discord retry_after delay during backoff", async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const err = new Error("Rate limit") as Error & { status: number; retry_after: number };
        err.status = 429;
        err.retry_after = 0.05; // 50ms
        throw err;
      }
      return Promise.resolve("done");
    });

    const start = Date.now();
    const result = await withBackoff(fn, { maxRetries: 2 });
    const elapsed = Date.now() - start;

    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("throws when retry_after exceeds max delay cap (10 seconds)", async () => {
    const fn = vi.fn().mockImplementation(() => {
      const err = new Error("Rate limit 429") as Error & { status: number; retry_after: number };
      err.status = 429;
      err.retry_after = 15; // 15 seconds > 10s cap
      throw err;
    });

    await expect(withBackoff(fn, { maxRetries: 2, maxDelayMs: 10000 })).rejects.toThrow(
      "exceeds max allowed delay"
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Discord POST policy: retries on 429 but does NOT retry on 5xx or network errors", async () => {
    const postShouldRetry = (error: unknown) => {
      const status = (error as { status?: number })?.status;
      return status === 429;
    };

    // 1. Fails on 500 without retry
    const fn500 = vi.fn().mockImplementation(() => {
      const err = new Error("Discord 500 Internal Server Error") as Error & { status: number };
      err.status = 500;
      throw err;
    });

    await expect(
      withBackoff(fn500, { maxRetries: 3, baseDelayMs: 10, shouldRetry: postShouldRetry })
    ).rejects.toThrow("Discord 500");
    expect(fn500).toHaveBeenCalledTimes(1);

    // 2. Fails on network error without retry
    const fnNetwork = vi.fn().mockImplementation(() => {
      throw new Error("Network ECONNRESET");
    });

    await expect(
      withBackoff(fnNetwork, { maxRetries: 3, baseDelayMs: 10, shouldRetry: postShouldRetry })
    ).rejects.toThrow("Network ECONNRESET");
    expect(fnNetwork).toHaveBeenCalledTimes(1);

    // 3. Retries and succeeds on 429
    let count429 = 0;
    const fn429 = vi.fn().mockImplementation(() => {
      count429++;
      if (count429 === 1) {
        const err = new Error("Discord 429") as Error & { status: number; retry_after: number };
        err.status = 429;
        err.retry_after = 0.02; // 20ms
        throw err;
      }
      return Promise.resolve({ id: "msg-123" });
    });

    const res = await withBackoff(fn429, {
      maxRetries: 2,
      baseDelayMs: 10,
      shouldRetry: postShouldRetry,
    });
    expect(res).toEqual({ id: "msg-123" });
    expect(fn429).toHaveBeenCalledTimes(2);
  });

  it("Discord PATCH/edit policy: retries on 5xx server errors", async () => {
    let patchCount = 0;
    const fnPatch = vi.fn().mockImplementation(() => {
      patchCount++;
      if (patchCount === 1) {
        const err = new Error("Discord 503 Service Unavailable") as Error & { status: number };
        err.status = 503;
        throw err;
      }
      return Promise.resolve();
    });

    await withBackoff(fnPatch, { maxRetries: 2, baseDelayMs: 10 });
    expect(fnPatch).toHaveBeenCalledTimes(2);
  });
});
