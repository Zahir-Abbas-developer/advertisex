import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { normalizeRole } from "@/config/permissions";
import {
  DEFAULT_SCHEDULE,
  datesInMonth,
  evaluateDay,
  localDate,
  parseWorkDays,
  summarize,
  type DayResult,
  type MonthSummary,
  type Schedule,
} from "@/modules/attendance/domain";

/**
 * Attendance reads and writes. Every number is computed by the pure engine
 * in `domain.ts`; this file only fetches the rows it needs and stores what a
 * person reports (clock in, breaks, clock out). Nothing derived is stored.
 *
 * Calendar days are the employee's own (their schedule's timezone), stored
 * at UTC midnight of that date — the convention every date-only column here
 * follows.
 */

export class AttendanceError extends Error {}

const dayKey = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** A person's schedule, or the default read in the company timezone. */
export async function scheduleFor(userId: string): Promise<Schedule> {
  const row = await prisma.workSchedule.findUnique({ where: { userId } });
  if (row) {
    return {
      timezone: row.timezone,
      workDays: parseWorkDays(row.workDays),
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      graceMinutes: row.graceMinutes,
    };
  }
  return { ...DEFAULT_SCHEDULE, timezone: await companyTimezone() };
}

async function assertTracked(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  const role = normalizeRole(user?.role);
  if (!user?.isActive || role === "AI_AGENT" || role === "CLIENT" || !role) {
    throw new AttendanceError("Attendance doesn't apply to this account.");
  }
}

async function dayRows(userId: string, from: string, to: string) {
  const [days, breaks, leave] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { userId, date: { gte: dayKey(from), lte: dayKey(to) } },
    }),
    prisma.breakSession.findMany({
      where: { userId, date: { gte: dayKey(from), lte: dayKey(to) } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { userId, status: "APPROVED", date: { gte: dayKey(from), lte: dayKey(to) } },
      select: { date: true },
    }),
  ]);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    day: (date: string) => days.find((d) => iso(d.date) === date) ?? null,
    breaks: (date: string) => breaks.filter((b) => iso(b.date) === date),
    onLeave: (date: string) => leave.some((l) => iso(l.date) === date),
  };
}

export type TodayView = {
  date: string;
  schedule: Schedule;
  result: DayResult;
  clockInAt: string | null;
  clockOutAt: string | null;
  onBreak: boolean;
  breaks: { startedAt: string; endedAt: string | null }[];
};

export async function today(userId: string, now = new Date()): Promise<TodayView> {
  const schedule = await scheduleFor(userId);
  const date = localDate(now, schedule.timezone);
  const rows = await dayRows(userId, date, date);
  const day = rows.day(date);
  const breaks = rows.breaks(date);
  const result = evaluateDay(
    { date, clockInAt: day?.clockInAt ?? null, clockOutAt: day?.clockOutAt ?? null, breaks, onLeave: rows.onLeave(date) },
    schedule,
    now,
  );
  return {
    date,
    schedule,
    result,
    clockInAt: day?.clockInAt?.toISOString() ?? null,
    clockOutAt: day?.clockOutAt?.toISOString() ?? null,
    onBreak: breaks.some((b) => !b.endedAt),
    breaks: breaks.map((b) => ({ startedAt: b.startedAt.toISOString(), endedAt: b.endedAt?.toISOString() ?? null })),
  };
}

/** One working span per day: clock in once, take breaks, clock out once. */
export async function clockIn(userId: string, now = new Date()) {
  await assertTracked(userId);
  const schedule = await scheduleFor(userId);
  const date = localDate(now, schedule.timezone);
  const existing = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dayKey(date) } },
  });
  if (existing?.clockInAt && !existing.clockOutAt) throw new AttendanceError("You're already clocked in.");
  if (existing?.clockOutAt) throw new AttendanceError("You've already clocked out today.");

  return existing
    ? prisma.attendanceDay.update({ where: { id: existing.id }, data: { clockInAt: now } })
    : prisma.attendanceDay.create({ data: { userId, date: dayKey(date), clockInAt: now } });
}

export async function clockOut(userId: string, now = new Date()) {
  await assertTracked(userId);
  const schedule = await scheduleFor(userId);
  const date = localDate(now, schedule.timezone);
  const day = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dayKey(date) } },
  });
  if (!day?.clockInAt) throw new AttendanceError("You haven't clocked in today.");
  if (day.clockOutAt) throw new AttendanceError("You've already clocked out today.");

  // An open break ends when the day does.
  await prisma.breakSession.updateMany({
    where: { userId, date: dayKey(date), endedAt: null },
    data: { endedAt: now },
  });
  return prisma.attendanceDay.update({ where: { id: day.id }, data: { clockOutAt: now } });
}

export async function startBreak(userId: string, now = new Date()) {
  await assertTracked(userId);
  const schedule = await scheduleFor(userId);
  const date = localDate(now, schedule.timezone);
  const day = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: dayKey(date) } },
  });
  if (!day?.clockInAt || day.clockOutAt) throw new AttendanceError("Breaks happen between clocking in and out.");
  const open = await prisma.breakSession.findFirst({ where: { userId, date: dayKey(date), endedAt: null } });
  if (open) throw new AttendanceError("You're already on a break.");
  return prisma.breakSession.create({ data: { userId, date: dayKey(date), reason: "Break", startedAt: now } });
}

export async function endBreak(userId: string, now = new Date()) {
  await assertTracked(userId);
  const open = await prisma.breakSession.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: "desc" } });
  if (!open) throw new AttendanceError("You're not on a break.");
  return prisma.breakSession.update({
    where: { id: open.id },
    data: { endedAt: now, minutes: Math.max(0, Math.round((now.getTime() - open.startedAt.getTime()) / 60_000)) },
  });
}

export type MonthView = { month: string; schedule: Schedule; days: DayResult[]; summary: MonthSummary };

export async function month(userId: string, monthKey: string, now = new Date()): Promise<MonthView> {
  const schedule = await scheduleFor(userId);
  const dates = datesInMonth(monthKey);
  const rows = await dayRows(userId, dates[0], dates[dates.length - 1]);
  const today = localDate(now, schedule.timezone);
  const days = dates
    // A month view never predicts the future: days after today are left out.
    .filter((date) => date <= today)
    .map((date) => {
      const day = rows.day(date);
      return evaluateDay(
        {
          date,
          clockInAt: day?.clockInAt ?? null,
          clockOutAt: day?.clockOutAt ?? null,
          breaks: rows.breaks(date),
          onLeave: rows.onLeave(date),
        },
        schedule,
        now,
      );
    });
  return { month: monthKey, schedule, days, summary: summarize(days) };
}

/** "YYYY-MM" for an instant on a timezone's calendar. */
export function monthOf(now: Date, timezone: string): string {
  return localDate(now, timezone).slice(0, 7);
}

export function isMonthKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}
