/**
 * Response hardening (CLAUDE.md §6; Phase 10). Pure and edge-safe: the
 * middleware applies it to every response it sees, and a unit test pins it.
 *
 * Scripts run only with this response's nonce (`'strict-dynamic'` lets
 * Next's own chunks load what they need); there is no `'unsafe-inline'` for
 * scripts. Styles allow inline because React style attributes and the
 * charts need them — style injection can't run code. Everything else is
 * same-origin; the app is never framed.
 */

export function contentSecurityPolicy(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    // `'unsafe-eval'` only in development: React's dev build uses eval for
    // stack reconstruction. Never in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Development: the hot-reload socket.
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Sent on every response the middleware sees, pages and API alike. */
export function baseSecurityHeaders({ dev = false }: { dev?: boolean } = {}): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    // Two years, subdomains, preload-ready — only over HTTPS in production.
    ...(dev ? {} : { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" }),
  };
}

/** Page responses (HTML) additionally: the CSP, and never framed. */
export function pageSecurityHeaders(nonce: string, options: { dev?: boolean } = {}): Record<string, string> {
  return {
    ...baseSecurityHeaders(options),
    "Content-Security-Policy": contentSecurityPolicy(nonce, options),
    "X-Frame-Options": "DENY",
  };
}

/**
 * Paths that set their own, stricter headers (signed file downloads serve
 * user content inside a sandbox CSP) — the middleware leaves those alone.
 */
export const OWN_HEADERS = [/^\/f\//, /^\/api\/attachments\/[^/]+\/raw$/];

/** A fresh, unguessable nonce per response (base64 of 16 random bytes). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
