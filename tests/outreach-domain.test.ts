import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OUTREACH_KINDS,
  bucketOf,
  outreachKindOf,
  rollup,
  sumCounts,
  type ActivityRow,
} from "../modules/outreach/domain";

const NY = "America/New_York";

/** A deterministic month of activity: 3 people, every type, some noise. */
function fixture(): ActivityRow[] {
  const types = ["COLD_CALL", "EMAIL_SENT", "EMAIL_REPLY", "FOLLOW_UP", "MEETING_BOOKED", "MEETING_HELD", "PROPOSAL_SENT", "DEAL_CLOSED", "NOTE", "STATUS_CHANGE", "CALL", "QUOTE"];
  const users = ["u-a", "u-b", "u-c"];
  const rows: ActivityRow[] = [];
  let n = 0;
  for (let day = 1; day <= 30; day++) {
    for (const [i, type] of types.entries()) {
      if ((day + i) % 3 === 0) continue;
      rows.push({ type, userId: users[(day + i) % 3], occurredAt: new Date(Date.UTC(2026, 8, day, 14 + (n++ % 9))) });
    }
  }
  return rows;
}

describe("outreach kinds", () => {
  it("maps each explicit type to its kind", () => {
    assert.equal(outreachKindOf("COLD_CALL"), "coldCalls");
    assert.equal(outreachKindOf("EMAIL_REPLY"), "emailsReplied");
    assert.equal(outreachKindOf("MEETING_BOOKED"), "meetingsBooked");
    assert.equal(outreachKindOf("MEETING_HELD"), "meetingsCompleted");
    assert.equal(outreachKindOf("DEAL_CLOSED"), "dealsClosed");
  });

  it("keeps counting history logged with the older generic types", () => {
    assert.equal(outreachKindOf("CALL"), "coldCalls");
    assert.equal(outreachKindOf("EMAIL"), "emailsSent");
    assert.equal(outreachKindOf("MEETING"), "meetingsCompleted");
    assert.equal(outreachKindOf("QUOTE"), "proposalsSent");
  });

  it("counts notes and system entries as no outreach at all", () => {
    for (const t of ["NOTE", "OTHER", "STATUS_CHANGE", "ASSIGNMENT", "SOMETHING_NEW"]) assert.equal(outreachKindOf(t), null);
  });
});

describe("buckets on the company calendar", () => {
  it("puts a late-evening New York activity on its New York day, not UTC's", () => {
    // 23:30 in New York on the 25th is already the 26th in UTC.
    assert.equal(bucketOf(new Date("2026-09-26T03:30:00Z"), "day", NY), "2026-09-25");
  });

  it("starts weeks on Monday", () => {
    assert.equal(bucketOf(new Date("2026-09-26T15:00:00Z"), "week", NY), "2026-09-21"); // Saturday
    assert.equal(bucketOf(new Date("2026-09-27T15:00:00Z"), "week", NY), "2026-09-21"); // Sunday
    assert.equal(bucketOf(new Date("2026-09-28T15:00:00Z"), "week", NY), "2026-09-28"); // Monday
  });

  it("handles a week that spans a month and a year boundary", () => {
    assert.equal(bucketOf(new Date("2027-01-01T15:00:00Z"), "week", NY), "2026-12-28");
  });

  it("buckets months by the local month", () => {
    assert.equal(bucketOf(new Date("2026-10-01T02:00:00Z"), "month", NY), "2026-09");
  });
});

describe("rollups reconcile exactly with the logged activities", () => {
  const rows = fixture();
  const counted = rows.filter((r) => outreachKindOf(r.type) !== null);

  for (const period of ["day", "week", "month"] as const) {
    it(`${period}: Σ buckets = Σ people = total = counted rows`, () => {
      const r = rollup(rows, period, NY);
      const fromBuckets = r.buckets.reduce((t, b) => t + sumCounts(b.total), 0);
      const fromPeople = Object.values(r.byUser).reduce((t, c) => t + sumCounts(c), 0);
      assert.equal(sumCounts(r.total), counted.length);
      assert.equal(fromBuckets, counted.length);
      assert.equal(fromPeople, counted.length);
    });

    it(`${period}: each bucket's people add up to that bucket`, () => {
      for (const b of rollup(rows, period, NY).buckets) {
        for (const kind of OUTREACH_KINDS) {
          const people = Object.values(b.byUser).reduce((t, c) => t + c[kind], 0);
          assert.equal(people, b.total[kind], `${b.key} ${kind}`);
        }
      }
    });
  }

  it("matches a hand count for one person and one kind", () => {
    const expected = counted.filter((r) => r.userId === "u-b" && (r.type === "COLD_CALL" || r.type === "CALL")).length;
    assert.equal(rollup(rows, "month", NY).byUser["u-b"].coldCalls, expected);
  });

  it("lists buckets newest first", () => {
    const keys = rollup(rows, "day", NY).buckets.map((b) => b.key);
    assert.deepEqual(keys, [...keys].sort().reverse());
  });

  it("is empty, not undefined, with nothing logged", () => {
    const r = rollup([], "week", NY);
    assert.equal(sumCounts(r.total), 0);
    assert.deepEqual(r.buckets, []);
  });
});
