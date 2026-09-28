import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * No client component may reach the database client, directly or through
 * anything it imports.
 *
 * The data layer carries the tenancy and audit walls, which read the session;
 * a client component that imports a constant from a server module drags all
 * of that into the browser bundle. Next reports it only when that page is
 * compiled — at runtime, one route at a time. This walks the import graph
 * statically so the whole app is checked on every test run.
 */

const DIRS = ["app", "components", "lib", "modules", "config"];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolve(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = spec.slice(2);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate)) return path.normalize(candidate);
  }
  return null;
}

/** Runtime imports only — `import type` and all-`type` member lists are erased. */
function runtimeDeps(src: string): string[] {
  const deps: string[] = [];
  const statements = src.match(/^\s*(?:import|export)\s[^;]*?from\s+"[^"]+"/gm) ?? [];
  for (const stmt of statements) {
    if (/^\s*(?:import|export)\s+type\s/.test(stmt)) continue;
    const members = /\{([^}]*)\}/.exec(stmt);
    const hasDefault = /import\s+[\w$]+\s*(,|from)/.test(stmt);
    if (members && !hasDefault) {
      const names = members[1].split(",").map((m) => m.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
    }
    const spec = /from\s+"([^"]+)"/.exec(stmt)?.[1];
    const resolved = spec ? resolve(spec) : null;
    if (resolved) deps.push(resolved);
  }
  for (const match of src.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
    const resolved = resolve(match[1]);
    if (resolved) deps.push(resolved);
  }
  return deps;
}

describe("client/server boundary", () => {
  it("keeps the database client out of every client component's import graph", () => {
    const all = DIRS.flatMap(files).map((f) => path.normalize(f));
    const graph = new Map(all.map((f) => [f, runtimeDeps(readFileSync(f, "utf8"))]));

    const server = new Set([path.normalize("lib/prisma.ts")]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [file, deps] of graph) {
        if (!server.has(file) && deps.some((d) => server.has(d))) {
          server.add(file);
          grew = true;
        }
      }
    }

    const offenders = all
      .filter((f) => readFileSync(f, "utf8").trimStart().startsWith('"use client"'))
      .filter((f) => server.has(f))
      .map((f) => `${f} -> ${(graph.get(f) ?? []).filter((d) => server.has(d)).join(", ")}`);

    assert.deepEqual(offenders, []);
  });

  it("keeps the credentials vault — its key and its cipher — out of every client component", () => {
    const all = DIRS.flatMap(files).map((f) => path.normalize(f));
    const graph = new Map(all.map((f) => [f, runtimeDeps(readFileSync(f, "utf8"))]));
    const vault = new Set(all.filter((f) => f.startsWith(path.normalize("modules/vault/"))));
    let grew = true;
    while (grew) {
      grew = false;
      for (const [file, deps] of graph) {
        if (!vault.has(file) && deps.some((d) => vault.has(d))) {
          vault.add(file);
          grew = true;
        }
      }
    }
    const offenders = all.filter((f) => readFileSync(f, "utf8").trimStart().startsWith('"use client"') && vault.has(f));
    assert.deepEqual(offenders, []);
  });

  it("marks the modules that hold secrets server-only, so a client import fails the build", () => {
    for (const f of [
      "modules/vault/server.ts",
      "modules/vault/credentials.ts",
      "modules/files/server.ts",
      "lib/uploads.ts",
      // Phase 7: billing's data access, the PDF engine, and the payment provider's keys.
      "modules/billing/server.ts",
      "modules/billing/lifecycle.ts",
      "modules/billing/overview.ts",
      "modules/billing/pdf.ts",
      "modules/billing/email.ts",
      "modules/billing/portal.ts",
      "modules/integrations/payments/index.ts",
    ]) {
      assert.match(readFileSync(f, "utf8"), /^import "server-only";/m, f);
    }
  });
});
