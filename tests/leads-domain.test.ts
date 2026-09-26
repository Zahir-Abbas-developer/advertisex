import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STANDARD_STAGES,
  filtersToWhere,
  parseFilters,
  parseTags,
  serializeTags,
  stageVelocity,
} from "../modules/leads/domain";

describe("the standard pipeline", () => {
  it("is the Phase 3 stage list, in order, ending Won / Lost", () => {
    assert.deepEqual(
      STANDARD_STAGES.map((s) => s.label),
      ["New lead", "Contacted", "Qualified", "Meeting", "Proposal", "Negotiation", "Won", "Lost"],
    );
    assert.equal(STANDARD_STAGES.find((s) => s.key === "WON")?.kind, "WON");
    assert.equal(STANDARD_STAGES.find((s) => s.key === "LOST")?.kind, "LOST");
  });
});

describe("tags", () => {
  it("normalizes to trimmed, lower-case, unique", () => {
    assert.deepEqual(parseTags(" Brunch, VIP ,,brunch "), ["brunch", "vip"]);
    assert.equal(serializeTags(["Brunch", "vip", "BRUNCH"]), "brunch,vip");
  });
});

describe("filters", () => {
  it("drops an invalid saved view rather than trusting it", () => {
    assert.deepEqual(parseFilters({ stages: "WON" }), {});
    assert.deepEqual(parseFilters({ evil: true }), {});
  });

  it("builds a where for every filter", () => {
    const where = filtersToWhere({
      stages: ["QUALIFIED"],
      sources: ["REFERRAL"],
      ownerId: "u-1",
      minValue: 1000,
      maxValue: 5000,
      createdFrom: "2026-09-01",
      createdTo: "2026-09-30",
      tag: "vip",
      q: "bao",
    }) as { AND: Record<string, unknown>[] };
    assert.equal(where.AND.length, 9);
    assert.deepEqual(where.AND[0], { stage: { in: ["QUALIFIED"] } });
    // createdTo is inclusive: it runs to the start of the next day.
    assert.deepEqual(where.AND[6], { createdAt: { lt: new Date("2026-10-01T00:00:00.000Z") } });
  });

  it("reads 'none' as unassigned", () => {
    assert.deepEqual(filtersToWhere({ ownerId: "none" }), { AND: [{ ownerId: null }] });
  });

  it("is empty with no filters", () => {
    assert.deepEqual(filtersToWhere({}), {});
  });
});

describe("stage velocity", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 8, d));

  it("averages completed stays per stage", () => {
    const v = stageVelocity([
      { leadId: "a", toStage: "NEW_LEAD", at: day(1) },
      { leadId: "a", toStage: "CONTACTED", at: day(3) },
      { leadId: "a", toStage: "QUALIFIED", at: day(7) },
      { leadId: "b", toStage: "NEW_LEAD", at: day(2) },
      { leadId: "b", toStage: "CONTACTED", at: day(6) },
    ]);
    const of = (s: string) => v.find((x) => x.stage === s);
    assert.deepEqual(of("NEW_LEAD"), { stage: "NEW_LEAD", avgDays: 3, samples: 2 });
    assert.deepEqual(of("CONTACTED"), { stage: "CONTACTED", avgDays: 4, samples: 1 });
  });

  it("ignores a stay that hasn't ended yet", () => {
    const v = stageVelocity([{ leadId: "a", toStage: "NEW_LEAD", at: day(1) }]);
    assert.deepEqual(v, []);
  });

  it("orders events itself — input order doesn't matter", () => {
    const v = stageVelocity([
      { leadId: "a", toStage: "CONTACTED", at: day(5) },
      { leadId: "a", toStage: "NEW_LEAD", at: day(1) },
    ]);
    assert.deepEqual(v, [{ stage: "NEW_LEAD", avgDays: 4, samples: 1 }]);
  });
});
