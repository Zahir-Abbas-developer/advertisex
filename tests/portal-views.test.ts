import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clientUpdates, groupReports, milestoneView, monthLabel, parsePrefs, projectView, stageTracker } from "../modules/portal/views";

const d = (s: string) => new Date(s);

describe("what a client sees — allow-lists", () => {
  it("shows only updates the team marked for the client", () => {
    const out = clientUpdates([
      { id: "a", title: "Design approved", body: "Looks great", visibility: "CLIENT", createdAt: d("2026-09-01T10:00:00Z"), author: { name: "Cheryl" } },
      { id: "b", title: "INTERNAL: client is slow to reply", body: "chase them", visibility: "INTERNAL", createdAt: d("2026-09-02T10:00:00Z") },
      { id: "c", title: "x", body: "y", visibility: "client", createdAt: d("2026-09-02T10:00:00Z") },
    ]);
    assert.deepEqual(out.map((u) => u.id), ["a"]);
  });

  it("reduces a milestone to title, date and done — never its description or owner", () => {
    const v = milestoneView({ title: "Homepage live", dueDate: d("2026-10-01T00:00:00Z"), status: "DONE", completedAt: d("2026-09-30T12:00:00Z"), description: "SECRET internal note", assigneeId: "user-1" });
    assert.deepEqual(Object.keys(v).sort(), ["completedAt", "done", "dueDate", "title"]);
    assert.ok(!JSON.stringify(v).includes("SECRET"));
  });

  it("builds a project view with no field beyond the allow-list", () => {
    const view = projectView({
      project: { id: "p", title: "Website relaunch", status: "ACTIVE", startDate: d("2026-09-01T00:00:00Z"), endDate: d("2026-10-31T00:00:00Z"), ...({ description: "INTERNAL brief", paymentStatus: "OVERDUE" } as object) },
      progress: 46,
      services: [{ id: "web", name: "Website Development" }],
      stages: [
        { name: "Planning", order: 0, status: "DONE", serviceId: "web" },
        { name: "Design", order: 1, status: "ACTIVE", serviceId: "web" },
        { name: "Launch", order: 2, status: "PENDING", serviceId: "web" },
      ],
      milestones: [{ title: "Sitemap", dueDate: d("2026-09-05T00:00:00Z"), status: "DONE", completedAt: d("2026-09-04T00:00:00Z"), description: "INTERNAL" }],
      updates: [{ id: "u", title: "INTERNAL only", body: "x", visibility: "INTERNAL", createdAt: d("2026-09-02T00:00:00Z") }],
      now: d("2026-09-10T00:00:00Z"),
    });
    const text = JSON.stringify(view);
    assert.ok(!text.includes("INTERNAL"), text);
    assert.ok(!text.includes("OVERDUE"));
    assert.equal(view.statusText, "In progress");
    assert.deepEqual(view.stages[0].stages.map((s) => s.state), ["done", "current", "upcoming"]);
    assert.equal(view.deadline, "2026-10-31");
  });

  it("marks the first unfinished stage current, per service line", () => {
    const t = stageTracker(
      [
        { name: "A", order: 0, status: "DONE", serviceId: null },
        { name: "B", order: 1, status: "PENDING", serviceId: null },
        { name: "C", order: 2, status: "PENDING", serviceId: null },
      ],
      new Map(),
    );
    assert.deepEqual(t[0].stages.map((s) => s.state), ["done", "current", "upcoming"]);
  });
});

describe("reports library", () => {
  it("groups by month, newest first, with a readable label", () => {
    const g = groupReports([{ periodMonth: "2026-01" }, { periodMonth: "2026-03" }, { periodMonth: "2026-01" }]);
    assert.deepEqual(g.map((x) => [x.label, x.reports.length]), [["March 2026", 1], ["January 2026", 2]]);
    assert.equal(monthLabel("bad"), "bad");
  });
});

describe("notification preferences", () => {
  it("default to on and ignore junk", () => {
    assert.deepEqual(parsePrefs(null), { messages: true, reports: true, updates: true });
    assert.deepEqual(parsePrefs('{"reports":false,"hack":1}'), { messages: true, reports: false, updates: true });
    assert.deepEqual(parsePrefs("{nope"), { messages: true, reports: true, updates: true });
  });
});
