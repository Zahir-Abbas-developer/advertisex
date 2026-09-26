/**
 * The attendance engine — every number on every attendance screen comes from
 * here, and every formula here is written out in docs/METRICS.md and pinned
 * by tests/attendance-domain.test.ts.
 *
 * Pure: no database, no clock. Callers pass `now`, so "today" and "still
 * clocked in" are testable, and the same inputs always give the same answer.
 *
 * Time is the employee's own. A schedule names an IANA timezone, and every
 * comparison — which calendar day a clock-in belongs to, whether 09:07 is
 * late — happens on that wall clock, DST included. Instants are stored as UTC;
 * nothing here assumes a fixed offset.
 *
 * Deliberately *not* here: surveillance. No activity pings, no random checks.
 * Attendance records what a person reports (clock in, breaks, clock out) and
 * compares it to the schedule they agreed; it does not try to catch them out.
 */

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Schedule = {
  /** IANA name, e.g. "America/New_York". */
  timezone: string;
  workDays: readonly Weekday[];
  /** Minutes past local midnight. */
  startMinute: number;
  endMinute: number;
  /** Arrivals within this many minutes of the start are on time. */
  graceMinutes: number;
};

export type BreakSpan = { startedAt: Date; endedAt: Date | null };

export type DayInput = {
  /** Local calendar date, YYYY-MM-DD, in the schedule's timezone. */
  date: string;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  breaks: readonly BreakSpan[];
  /** An approved leave day. */
  onLeave?: boolean;
};

export type DayStatus =
  | "OFF" // not a scheduled day, and not worked
  | "UPCOMING" // a scheduled day that has not started yet
  | "IN_PROGRESS" // clocked in, not yet out
  | "PRESENT" // worked, on time
  | "LATE" // worked, arrived after start + grace
  | "ABSENT" // scheduled, over, never clocked in
  | "ON_LEAVE";

export type DayResult = {
  date: string;
  status: DayStatus;
  scheduled: boolean;
  scheduledMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
};

export const DEFAULT_SCHEDULE: Schedule = {
  timezone: "America/New_York",
  workDays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  graceMinutes: 5,
};

// ---------------------------------------------------------------------------
// Wall-clock helpers
// ---------------------------------------------------------------------------

function parts(instant: Date, timezone: string) {
  const fields = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => fields.find((f) => f.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** The calendar date an instant falls on, on the employee's wall clock. */
export function localDate(instant: Date, timezone: string): string {
  return parts(instant, timezone).date;
}

/** Minutes past local midnight on the employee's wall clock. */
export function localMinute(instant: Date, timezone: string): number {
  return parts(instant, timezone).minute;
}

/** ISO weekday of a YYYY-MM-DD calendar date (timezone-free by construction). */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (day === 0 ? 7 : day) as Weekday;
}

export function isWorkDay(date: string, schedule: Schedule): boolean {
  return schedule.workDays.includes(weekdayOf(date));
}

/** Every calendar date in a month, "YYYY-MM" → ["YYYY-MM-01", …]. */
export function datesInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

const minutesBetween = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

// ---------------------------------------------------------------------------
// One day
// ---------------------------------------------------------------------------

/**
 * Break minutes inside the worked span. A break still open counts up to the
 * end of the span (clock-out, or `now` while the day is in progress); parts of
 * a break outside the span never count.
 */
export function breakMinutes(
  breaks: readonly BreakSpan[],
  spanStart: Date,
  spanEnd: Date,
): number {
  let total = 0;
  for (const span of breaks) {
    const from = span.startedAt > spanStart ? span.startedAt : spanStart;
    const rawTo = span.endedAt ?? spanEnd;
    const to = rawTo < spanEnd ? rawTo : spanEnd;
    if (to > from) total += minutesBetween(from, to);
  }
  return total;
}

export function evaluateDay(day: DayInput, schedule: Schedule, now: Date): DayResult {
  const scheduled = isWorkDay(day.date, schedule);
  const scheduledMinutes = scheduled ? Math.max(0, schedule.endMinute - schedule.startMinute) : 0;
  const base = {
    date: day.date,
    scheduled,
    scheduledMinutes,
    workedMinutes: 0,
    breakMinutes: 0,
    lateMinutes: 0,
    earlyDepartureMinutes: 0,
  };

  if (!day.clockInAt) {
    if (day.onLeave) return { ...base, status: "ON_LEAVE" };
    if (!scheduled) return { ...base, status: "OFF" };

    const today = localDate(now, schedule.timezone);
    const over =
      day.date < today ||
      (day.date === today && localMinute(now, schedule.timezone) >= schedule.endMinute);
    return { ...base, status: over ? "ABSENT" : "UPCOMING" };
  }

  const spanEnd = day.clockOutAt ?? now;
  const breaks = breakMinutes(day.breaks, day.clockInAt, spanEnd);
  const worked = Math.max(0, minutesBetween(day.clockInAt, spanEnd) - breaks);

  // Lateness and early departure only mean something against a scheduled day.
  const arrival = localMinute(day.clockInAt, schedule.timezone);
  const late =
    scheduled && arrival > schedule.startMinute + schedule.graceMinutes
      ? arrival - schedule.startMinute
      : 0;

  let early = 0;
  if (scheduled && day.clockOutAt && localDate(day.clockOutAt, schedule.timezone) === day.date) {
    const departure = localMinute(day.clockOutAt, schedule.timezone);
    early = Math.max(0, schedule.endMinute - departure);
  }

  return {
    ...base,
    status: !day.clockOutAt ? "IN_PROGRESS" : late > 0 ? "LATE" : "PRESENT",
    workedMinutes: worked,
    breakMinutes: breaks,
    lateMinutes: late,
    earlyDepartureMinutes: early,
  };
}

// ---------------------------------------------------------------------------
// A month
// ---------------------------------------------------------------------------

export type MonthSummary = {
  scheduledDays: number;
  presentDays: number; // PRESENT + LATE (+ IN_PROGRESS today)
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  earlyDepartureDays: number;
  workedMinutes: number;
  scheduledMinutes: number;
  /** present ÷ (scheduled days that have happened − leave); null before any. */
  attendanceRate: number | null;
  /** on-time arrivals ÷ days worked; null when nothing was worked. */
  punctualityRate: number | null;
};

export function summarize(days: readonly DayResult[]): MonthSummary {
  const worked = days.filter((d) => d.status === "PRESENT" || d.status === "LATE" || d.status === "IN_PROGRESS");
  const scheduledElapsed = days.filter(
    (d) => d.scheduled && d.status !== "UPCOMING",
  );
  const leaveDays = days.filter((d) => d.status === "ON_LEAVE").length;
  const lateDays = days.filter((d) => d.lateMinutes > 0).length;
  const denominator = scheduledElapsed.length - scheduledElapsed.filter((d) => d.status === "ON_LEAVE").length;

  return {
    scheduledDays: days.filter((d) => d.scheduled).length,
    presentDays: worked.length,
    lateDays,
    absentDays: days.filter((d) => d.status === "ABSENT").length,
    leaveDays,
    earlyDepartureDays: days.filter((d) => d.earlyDepartureMinutes > 0).length,
    workedMinutes: days.reduce((sum, d) => sum + d.workedMinutes, 0),
    scheduledMinutes: days.reduce((sum, d) => sum + d.scheduledMinutes, 0),
    attendanceRate:
      denominator > 0
        ? Math.min(1, worked.filter((d) => d.scheduled).length / denominator)
        : null,
    punctualityRate: worked.length > 0 ? (worked.length - lateDays) / worked.length : null,
  };
}

/** "480" → "8h 00m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function parseWorkDays(stored: string): Weekday[] {
  return stored
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n): n is Weekday => Number.isInteger(n) && n >= 1 && n <= 7);
}
