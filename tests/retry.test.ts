import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { backoffMs, fetchWithRetry, isRetryableStatus, retryAfterMs } from "../lib/retry";

/** Phase 10: outgoing calls retry transient failures with backoff — and nothing else. */
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const scripted = (...answers: (number | Error)[]) => {
  const calls: number[] = [];
  globalThis.fetch = (async () => {
    calls.push(Date.now());
    const next = answers.shift()!;
    if (next instanceof Error) throw next;
    return new Response("{}", { status: next });
  }) as typeof fetch;
  return calls;
};
const noWait = { sleep: async () => {}, random: () => 0.5 };

describe("retry", () => {
  it("retries only what's transient", () => {
    for (const s of [429, 500, 502, 503, 529]) assert.equal(isRetryableStatus(s), true, String(s));
    for (const s of [200, 201, 400, 401, 403, 404, 409, 422]) assert.equal(isRetryableStatus(s), false, String(s));
  });

  it("backs off exponentially, with jitter, up to a cap", () => {
    assert.equal(backoffMs(0, { baseMs: 100, random: () => 1 }), 100);
    assert.equal(backoffMs(3, { baseMs: 100, random: () => 1 }), 800);
    assert.equal(backoffMs(10, { baseMs: 100, maxMs: 1000, random: () => 1 }), 1000);
    assert.equal(backoffMs(2, { baseMs: 100, random: () => 0 }), 0);
  });

  it("reads Retry-After as seconds or a date", () => {
    assert.equal(retryAfterMs("2"), 2000);
    assert.equal(retryAfterMs(new Date(Date.now() + 5000).toUTCString(), Date.now()) !== null, true);
    assert.equal(retryAfterMs("soon"), null);
    assert.equal(retryAfterMs(null), null);
  });

  it("recovers from a blip", async () => {
    const calls = scripted(503, new Error("ECONNRESET"), 200);
    const res = await fetchWithRetry("https://x.example", {}, noWait);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 3);
  });

  it("gives an answer, not a retry, on a 4xx", async () => {
    const calls = scripted(422, 200);
    assert.equal((await fetchWithRetry("https://x.example", {}, noWait)).status, 422);
    assert.equal(calls.length, 1);
  });

  it("stops after its attempts and returns the last answer", async () => {
    const calls = scripted(500, 500, 500, 200);
    assert.equal((await fetchWithRetry("https://x.example", {}, { ...noWait, attempts: 3 })).status, 500);
    assert.equal(calls.length, 3);
  });

  it("throws the network error when every attempt fails", async () => {
    scripted(new Error("down"), new Error("down"));
    await assert.rejects(fetchWithRetry("https://x.example", {}, { ...noWait, attempts: 2 }), /down/);
  });
});
