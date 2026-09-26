import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canMove,
  deadlineState,
  normalizeTaskStatus,
  onTimeRate,
  storedTaskStatuses,
  workload,
} from "../modules/tasks/domain";

const at = (iso: string) => new Date(iso);

describe("task status", () => {
  it("reads legacy values as their new names", () => {
    assert.equal(normalizeTaskStatus("OPEN"), "NOT_STARTED");
    assert.equal(normalizeTaskStatus("DONE"), "COMPLETED");
    assert.equal(normalizeTaskStatus("REVIEW"), "REVIEW");
  });

  it("never reads an unknown value as completed", () => {
    assert.equal(normalizeTaskStatus("ARCHIVED"), "NOT_STARTED");
    assert.equal(normalizeTaskStatus(undefined), "NOT_STARTED");
  });

  it("matches both spellings in filters", () => {
    assert.deepEqual(storedTaskStatuses("NOT_STARTED").sort(), ["NOT_STARTED", "OPEN"]);
    assert.deepEqual(storedTaskStatuses("COMPLETED").sort(), ["COMPLETED", "DONE"]);
    assert.deepEqual(storedTaskStatuses("REVIEW"), ["REVIEW"]);
  });

  it("walks forward one step at a time", () => {
    assert.ok(canMove("NOT_STARTED", "IN_PROGRESS"));
    assert.ok(canMove("IN_PROGRESS", "REVIEW"));
    assert.ok(canMove("REVIEW", "COMPLETED"));
    assert.equal(canMove("NOT_STARTED", "REVIEW"), false);
  });

  it("lets review send work back, and anything finish directly", () => {
    assert.ok(canMove("REVIEW", "IN_PROGRESS"));
    assert.ok(canMove("NOT_STARTED", "COMPLETED"));
  });

  it("reopens a completed task only into progress", () => {
    assert.ok(canMove("COMPLETED", "IN_PROGRESS"));
    assert.equal(canMove("COMPLETED", "NOT_STARTED"), false);
    assert.equal(canMove("COMPLETED", "REVIEW"), false);
  });

  it("refuses a move to the same status", () => {
    assert.equal(canMove("REVIEW", "REVIEW"), false);
  });
});

describe("deadlines", () => {
  const deadline = at("2026-09-25T23:59:59-04:00");

  it("is overdue after the deadline, approaching within a day of it", () => {
    assert.equal(deadlineState({ status: "IN_PROGRESS", deadline, completedAt: null, now: at("2026-09-26T08:00:00-04:00") }), "OVERDUE");
    assert.equal(deadlineState({ status: "IN_PROGRESS", deadline, completedAt: null, now: at("2026-09-25T09:00:00-04:00") }), "APPROACHING");
    assert.equal(deadlineState({ status: "NOT_STARTED", deadline, completedAt: null, now: at("2026-09-20T09:00:00-04:00") }), "ON_TRACK");
  });

  it("judges completed work by when it was completed, not now", () => {
    assert.equal(deadlineState({ status: "COMPLETED", deadline, completedAt: at("2026-09-25T17:00:00-04:00"), now: at("2026-10-10T00:00:00Z") }), "DONE_ON_TIME");
    assert.equal(deadlineState({ status: "COMPLETED", deadline, completedAt: at("2026-09-26T10:00:00-04:00"), now: at("2026-10-10T00:00:00Z") }), "DONE_LATE");
  });

  it("has no state without a deadline", () => {
    assert.equal(deadlineState({ status: "IN_PROGRESS", deadline: null, completedAt: null, now: at("2026-09-26T00:00:00Z") }), "NONE");
  });
});

describe("on-time delivery rate", () => {
  const deadline = at("2026-09-25T23:59:59Z");

  it("is completed-by-deadline over completed-with-a-deadline", () => {
    assert.equal(
      onTimeRate([
        { status: "COMPLETED", deadline, completedAt: at("2026-09-24T12:00:00Z") },
        { status: "COMPLETED", deadline, completedAt: at("2026-09-27T12:00:00Z") },
        { status: "COMPLETED", deadline: null, completedAt: at("2026-09-27T12:00:00Z") },
        { status: "IN_PROGRESS", deadline, completedAt: null },
      ]),
      1 / 2,
    );
  });

  it("is null, not zero, when nothing qualifies", () => {
    assert.equal(onTimeRate([{ status: "IN_PROGRESS", deadline, completedAt: null }]), null);
  });
});

describe("workload", () => {
  it("is estimated open hours over weekly capacity", () => {
    assert.equal(workload(10, 40), 0.5);
    assert.equal(workload(25, 40), 1.25);
  });

  it("is null without capacity", () => {
    assert.equal(workload(3, 0), null);
  });
});
