import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPANY_TIMEZONE,
  companyDayRange,
  rangeFromQuery,
  dueDeadline,
  parseDateInput,
  toDateOnly,
  utcOffsetHours,
} from "../lib/date";

/**
 * The company clock.
 *
 * These exist because the timezone arithmetic had no tests at all, and that is
 * how it survived being wrong: `lib/date.ts` hardcoded `Asia/Karachi` and a
 * fixed `UTC+5` offset long after CLAUDE.md made the timezone a company setting
 * defaulting to `America/New_York`. The whole suite passed while every due date
 * in the product was on the wrong clock, because nothing looked.
 *
 * The offset one matters most. Karachi is +5 all year, so a constant was fine;
 * New York is -5 in winter and -4 on daylight time, so a constant is wrong for
 * half the year — and "half the year" is the kind of bug that gets found in
 * March by somebody whose deadline moved.
 */

describe("company timezone", () => {
  it("defaults to the zone CLAUDE.md specifies", () => {
    assert.equal(COMPANY_TIMEZONE, "America/New_York");
  });
});

describe("utcOffsetHours", () => {
  it("reads New York as UTC-5 on a winter date", () => {
    assert.equal(utcOffsetHours(new Date("2026-01-15T12:00:00Z"), "America/New_York"), -5);
  });

  it("reads New York as UTC-4 on a summer date", () => {
    // The bug a fixed offset cannot express: same zone, different offset.
    assert.equal(utcOffsetHours(new Date("2026-07-15T12:00:00Z"), "America/New_York"), -4);
  });

  it("reads Karachi as UTC+5 in both", () => {
    assert.equal(utcOffsetHours(new Date("2026-01-15T12:00:00Z"), "Asia/Karachi"), 5);
    assert.equal(utcOffsetHours(new Date("2026-07-15T12:00:00Z"), "Asia/Karachi"), 5);
  });

  it("reads UTC as zero", () => {
    assert.equal(utcOffsetHours(new Date("2026-03-01T00:00:00Z"), "UTC"), 0);
  });
});

describe("dueDeadline", () => {
  it("lands on local midnight after a winter due date", () => {
    // Due 15 January in New York → 05:00 UTC on the 16th.
    const deadline = dueDeadline(parseDateInput("2026-01-15")!, "America/New_York");
    assert.equal(deadline.toISOString(), "2026-01-16T05:00:00.000Z");
  });

  it("lands on local midnight after a summer due date", () => {
    // Same calendar position, one hour earlier in UTC, because of DST. A fixed
    // offset would put this at 05:00 and call work late an hour before it is.
    const deadline = dueDeadline(parseDateInput("2026-07-15")!, "America/New_York");
    assert.equal(deadline.toISOString(), "2026-07-16T04:00:00.000Z");
  });

  it("is still correct for a zone that never shifts", () => {
    const deadline = dueDeadline(parseDateInput("2026-07-15")!, "Asia/Karachi");
    assert.equal(deadline.toISOString(), "2026-07-15T19:00:00.000Z");
  });

  it("is always after the start of its own day", () => {
    for (const day of ["2026-01-15", "2026-03-08", "2026-07-15", "2026-11-01"]) {
      const parsed = parseDateInput(day)!;
      assert.ok(
        dueDeadline(parsed, "America/New_York").getTime() > toDateOnly(parsed).getTime(),
        `${day} deadline should fall after the day it belongs to`,
      );
    }
  });
});

describe("companyDayRange / rangeFromQuery — date filters on the company calendar", () => {
  it("a New York day runs from 04:00Z to 03:59:59.999Z next day in summer", () => {
    const r = companyDayRange("2026-09-26", "America/New_York")!;
    assert.equal(r.start.toISOString(), "2026-09-26T04:00:00.000Z");
    assert.equal(r.end.toISOString(), "2026-09-27T03:59:59.999Z");
  });

  it("uses standard time in winter", () => {
    assert.equal(companyDayRange("2026-01-15", "America/New_York")!.start.toISOString(), "2026-01-15T05:00:00.000Z");
  });

  it("a day that starts a daylight-saving change is 23 hours long", () => {
    const r = companyDayRange("2026-03-08", "America/New_York")!;
    assert.equal(r.start.toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(r.end.toISOString(), "2026-03-09T03:59:59.999Z");
  });

  it("handles half-hour zones to the minute", () => {
    assert.equal(companyDayRange("2026-09-26", "Asia/Kolkata")!.start.toISOString(), "2026-09-25T18:30:00.000Z");
  });

  it("refuses malformed or impossible dates", () => {
    assert.equal(companyDayRange("2026-02-30"), null);
    assert.equal(companyDayRange("26/09/2026"), null);
    assert.equal(companyDayRange(""), null);
  });

  it("rangeFromQuery defaults, and refuses reversed or oversized ranges", () => {
    const q = (s: string) => new URLSearchParams(s);
    const d = rangeFromQuery(q(""), 90, 400, "UTC")!;
    assert.equal(Math.round((d.to.getTime() - d.from.getTime()) / 86_400_000), 90);
    const r = rangeFromQuery(q("from=2026-09-01&to=2026-09-30"), 90, 400, "UTC")!;
    assert.equal(r.from.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(r.to.toISOString(), "2026-09-30T23:59:59.999Z");
    assert.equal(rangeFromQuery(q("from=2026-09-30&to=2026-09-01"), 90, 400, "UTC"), null);
    assert.equal(rangeFromQuery(q("from=2020-01-01&to=2026-09-01"), 90, 400, "UTC"), null);
    assert.equal(rangeFromQuery(q("from=bad"), 90, 400, "UTC"), null);
  });
});
