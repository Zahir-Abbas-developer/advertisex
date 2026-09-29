/**
 * Outgoing calls that can fail for a moment — an email API, the AI provider —
 * are retried a few times with exponential backoff and full jitter (Phase
 * 10). Only what's worth retrying: network errors, 429 and 5xx. A 4xx is an
 * answer, not a hiccup. `Retry-After` is honoured, capped so a request never
 * hangs on a provider's say-so.
 *
 * Non-idempotent POSTs must carry an idempotency key the provider honours
 * (Resend does), so a retry after a lost response can't act twice.
 */

export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  /** Per attempt. */
  timeoutMs?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export const isRetryableStatus = (status: number) => status === 429 || status >= 500;

/** Full jitter: a random wait up to the exponential ceiling. */
export function backoffMs(attempt: number, { baseMs = 300, maxMs = 3_000, random = Math.random }: Pick<RetryOptions, "baseMs" | "maxMs" | "random"> = {}): number {
  return Math.round(random() * Math.min(maxMs, baseMs * 2 ** attempt));
}

/** Seconds or an HTTP date → milliseconds, or null. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions = {}): Promise<Response> {
  const { attempts = 3, maxMs = 3_000, timeoutMs = 8_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!isRetryableStatus(res.status) || attempt === attempts - 1) return res;
      const hinted = retryAfterMs(res.headers.get("retry-after"));
      await sleep(hinted !== null ? Math.min(hinted, maxMs) : backoffMs(attempt, options));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await sleep(backoffMs(attempt, options));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
