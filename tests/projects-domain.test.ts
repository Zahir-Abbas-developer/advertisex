import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentStages,
  daysOverdue,
  expectedProgress,
  isDelayed,
  normalizeProjectStatus,
  projectProgress,
  projectSchedule,
  stageMove,
  upcomingWork,
} from "../modules/projects/domain";
import { clientHealth } from "../modules/clients/health";
import { DEFAULT_SERVICES, monthlyEquivalent, slugifyService } from "../modules/services/catalog";

const d = (s: string) => new Date(s);

describe("projectProgress — the documented formula", () => {
  it("weights milestones by size and counts each task once", () => {
    const p = projectProgress({
      status: "ACTIVE",
      milestones: [{ weight: 3, done: true }, { weight: 2, done: false }],
      tasks: [{ done: true }, { done: false }, { done: false }],
      stages: [],
    });
    // (3 + 1) / (5 + 3) = 50%
    assert.deepEqual(p, { percent: 50, basis: "work", done: 4, total: 8 });
  });

  it("rounds down, so 100% only when every item is done", () => {
    const p = projectProgress({ status: "ACTIVE", milestones: [], tasks: Array.from({ length: 200 }, (_, i) => ({ done: i > 0 })), stages: [] });
    assert.equal(p.percent, 99);
    const all = projectProgress({ status: "ACTIVE", milestones: [{ weight: 1, done: true }], tasks: [{ done: true }], stages: [] });
    assert.equal(all.percent, 100);
  });

  it("clamps milestone weights to 1–5", () => {
    const p = projectProgress({ status: "ACTIVE", milestones: [{ weight: 50, done: true }, { weight: 0, done: false }], tasks: [], stages: [] });
    assert.deepEqual([p.done, p.total], [5, 6]);
  });

  it("falls back to stages when no work is planned, then to zero", () => {
    const s = projectProgress({ status: "ACTIVE", milestones: [], tasks: [], stages: [{ done: true }, { done: false }, { done: false }] });
    assert.deepEqual(s, { percent: 33, basis: "stages", done: 1, total: 3 });
    assert.deepEqual(projectProgress({ status: "PLANNING", milestones: [], tasks: [], stages: [] }), { percent: 0, basis: "none", done: 0, total: 0 });
  });

  it("a completed project is 100, whatever is left open", () => {
    const p = projectProgress({ status: "COMPLETED", milestones: [{ weight: 2, done: false }], tasks: [], stages: [] });
    assert.equal(p.percent, 100);
    assert.equal(projectProgress({ status: "OVERDUE_CLOSEOUT", milestones: [], tasks: [{ done: false }], stages: [] }).percent, 100);
  });
});

describe("statuses", () => {
  it("normalizes legacy and unknown values safely", () => {
    assert.equal(normalizeProjectStatus("OVERDUE_CLOSEOUT"), "COMPLETED");
    assert.equal(normalizeProjectStatus("ACTIVE"), "ACTIVE");
    assert.equal(normalizeProjectStatus("WHATEVER"), "PLANNING");
    assert.equal(normalizeProjectStatus(null), "PLANNING");
  });
});

describe("projectSchedule — delayed-project detection", () => {
  const start = d("2026-09-01T00:00:00Z");
  const deadline = d("2026-10-01T00:00:00Z");

  it("is overdue past the deadline, whatever the progress", () => {
    assert.equal(projectSchedule({ status: "ACTIVE", percent: 95, start, deadline, now: d("2026-10-02T00:00:00Z") }), "OVERDUE");
    assert.equal(projectSchedule({ status: "ON_HOLD", percent: 0, start, deadline, now: d("2026-10-02T00:00:00Z") }), "OVERDUE");
  });

  it("is behind when progress trails the calendar by more than 25 points", () => {
    const now = d("2026-09-19T00:00:00Z"); // 60% of the time gone
    assert.ok(Math.abs(expectedProgress(start, deadline, now) - 60) < 0.01);
    assert.equal(projectSchedule({ status: "ACTIVE", percent: 34, start, deadline, now }), "BEHIND");
    assert.equal(projectSchedule({ status: "ACTIVE", percent: 35, start, deadline, now }), "ON_TRACK");
  });

  it("does not call a paused project behind, and closes finished ones", () => {
    const now = d("2026-09-25T00:00:00Z");
    assert.equal(projectSchedule({ status: "ON_HOLD", percent: 0, start, deadline, now }), "ON_TRACK");
    assert.equal(projectSchedule({ status: "COMPLETED", percent: 10, start, deadline, now: d("2027-01-01T00:00:00Z") }), "CLOSED");
    assert.equal(projectSchedule({ status: "CANCELLED", percent: 0, start, deadline, now }), "CLOSED");
  });

  it("counts whole days overdue and names delayed states", () => {
    assert.equal(daysOverdue(deadline, d("2026-10-01T00:00:00Z")), 0);
    assert.equal(daysOverdue(deadline, d("2026-10-03T01:00:00Z")), 3);
    assert.ok(isDelayed("OVERDUE") && isDelayed("BEHIND") && !isDelayed("ON_TRACK") && !isDelayed("CLOSED"));
  });

  it("handles a zero-length project", () => {
    assert.equal(expectedProgress(deadline, deadline, d("2026-09-01T00:00:00Z")), 0);
    assert.equal(expectedProgress(deadline, deadline, d("2026-10-02T00:00:00Z")), 100);
  });
});

describe("stages", () => {
  const stages = [
    { id: "w1", serviceId: "web", order: 0, status: "DONE" },
    { id: "w2", serviceId: "web", order: 1, status: "ACTIVE" },
    { id: "w3", serviceId: "web", order: 2, status: "PENDING" },
    { id: "s1", serviceId: "seo", order: 0, status: "DONE" },
  ];

  it("the current stage of each line is its first unfinished one", () => {
    assert.deepEqual(currentStages(stages).map((s) => s.id), ["w2"]);
  });

  it("completing a stage activates the next pending one of its line only", () => {
    assert.deepEqual(stageMove(stages, "w2", "DONE"), [{ id: "w2", status: "DONE" }, { id: "w3", status: "ACTIVE" }]);
    assert.deepEqual(stageMove(stages, "w3", "DONE"), [{ id: "w3", status: "DONE" }]);
  });

  it("completing a later stage never leaves two active stages — the first unfinished stays current", () => {
    const line = [
      { id: "a", serviceId: "web", order: 0, status: "ACTIVE" },
      { id: "b", serviceId: "web", order: 1, status: "PENDING" },
      { id: "c", serviceId: "web", order: 2, status: "PENDING" },
    ];
    const changes = stageMove(line, "b", "DONE");
    const after = line.map((s) => changes.find((c) => c.id === s.id)?.status ?? s.status);
    assert.deepEqual(after, ["ACTIVE", "DONE", "PENDING"]);
  });

  it("starting a stage leaves one active stage per line", () => {
    assert.deepEqual(stageMove(stages, "w3", "ACTIVE"), [{ id: "w3", status: "ACTIVE" }, { id: "w2", status: "PENDING" }]);
    assert.deepEqual(stageMove(stages, "nope", "DONE"), []);
  });
});

describe("upcomingWork", () => {
  it("lists open dated items within the horizon, overdue first", () => {
    const now = d("2026-09-10T00:00:00Z");
    const items = [
      { id: "a", kind: "TASK" as const, title: "a", dueAt: d("2026-09-20T00:00:00Z"), done: false },
      { id: "b", kind: "MILESTONE" as const, title: "b", dueAt: d("2026-09-05T00:00:00Z"), done: false },
      { id: "c", kind: "TASK" as const, title: "c", dueAt: d("2026-09-12T00:00:00Z"), done: true },
      { id: "e", kind: "TASK" as const, title: "e", dueAt: null, done: false },
      { id: "f", kind: "TASK" as const, title: "f", dueAt: d("2026-12-01T00:00:00Z"), done: false },
    ];
    assert.deepEqual(upcomingWork(items, now).map((i) => i.id), ["b", "a"]);
  });
});

describe("clientHealth — rules with reasons", () => {
  const now = d("2026-09-26T12:00:00Z");
  const base = { projects: [], onTime: { onTime: 0, withDue: 0 }, overdueItems: 0, contracts: [], now };

  it("is healthy with nothing wrong", () => {
    assert.deepEqual(clientHealth(base), { band: "HEALTHY", reasons: [] });
  });

  it("watches one delayed project, overdue work, a middling on-time rate, an ending contract", () => {
    assert.equal(clientHealth({ ...base, projects: [{ schedule: "BEHIND", daysOverdue: 0 }] }).band, "WATCH");
    assert.equal(clientHealth({ ...base, overdueItems: 2 }).band, "WATCH");
    assert.equal(clientHealth({ ...base, onTime: { onTime: 7, withDue: 10 } }).band, "WATCH");
    const ending = clientHealth({ ...base, contracts: [{ status: "ACTIVE", endDate: d("2026-10-10T00:00:00Z") }] });
    assert.deepEqual(ending, { band: "WATCH", reasons: ["A contract ends within 30 days"] });
    assert.equal(clientHealth({ ...base, contracts: [{ status: "DRAFT", endDate: d("2026-10-10T00:00:00Z") }] }).band, "HEALTHY");
  });

  it("is at risk for a long-overdue project, two delayed, or poor delivery", () => {
    assert.equal(clientHealth({ ...base, projects: [{ schedule: "OVERDUE", daysOverdue: 8 }] }).band, "AT_RISK");
    assert.equal(clientHealth({ ...base, projects: [{ schedule: "OVERDUE", daysOverdue: 7 }] }).band, "WATCH");
    assert.equal(clientHealth({ ...base, projects: [{ schedule: "BEHIND", daysOverdue: 0 }, { schedule: "OVERDUE", daysOverdue: 1 }] }).band, "AT_RISK");
    assert.equal(clientHealth({ ...base, onTime: { onTime: 2, withDue: 5 } }).band, "AT_RISK");
  });

  it("ignores an on-time rate over too few completions", () => {
    assert.equal(clientHealth({ ...base, onTime: { onTime: 0, withDue: 4 } }).band, "HEALTHY");
  });
});

describe("service catalog", () => {
  it("has the eleven services the brief lists, each with stages and skills", () => {
    assert.equal(DEFAULT_SERVICES.length, 11);
    assert.equal(new Set(DEFAULT_SERVICES.map((s) => s.slug)).size, 11);
    for (const s of DEFAULT_SERVICES) {
      assert.ok(s.stages.length >= 3, s.slug);
      assert.ok(s.skills.length >= 1, s.slug);
    }
    assert.deepEqual(DEFAULT_SERVICES.find((s) => s.slug === "website-development")?.stages, ["Planning", "Design", "Development", "Testing", "Launch"]);
  });

  it("converts prices to a monthly equivalent", () => {
    assert.equal(monthlyEquivalent(1500, "MONTHLY"), 1500);
    assert.equal(monthlyEquivalent(3000, "QUARTERLY"), 1000);
    assert.equal(monthlyEquivalent(12000, "YEARLY"), 1000);
    assert.equal(monthlyEquivalent(5000, "ONE_TIME"), 0);
  });

  it("slugifies names", () => {
    assert.equal(slugifyService("Google Business Profile Optimization"), "google-business-profile-optimization");
    assert.equal(slugifyService("  Ads & Social!! "), "ads-and-social");
  });
});
