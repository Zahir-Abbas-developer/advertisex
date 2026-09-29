import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baseSecurityHeaders, contentSecurityPolicy, newNonce, pageSecurityHeaders } from "../lib/security-headers";

/** Phase 10: the response hardening every page and API response carries. */
describe("security headers", () => {
  it("production CSP: nonce-only scripts, no inline or eval, never framed", () => {
    const csp = contentSecurityPolicy("abc123");
    assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'(;|$)/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'", "upgrade-insecure-requests"]) assert.ok(csp.includes(d), d);
  });

  it("development allows only what the dev server needs", () => {
    const csp = contentSecurityPolicy("n", { dev: true });
    assert.match(csp, /'unsafe-eval'/);
    assert.match(csp, /connect-src 'self' ws: wss:/);
    assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  });

  it("every response: nosniff, referrer, permissions, and HSTS in production only", () => {
    const prod = baseSecurityHeaders();
    assert.equal(prod["X-Content-Type-Options"], "nosniff");
    assert.equal(prod["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.match(prod["Permissions-Policy"], /camera=\(\)/);
    assert.match(prod["Strict-Transport-Security"], /max-age=63072000/);
    assert.equal(baseSecurityHeaders({ dev: true })["Strict-Transport-Security"], undefined);
  });

  it("pages add the CSP and frame denial", () => {
    const h = pageSecurityHeaders("x");
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.match(h["Content-Security-Policy"], /'nonce-x'/);
  });

  it("nonces are fresh and unguessable", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
    assert.equal(seen.size, 200);
    assert.ok([...seen].every((n) => Buffer.from(n, "base64").length === 16));
  });
});

import { safeCallbackPath } from "../lib/routes";

describe("post-sign-in destination (open redirect)", () => {
  it("keeps paths on this site", () => {
    assert.equal(safeCallbackPath("/pipeline?lead=abc#notes"), "/pipeline?lead=abc#notes");
    assert.equal(safeCallbackPath("/portal"), "/portal");
  });
  it("refuses everything that could leave it", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", null, undefined, "/%2F%2Fevil.com/../"]) {
      const out = safeCallbackPath(bad as string);
      assert.ok(out.startsWith("/") && !out.startsWith("//"), String(bad));
      assert.ok(!out.includes("evil.com") || out.startsWith("/%2F"), `${String(bad)} → ${out}`);
    }
  });
});

import { isPushEndpoint } from "../lib/push-endpoint";

describe("push endpoints (SSRF)", () => {
  it("accepts the browsers' push services", () => {
    for (const u of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x", "https://web.push.apple.com/QK"]) assert.ok(isPushEndpoint(u), u);
  });
  it("refuses anything else", () => {
    for (const u of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost/x", "https://fcm.googleapis.com.evil.com/x", "https://evil.com/push.apple.com", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "not a url"]) assert.ok(!isPushEndpoint(u), u);
  });
});

import { signatureMatches } from "../lib/upload-signatures";

describe("uploads: content must match the declared type", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const text = (s: string) => new TextEncoder().encode(s);
  it("accepts real signatures", () => {
    assert.ok(signatureMatches("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)));
    assert.ok(signatureMatches("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)));
    assert.ok(signatureMatches("application/pdf", text("%PDF-1.7")));
    assert.ok(signatureMatches("image/webp", text("RIFF\0\0\0\0WEBPVP8 ")));
    assert.ok(signatureMatches("text/plain", text("anything at all")));
  });
  it("refuses a disguise", () => {
    assert.ok(!signatureMatches("image/png", text("<script>alert(1)</script>")));
    assert.ok(!signatureMatches("application/pdf", text("<html><body>")));
    assert.ok(!signatureMatches("image/jpeg", text("GIF89a")));
    assert.ok(!signatureMatches("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", text("=cmd|' /C calc'!A0")));
  });
});
