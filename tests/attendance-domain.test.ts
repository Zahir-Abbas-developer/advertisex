import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  breakMinutes,
  datesInMonth,
  evaluateDay,
  formatMinutes,
  localDate,
  localMinute,
  summarize,
  weekdayOf,
  type Schedule,
} from "../modules/attendance/domain";

/** 09:00–17:00 Mon–Fri, New York, 5 minutes' grace. */
const NY: Schedule = {
  timezone: "America/New_York",
  workDays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  graceMinutes: 5,
};

/** A wall-clock time in New York during EDT (UTC−4). */
const edt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`);
/** …and during EST (UTC−5). */
const est = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-05:00`);

// 2026-09-21 is a Monday.
const MON = "2026-09-21";
const SAT = "2026-09-26";
const LATER = edt("2026-09-30", "12:00");

describe("wall-clock helpers", () => {
  it("places an instant on the employee's calendar, not UTC's", () => {
    // 22:30 in New York is already the next day in UTC.
    const lateEvening = edt(MON, "22:30");
    assert.equal(localDate(lateEvening, NY.timezone), MON);
    assert.equal(localMinute(lateEvening, NY.timezone), 22 * 60 + 30);
  });

  it("knows the weekday of a calendar date", () => {
    assert.equal(weekdayOf(MON), 1);
    assert.equal(weekdayOf(SAT), 6);
    assert.equal(weekdayOf("2026-09-27"), 7);
  });

  it("lists every date of a month, leap years included", () => {
    assert.equal(datesInMonth("2026-09").length, 30);
    assert.equal(datesInMonth("2028-02").length, 29);
    assert.equal(datesInMonth("2026-09")[0], "2026-09-01");
  });

  it("formats minutes as hours and minutes", () => {
    assert.equal(formatMinutes(480), "8h 00m");
    assert.equal(formatMinutes(75), "1h 15m");
  });
});

describe("working hours", () => {
  it("is the span from clock-in to clock-out", () => {
    const day = evaluateDay(
      { date: MON, clockInAt: edt(MON, "09:00"), clockOutAt: edt(MON, "17:00"), breaks: [] },
      NY,
      LATER,
    );
    assert.equal(day.workedMinutes, 480);
    assert.equal(day.status, "PRESENT");
  });

  it("subtracts breaks", () => {
    const day = evaluateDay(
      {
        date: MON,
        clockInAt: edt(MON, "09:00"),
        clockOutAt: edt(MON, "17:00"),
        breaks: [{ startedAt: edt(MON, "12:00"), endedAt: edt(MON, "12:45") }],
      },
      NY,
      LATER,
    );
    assert.equal(day.breakMinutes, 45);
    assert.equal(day.workedMinutes, 435);
  });

  it("counts a day still in progress up to now", () => {
    const now = edt(MON, "11:30");
    const day = evaluateDay({ date: MON, clockInAt: edt(MON, "09:00"), clockOutAt: null, breaks: [] }, NY, now);
    assert.equal(day.status, "IN_PROGRESS");
    assert.equal(day.workedMinutes, 150);
  });

  it("is correct across a DST change — 8 wall-clock hours are 8 hours", () => {
    // 2026-11-01: clocks go back in New York. A Monday after it, in EST.
    const date = "2026-11-02";
    const day = evaluateDay(
      { date, clockInAt: est(date, "09:00"), clockOutAt: est(date, "17:00"), breaks: [] },
      NY,
      est("2026-11-10", "12:00"),
    );
    assert.equal(day.workedMinutes, 480);
    assert.equal(day.lateMinutes, 0);
  });

  it("never goes negative", () => {
    const day = evaluateDay(
      {
        date: MON,
        clockInAt: edt(MON, "09:00"),
        clockOutAt: edt(MON, "09:30"),
        breaks: [{ startedAt: edt(MON, "08:00"), endedAt: edt(MON, "12:00") }],
      },
      NY,
      LATER,
    );
    assert.equal(day.workedMinutes, 0);
  });
});

describe("breaks", () => {
  const start = edt(MON, "09:00");
  const end = edt(MON, "17:00");

  it("sums several breaks", () => {
    assert.equal(
      breakMinutes(
        [
          { startedAt: edt(MON, "10:30"), endedAt: edt(MON, "10:45") },
          { startedAt: edt(MON, "13:00"), endedAt: edt(MON, "13:30") },
        ],
        start,
        end,
      ),
      45,
    );
  });

  it("counts an open break up to the end of the span", () => {
    assert.equal(breakMinutes([{ startedAt: edt(MON, "16:30"), endedAt: null }], start, end), 30);
  });

  it("ignores the parts of a break outside the worked span", () => {
    assert.equal(breakMinutes([{ startedAt: edt(MON, "08:30"), endedAt: edt(MON, "09:15") }], start, end), 15);
    assert.equal(breakMinutes([{ startedAt: edt(MON, "18:00"), endedAt: edt(MON, "18:30") }], start, end), 0);
  });
});

describe("late arrival", () => {
  const day = (hhmm: string) =>
    evaluateDay({ date: MON, clockInAt: edt(MON, hhmm), clockOutAt: edt(MON, "17:00"), breaks: [] }, NY, LATER);

  it("is on time within the grace period", () => {
    assert.equal(day("09:05").lateMinutes, 0);
    assert.equal(day("09:05").status, "PRESENT");
  });

  it("is late past the grace period, measured from the scheduled start", () => {
    assert.equal(day("09:06").lateMinutes, 6);
    assert.equal(day("09:40").lateMinutes, 40);
    assert.equal(day("09:40").status, "LATE");
  });

  it("is never late on an unscheduled day", () => {
    const saturday = evaluateDay({ date: SAT, clockInAt: edt(SAT, "11:00"), clockOutAt: edt(SAT, "13:00"), breaks: [] }, NY, LATER);
    assert.equal(saturday.lateMinutes, 0);
    assert.equal(saturday.status, "PRESENT");
    assert.equal(saturday.workedMinutes, 120);
  });

  it("follows the schedule's own timezone", () => {
    const london: Schedule = { ...NY, timezone: "Europe/London" };
    // 09:00 in London is 04:00 in New York.
    const d = evaluateDay(
      { date: MON, clockInAt: new Date(`${MON}T09:00:00+01:00`), clockOutAt: new Date(`${MON}T17:00:00+01:00`), breaks: [] },
      london,
      LATER,
    );
    assert.equal(d.lateMinutes, 0);
  });
});

describe("early departure", () => {
  it("is the time left before the scheduled end", () => {
    const d = evaluateDay({ date: MON, clockInAt: edt(MON, "09:00"), clockOutAt: edt(MON, "16:15"), breaks: [] }, NY, LATER);
    assert.equal(d.earlyDepartureMinutes, 45);
  });

  it("is zero when leaving at or after the end", () => {
    const d = evaluateDay({ date: MON, clockInAt: edt(MON, "09:00"), clockOutAt: edt(MON, "17:30"), breaks: [] }, NY, LATER);
    assert.equal(d.earlyDepartureMinutes, 0);
  });

  it("is not counted while the day is still in progress", () => {
    const d = evaluateDay({ date: MON, clockInAt: edt(MON, "09:00"), clockOutAt: null, breaks: [] }, NY, edt(MON, "12:00"));
    assert.equal(d.earlyDepartureMinutes, 0);
  });
});

describe("absence", () => {
  it("is a scheduled day that ended with no clock-in", () => {
    const d = evaluateDay({ date: MON, clockInAt: null, clockOutAt: null, breaks: [] }, NY, LATER);
    assert.equal(d.status, "ABSENT");
  });

  it("is not yet absence on the morning of the day", () => {
    const d = evaluateDay({ date: MON, clockInAt: null, clockOutAt: null, breaks: [] }, NY, edt(MON, "10:00"));
    assert.equal(d.status, "UPCOMING");
  });

  it("becomes absence once the scheduled day is over", () => {
    const d = evaluateDay({ date: MON, clockInAt: null, clockOutAt: null, breaks: [] }, NY, edt(MON, "17:01"));
    assert.equal(d.status, "ABSENT");
  });

  it("is never absence on a day off or on approved leave", () => {
    assert.equal(evaluateDay({ date: SAT, clockInAt: null, clockOutAt: null, breaks: [] }, NY, LATER).status, "OFF");
    assert.equal(evaluateDay({ date: MON, clockInAt: null, clockOutAt: null, breaks: [], onLeave: true }, NY, LATER).status, "ON_LEAVE");
  });
});

describe("month summary", () => {
  const week = [
    evaluateDay({ date: "2026-09-21", clockInAt: edt("2026-09-21", "09:00"), clockOutAt: edt("2026-09-21", "17:00"), breaks: [] }, NY, LATER),
    evaluateDay({ date: "2026-09-22", clockInAt: edt("2026-09-22", "09:30"), clockOutAt: edt("2026-09-22", "17:00"), breaks: [] }, NY, LATER),
    evaluateDay({ date: "2026-09-23", clockInAt: null, clockOutAt: null, breaks: [] }, NY, LATER),
    evaluateDay({ date: "2026-09-24", clockInAt: null, clockOutAt: null, breaks: [], onLeave: true }, NY, LATER),
    evaluateDay({ date: "2026-09-25", clockInAt: edt("2026-09-25", "09:00"), clockOutAt: edt("2026-09-25", "16:00"), breaks: [] }, NY, LATER),
    evaluateDay({ date: "2026-09-26", clockInAt: null, clockOutAt: null, breaks: [] }, NY, LATER),
  ];
  const summary = summarize(week);

  it("counts each kind of day", () => {
    assert.equal(summary.scheduledDays, 5);
    assert.equal(summary.presentDays, 3);
    assert.equal(summary.lateDays, 1);
    assert.equal(summary.absentDays, 1);
    assert.equal(summary.leaveDays, 1);
    assert.equal(summary.earlyDepartureDays, 1);
  });

  it("totals worked and scheduled hours", () => {
    assert.equal(summary.workedMinutes, 480 + 450 + 420);
    assert.equal(summary.scheduledMinutes, 5 * 480);
  });

  it("excludes leave from the attendance-rate denominator", () => {
    // 3 worked of 4 scheduled days that were not leave.
    assert.equal(summary.attendanceRate, 3 / 4);
  });

  it("measures punctuality over days actually worked", () => {
    assert.equal(summary.punctualityRate, 2 / 3);
  });

  it("returns null rates, not zero, when there is nothing to measure", () => {
    const empty = summarize([]);
    assert.equal(empty.attendanceRate, null);
    assert.equal(empty.punctualityRate, null);
  });
});
