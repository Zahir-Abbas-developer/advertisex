import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agingBucket, agingOf, breakdown, bucketOf, bucketsBetween, delta, periodBounds, rate, rateDelta, retentionOf, series } from "../modules/analytics/domain";

describe("command center periods", () => {
  it("compares like with like: the same number of days immediately before", () => {
    assert.deepEqual(periodBounds("7d", "2026-09-28"), { from: "2026-09-22", to: "2026-09-28", prevFrom: "2026-09-15", prevTo: "2026-09-21", days: 7, granularity: "day" });
    const m = periodBounds("month", "2026-09-10");
    assert.equal(m.from, "2026-09-01");
    assert.equal(m.days, 10);
    assert.deepEqual([m.prevFrom, m.prevTo], ["2026-08-22", "2026-08-31"], "ten days before, not all of August");
    assert.equal(periodBounds("90d", "2026-09-28").granularity, "week");
    assert.equal(periodBounds("year", "2026-09-28").granularity, "month");
    assert.equal(periodBounds("quarter", "2026-08-05").from, "2026-07-01");
  });

  it("buckets days, ISO weeks (Mondays) and months, with no gaps", () => {
    assert.equal(bucketOf("2026-09-27", "week"), "2026-09-21", "a Sunday belongs to the Monday before");
    assert.equal(bucketOf("2026-09-28", "week"), "2026-09-28");
    assert.equal(bucketOf("2026-09-28", "month"), "2026-09");
    assert.deepEqual(bucketsBetween("2026-09-26", "2026-09-29", "day"), ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]);
    const b = periodBounds("7d", "2026-09-28");
    const s = series(["2026-09-22", "2026-09-22", "2026-09-28", "2026-09-10"], (k) => k, b);
    assert.equal(s.length, 7);
    assert.equal(s.reduce((t, p) => t + p.value, 0), 3, "rows outside the period don't count");
  });

  it("states changes honestly", () => {
    assert.deepEqual(delta(12, 10), { value: 12, previous: 10, change: 2, percent: 20, direction: "up" });
    assert.equal(delta(5, 0).percent, null, "no percentage from zero");
    assert.equal(delta(8, 10).direction, "down");
    assert.equal(rate(1, 3), 33);
    assert.equal(rate(0, 0), null);
    const r = rateDelta(40, 50);
    assert.equal(r.change, -10);
    assert.equal(r.percent, null, "a rate's change is in points, not percent");
    assert.equal(rateDelta(null, 50).available, false);
  });

  it("keeps breakdowns whole with an Other bucket", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, value: 10 - i }));
    const b = breakdown(rows, 4);
    assert.equal(b.length, 4);
    assert.equal(b[3].key, "other");
    assert.equal(b.reduce((s, r) => s + r.value, 0), rows.reduce((s, r) => s + r.value, 0));
  });
});

describe("retention and receivables", () => {
  const c = (id: string, start: string, churn: string | null = null, status = "ACTIVE") => ({ id, name: id, status, startKey: start, churnKey: churn });

  it("measures retention on the cohort present at the start", () => {
    const r = retentionOf([c("a", "2026-01-10"), c("b", "2026-02-01", "2026-08-15", "CHURNED"), c("c", "2026-03-01", "2026-06-01", "CHURNED"), c("d", "2026-07-20"), c("e", "2026-07-01", null, "LEAD")], "2026-07-01", "2026-09-30");
    assert.equal(r.activeAtStart, 2, "a and b; c had already left; d started later; e is a prospect");
    assert.equal(r.retained, 1);
    assert.equal(r.retentionRate, 50);
    assert.equal(r.added, 1);
    assert.deepEqual(r.churned.map((x) => x.id), ["b"]);
    assert.equal(r.activeNow, 2);
  });

  it("ages open balances; the buckets sum to the total", () => {
    assert.equal(agingBucket("2026-09-28", "2026-09-28"), "current");
    assert.equal(agingBucket("2026-09-27", "2026-09-28"), "1-30");
    assert.equal(agingBucket("2026-06-01", "2026-09-28"), "90+");
    const a = agingOf(
      [
        { clientId: "x", clientName: "X", dueKey: "2026-10-05", balanceMinor: 100 },
        { clientId: "x", clientName: "X", dueKey: "2026-08-01", balanceMinor: 250 },
        { clientId: "y", clientName: "Y", dueKey: "2026-09-20", balanceMinor: 75 },
      ],
      "2026-09-28",
    );
    assert.equal(a.totalMinor, 425);
    assert.equal(a.buckets.reduce((s, b) => s + b.amountMinor, 0), 425);
    assert.equal(a.byClient[0].clientId, "x");
    assert.equal(a.byClient[0].lateMinor, 250);
    assert.equal(a.byClient[0].oldest, "31-60");
  });
});
