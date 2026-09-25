import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Every route handler refuses before it touches data (CLAUDE.md §5: "Every
 * server action / route handler calls authorize() before touching data").
 *
 * Checked structurally, per exported method: the body must open with one of
 * the guards that route through the permissions matrix. A new handler that
 * forgets its guard fails here, before review, rather than in production.
 *
 * The exceptions are listed by name, each with its reason.
 */

const GUARDS = [
  /\brequireApi\(/, // role gate via config/permissions.ts
  /\brequireAdminApi\(/, // requireApi("manage", "admin")
  /\bauthorizeCron\(/, // scheduler bearer secret, not a session
];

const PUBLIC: Record<string, string> = {
  "auth/[...nextauth]/route.ts": "NextAuth's own sign-in endpoints",
  "health/route.ts": "uptime probe; returns no data",
};

function handlers(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return handlers(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** Body text of each exported HTTP method, up to the next top-level export. */
function methodBodies(src: string): { method: string; body: string }[] {
  const exports = [...src.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)];
  return exports.map((match, i) => ({
    method: match[1],
    body: src.slice(match.index, exports[i + 1]?.index ?? src.length),
  }));
}

const API = path.join(process.cwd(), "app", "api");

describe("route handlers", () => {
  const files = handlers(API);

  it("finds the handlers", () => {
    assert.ok(files.length >= 80, `only ${files.length} handlers found — wrong directory?`);
  });

  for (const file of files) {
    const rel = path.relative(API, file);
    if (PUBLIC[rel]) continue;

    it(`${rel} guards every method`, () => {
      const src = readFileSync(file, "utf8");
      const bodies = methodBodies(src);
      assert.ok(bodies.length > 0, "no exported HTTP methods");
      const guarded = new Set(
        bodies.filter(({ body }) => GUARDS.some((g) => g.test(body))).map(({ method }) => method),
      );
      for (const { method, body } of bodies) {
        // `GET` handlers that only delegate (`return POST(request)`) inherit
        // the delegate's guard.
        const delegate = /^\s*export (?:async function|const) \w+\([^)]*\)\s*\{\s*return (GET|POST|PUT|PATCH|DELETE)\(/.exec(body);
        if (delegate && guarded.has(delegate[1])) continue;

        // The guard must come before the first database call in the body.
        const guardAt = Math.min(
          ...GUARDS.map((g) => body.search(g)).filter((i) => i >= 0),
        );
        assert.ok(Number.isFinite(guardAt), `${method} has no guard`);
        const firstQuery = body.search(/\bprisma\./);
        assert.ok(
          firstQuery === -1 || guardAt < firstQuery,
          `${method} queries the database before its guard`,
        );
      }
    });
  }
});
