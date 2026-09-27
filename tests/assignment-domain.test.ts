import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WEIGHTS,
  deriveRequirements,
  evaluate,
  explain,
  normalizeWeights,
  parseWeights,
  planTeam,
  rank,
  rebalance,
  type Candidate,
  type ScoreContext,
} from "../modules/assignment/domain";

/** Skills, as the catalog maps them (weights 5/3/2 by order). */
const S = { websites: "websites", uiux: "uiux", dev: "dev", gads: "gads", seo: "seo", meta: "meta" };
const services = [
  { skills: [{ skillId: S.websites, name: "Websites", weight: 5 }, { skillId: S.uiux, name: "UI/UX", weight: 3 }, { skillId: S.dev, name: "Development", weight: 2 }] },
  { skills: [{ skillId: S.gads, name: "Google Ads", weight: 5 }] },
  { skills: [{ skillId: S.seo, name: "SEO", weight: 5 }] },
];

const person = (over: Omit<Partial<Candidate>, "skills"> & { userId: string; skills: [string, number][] }): Candidate => ({
  name: over.userId,
  isAgent: false,
  employmentStatus: "ACTIVE",
  weeklyCapacityHours: 40,
  openItems: 2,
  openProjectRoles: 1,
  itemsDueBeforeDeadline: 1,
  delivered: { withDue: 10, onTime: 9 },
  leaveDays: 0,
  onProject: false,
  ...over,
  skills: new Map(over.skills),
});

/** A fixed team, shaped like the seeded one. */
const TEAM: Candidate[] = [
  person({ userId: "cheryl", skills: [[S.websites, 4], [S.uiux, 3], [S.seo, 4]] }),
  person({ userId: "raja", skills: [[S.dev, 5]], delivered: { withDue: 20, onTime: 19 } }),
  person({ userId: "cam", skills: [[S.uiux, 4]] }),
  person({ userId: "tayyaba", skills: [[S.gads, 4], [S.seo, 2]], delivered: { withDue: 25, onTime: 24 } }),
  person({ userId: "pulse", isAgent: true, skills: [[S.gads, 3]], delivered: { withDue: 0, onTime: 0 } }),
  person({ userId: "claire", skills: [[S.meta, 4]] }),
];

const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({
  weights: normalizeWeights(DEFAULT_WEIGHTS),
  roleHours: 6,
  windowWeeks: 8,
  requirements: deriveRequirements({ services }),
  ...over,
});

describe("requirements", () => {
  it("derives weighted skills from the services, heaviest first", () => {
    const r = deriveRequirements({ services });
    assert.deepEqual(r.map((x) => [x.name, x.weight]), [["Google Ads", 5], ["SEO", 5], ["Websites", 5], ["UI/UX", 3], ["Development", 2]]);
  });

  it("merges the brief and manual skills, keeping the highest weight and every source", () => {
    const r = deriveRequirements({ services, brief: [{ skillId: S.uiux, name: "UI/UX" }, { skillId: S.meta, name: "Meta Ads" }], manual: [{ skillId: S.dev, name: "Development", weight: 4 }] });
    assert.deepEqual(r.find((x) => x.skillId === S.uiux)?.sources, ["SERVICE", "BRIEF"]);
    assert.equal(r.find((x) => x.skillId === S.meta)?.weight, 2);
    assert.equal(r.find((x) => x.skillId === S.dev)?.weight, 4);
  });
});

describe("weights", () => {
  it("normalize to fractions of their total", () => {
    const w = normalizeWeights({ skillMatch: 2, availability: 0, capacity: 1, performance: 1, deadlineFit: 0 });
    assert.equal(w.skillMatch, 0.5);
    assert.equal(w.capacity, 0.25);
  });

  it("fall back to the defaults when all zero, negative or unreadable", () => {
    assert.deepEqual(normalizeWeights({ skillMatch: 0, availability: 0, capacity: 0, performance: 0, deadlineFit: 0 }), normalizeWeights(DEFAULT_WEIGHTS));
    assert.deepEqual(parseWeights("not json"), normalizeWeights(DEFAULT_WEIGHTS));
    assert.equal(normalizeWeights({ skillMatch: -5, capacity: 1 }).capacity, 1);
  });

  it("change the outcome: all weight on capacity picks the lightest workload", () => {
    const busy = person({ userId: "busy", skills: [[S.gads, 5]], openItems: 12 });
    const free = person({ userId: "free", skills: [[S.gads, 2]], openItems: 0, openProjectRoles: 0 });
    const bySkill = rank([busy, free], S.gads, ctx({ weights: normalizeWeights({ skillMatch: 1 }) }));
    const byCapacity = rank([busy, free], S.gads, ctx({ weights: normalizeWeights({ capacity: 1 }) }));
    assert.equal(bySkill.eligible[0].userId, "busy");
    assert.equal(byCapacity.eligible[0].userId, "free");
  });
});

describe("scoring components", () => {
  const c = ctx();

  it("computes each component from the inputs", () => {
    const e = evaluate(person({ userId: "x", skills: [[S.seo, 4], [S.websites, 3]], openItems: 5, openProjectRoles: 1, itemsDueBeforeDeadline: 4, leaveDays: 2, delivered: { withDue: 4, onTime: 3 } }), S.seo, c);
    // skill: 0.7×4/5 + 0.3×(5+5)/20
    assert.ok(Math.abs(e.components.skillMatch - (0.56 + 0.15)) < 1e-9);
    assert.equal(e.components.availability, 0.8);
    // committed = 5×2 + 1×6 = 16 of 40; after the role, 22 of 40
    assert.equal(e.workloadRatio, 0.4);
    assert.ok(Math.abs(e.components.capacity - 0.45) < 1e-9);
    assert.equal(e.components.performance, 0.75);
    // 4 items × 2h = 8h of 40h × 8 weeks
    assert.ok(Math.abs(e.components.deadlineFit - (1 - 8 / 320)) < 1e-9);
    // after taking the role: 22 of 40 committed
    assert.ok(Math.abs(e.freeAfter - 0.45) < 1e-9);
    assert.deepEqual(e.coverage, { held: 2, of: 5 });
  });

  it("gives no history a neutral, not a failing, performance", () => {
    assert.equal(evaluate(person({ userId: "new", skills: [[S.seo, 3]], delivered: { withDue: 0, onTime: 0 } }), S.seo, c).components.performance, 0.6);
  });

  it("moves the score by the founder's past overrides, capped", () => {
    const base = evaluate(person({ userId: "a", skills: [[S.seo, 3]] }), S.seo, c).score;
    const up = evaluate(person({ userId: "a", skills: [[S.seo, 3]], signal: 10 }), S.seo, c);
    assert.ok(Math.abs(up.score - base - 0.12) < 1e-9);
    assert.ok(evaluate(person({ userId: "a", skills: [[S.seo, 3]], signal: -1 }), S.seo, c).score < base);
  });
});

describe("hard constraints", () => {
  const c = ctx();
  it("never ranks someone without the skill (or below 2/5)", () => {
    assert.equal(evaluate(person({ userId: "a", skills: [] }), S.seo, c).eligible, false);
    assert.deepEqual(evaluate(person({ userId: "a", skills: [[S.seo, 1]] }), S.seo, c).reasons, ["only 1/5 in this skill"]);
  });

  it("never exceeds capacity — unless they're already on the project", () => {
    const full = person({ userId: "full", skills: [[S.seo, 5]], openItems: 17, openProjectRoles: 0 }); // 34h + 6h = 40h: fits exactly
    assert.equal(evaluate(full, S.seo, c).eligible, true);
    const over = person({ userId: "over", skills: [[S.seo, 5]], openItems: 18, openProjectRoles: 0 }); // 36h + 6h > 40h
    assert.equal(evaluate(over, S.seo, c).eligible, false);
    assert.equal(evaluate({ ...over, onProject: true }, S.seo, c).eligible, true);
  });

  it("excludes people on leave, inactive, or with no capacity", () => {
    assert.equal(evaluate(person({ userId: "a", skills: [[S.seo, 5]], employmentStatus: "ON_LEAVE" }), S.seo, c).eligible, false);
    assert.equal(evaluate(person({ userId: "a", skills: [[S.seo, 5]], employmentStatus: "INACTIVE" }), S.seo, c).eligible, false);
    assert.equal(evaluate(person({ userId: "a", skills: [[S.seo, 5]], weeklyCapacityHours: 0 }), S.seo, c).eligible, false);
  });
});

describe("Website + Google Ads + SEO — the acceptance scenario, fixed data", () => {
  const plan = planTeam(TEAM, ctx());
  const who = (name: string) => plan.find((p) => p.skillName === name)?.recommended?.userId;

  it("puts the right specialist on every role", () => {
    assert.equal(who("Google Ads"), "tayyaba");
    assert.equal(who("Websites"), "cheryl");
    assert.equal(who("SEO"), "cheryl");
    assert.equal(who("Development"), "raja");
    assert.equal(who("UI/UX"), "cam");
  });

  it("recommends only people who hold the skill, and lists alternatives behind them", () => {
    for (const role of plan) {
      const holders = TEAM.filter((t) => (t.skills.get(role.skillId) ?? 0) >= 2).map((t) => t.userId);
      assert.ok(role.recommended && holders.includes(role.recommended.userId), role.skillName);
      for (const alt of role.alternatives) assert.ok(holders.includes(alt.userId));
      for (const alt of role.alternatives) assert.ok(alt.score <= role.recommended.score);
    }
    assert.deepEqual(plan.find((p) => p.skillName === "Google Ads")?.alternatives.map((a) => a.userId), ["pulse"]);
  });

  it("explains each recommendation in plain language", () => {
    const seo = plan.find((p) => p.skillName === "SEO")!.recommended!;
    assert.match(seo.explanation, /^Best match: covers 3\/5 required skills · SEO 4\/5 · \d+% capacity free · 90% on-time delivery\.$/);
    const alt = plan.find((p) => p.skillName === "Google Ads")!.alternatives[0];
    assert.match(alt.explanation, /points behind: covers 1\/5 required skills · Google Ads 3\/5 · .* no delivery history yet · AI agent\.$/);
  });

  it("counts every role's load, so a second role leaves less room than the first", () => {
    const first = plan.find((p) => p.skillName === "SEO")!.recommended!;
    const second = plan.find((p) => p.skillName === "Websites")!.recommended!;
    assert.equal(first.userId, second.userId);
    assert.ok(second.freeAfter < first.freeAfter);
  });

  it("names a gap honestly when no one can take a role", () => {
    const gapPlan = planTeam(TEAM.filter((t) => t.userId !== "tayyaba" && t.userId !== "pulse"), ctx());
    const gads = gapPlan.find((p) => p.skillName === "Google Ads")!;
    assert.equal(gads.recommended, null);
    assert.match(gads.gap!, /No one on the team holds Google Ads/);
    const busy = planTeam(TEAM.map((t) => (t.userId === "tayyaba" || t.userId === "pulse" ? { ...t, openItems: 30 } : t)), ctx());
    assert.match(busy.find((p) => p.skillName === "Google Ads")!.gap!, /unavailable: tayyaba \(at capacity/);
  });
});

describe("explanations", () => {
  it("reads like the brief's example", () => {
    const e = evaluate(person({ userId: "a", skills: [[S.gads, 5], [S.seo, 4], [S.websites, 3]], openItems: 9, openProjectRoles: 0, delivered: { withDue: 25, onTime: 24 } }), S.gads, ctx({ requirements: deriveRequirements({ services: services.slice(0, 3).map((s, i) => (i === 0 ? { skills: [s.skills[0]] } : s)) }) }));
    assert.equal(explain(e, "Google Ads"), "Best match: covers 3/3 required skills · Google Ads 5/5 · 40% capacity free · 96% on-time delivery.");
  });
});

describe("fairness to the current holder", () => {
  it("scores a holder the same as the same person joining fresh", () => {
    const c = ctx();
    const joining = evaluate(person({ userId: "a", skills: [[S.seo, 4]], openItems: 4, openProjectRoles: 1 }), S.seo, c);
    // As a member, the project's role is already among their project roles.
    const holding = evaluate(person({ userId: "a", skills: [[S.seo, 4]], openItems: 4, openProjectRoles: 2, onProject: true }), S.seo, c);
    assert.ok(Math.abs(joining.score - holding.score) < 1e-9);
    assert.equal(joining.freeAfter, holding.freeAfter);
  });
});

describe("rebalancing — a suggestion, never a silent change", () => {
  const c = ctx();
  const best = evaluate(person({ userId: "best", skills: [[S.seo, 5]], openItems: 0, openProjectRoles: 0 }), S.seo, c);

  it("suggests handing over when the holder is over capacity", () => {
    const over = evaluate(person({ userId: "cur", skills: [[S.seo, 4]], openItems: 22, onProject: true }), S.seo, c);
    assert.match(rebalance(over, best, false)!.reason, /over capacity/);
  });

  it("suggests handing over when they can no longer cover it", () => {
    const gone = evaluate(person({ userId: "cur", skills: [[S.seo, 4]], employmentStatus: "ON_LEAVE", onProject: true }), S.seo, c);
    assert.deepEqual(rebalance(gone, best, false)?.toUserId, "best");
  });

  it("on a delayed project, suggests a clearly better fit — and stays quiet otherwise", () => {
    const weak = evaluate(person({ userId: "cur", skills: [[S.seo, 2]], openItems: 14, onProject: true, delivered: { withDue: 10, onTime: 4 } }), S.seo, c);
    assert.ok(rebalance(weak, best, true));
    assert.equal(rebalance(weak, best, false), null);
    const fine = evaluate(person({ userId: "cur", skills: [[S.seo, 5]], openItems: 0, openProjectRoles: 0, onProject: true }), S.seo, c);
    assert.equal(rebalance(fine, best, true), null);
  });
});
