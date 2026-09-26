/**
 * Structured logging, without a dependency.
 *
 * Every line is one JSON object on stdout/stderr in production — what Vercel's
 * log drain, and any future collector, actually parses — and a readable prefix
 * in development, where a human is the collector. Fields beat prose: a
 * `{ event: "cron.followups", skipped: 4 }` can be counted and alerted on; a
 * sentence cannot.
 *
 * This is the *diagnostic* stream. It never replaces the two records the
 * product keeps for people: `lib/audit.ts` (who exercised authority) and
 * `lib/system-errors.ts` (what broke, shown at /admin/errors — our
 * Sentry-equivalent until an external collector is earned; ADR pending the
 * day traffic justifies one).
 *
 * `logger.error` deliberately does NOT write a SystemError row — callers that
 * want the admin-visible record call `recordSystemError` and say so, because
 * an automatic double-write would turn every retried job into a wall of
 * duplicate rows.
 */

type Level = "debug" | "info" | "warn" | "error";

type Fields = Record<string, unknown>;

const IS_PROD = process.env.NODE_ENV === "production";

function write(level: Level, event: string, fields: Fields): void {
  // debug lines are development-only by contract.
  if (level === "debug" && IS_PROD) return;

  const sink = level === "error" || level === "warn" ? console.error : console.log;

  if (IS_PROD) {
    sink(
      JSON.stringify({
        level,
        event,
        time: new Date().toISOString(),
        ...fields,
      }),
    );
    return;
  }

  const extras = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  sink(`[${level}] ${event}${extras}`);
}

/** Serialise an unknown thrown value into loggable fields. */
export function errorFields(error: unknown): Fields {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

export const logger = {
  debug: (event: string, fields: Fields = {}) => write("debug", event, fields),
  info: (event: string, fields: Fields = {}) => write("info", event, fields),
  warn: (event: string, fields: Fields = {}) => write("warn", event, fields),
  error: (event: string, fields: Fields = {}) => write("error", event, fields),

  /** A logger that stamps every line with the same context, e.g. one job run. */
  child(context: Fields) {
    return {
      debug: (event: string, fields: Fields = {}) => write("debug", event, { ...context, ...fields }),
      info: (event: string, fields: Fields = {}) => write("info", event, { ...context, ...fields }),
      warn: (event: string, fields: Fields = {}) => write("warn", event, { ...context, ...fields }),
      error: (event: string, fields: Fields = {}) => write("error", event, { ...context, ...fields }),
    };
  },
};
