import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import defaultTheme from "tailwindcss/defaultTheme";

import config from "../tailwind.config";

/**
 * Guards for the design tokens themselves.
 *
 * A color token that shares a name with a Tailwind font size produces a class
 * like `text-base` that compiles, looks right in review, and quietly sets
 * 16px type instead of a color. That shipped once — every gold button had
 * white text — so the collision is now a failing test rather than something
 * to spot by eye.
 */

const colors = Object.keys(config.theme?.extend?.colors ?? {});
const fontSizes = new Set([
  ...Object.keys(defaultTheme.fontSize),
  ...Object.keys(config.theme?.extend?.fontSize ?? {}),
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts|css)$/.test(name) ? [full] : [];
  });
}

describe("design tokens", () => {
  it("defines the §7 core tokens", () => {
    for (const token of ["canvas", "surface", "ink", "line", "brand", "data", "success", "warn", "danger", "info"]) {
      assert.ok(colors.includes(token), `missing color token: ${token}`);
    }
  });

  it("never names a color token after a font size", () => {
    const clashes = colors.filter((name) => fontSizes.has(name));
    assert.deepEqual(clashes, [], `color tokens shadowed by text-<size>: ${clashes.join(", ")}`);
  });

  it("uses no retired light-theme tokens in the UI", () => {
    // Also a full-strength `border-ink`: ink is the warm white, so an unfaded
    // ink border is a glaring outline on obsidian — panels use `line-strong`.
    const retired = /\b(?:bg|text|border|ring|ring-offset)-(?:paper|cream)\b|\bbg-white\b|\bbg-base\b|\bborder-ink(?![\w/-])/;
    const offenders = ["app", "components"]
      .flatMap(sourceFiles)
      .filter((file) => retired.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(process.cwd(), file));
    assert.deepEqual(offenders, []);
  });
});
