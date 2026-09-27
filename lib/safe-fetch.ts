/**
 * `fetch` for the app's own API from the browser, where a network failure
 * becomes an ordinary 503 response with the usual `{ error }` body instead of
 * a thrown exception. Every caller already handles `!res.ok` — so a dropped
 * connection shows a message and releases the button, rather than leaving a
 * spinner running and a modal that can't be closed.
 */
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    return new Response(JSON.stringify({ error: "We couldn't reach the server. Check your connection and try again." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
