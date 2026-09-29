/**
 * Browser push endpoints are URLs the server POSTs to, so a client-supplied
 * one is an SSRF vector (Phase 10). Only HTTPS on the real push services'
 * hosts is accepted — the four browsers' services cover every subscriber.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  return PUSH_HOSTS.some((re) => re.test(url.hostname.toLowerCase()));
}
