import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOTIFICATION_TYPES } from "../lib/notification-types";
import { CATEGORY, categoriesFor, defaultPreferences, deliveryFor, EVENTS, resolvePreferences, serializePreferences, TYPE_CATEGORY } from "../modules/notifications/catalog";
import { resendPayload } from "../lib/email/resend";

describe("notification catalog", () => {
  it("files every notification type under a category", () => {
    for (const t of NOTIFICATION_TYPES) assert.ok(TYPE_CATEGORY[t], t);
  });

  it("covers the founder's full event list", () => {
    assert.deepEqual(Object.keys(EVENTS).sort(), [
      "deadlineApproaching", "founderAnnouncement", "newClientMessage", "newInvoice", "newProject", "newReport",
      "paymentOverdue", "paymentReceived", "projectUpdate", "taskAssigned", "taskOverdue",
    ]);
  });

  it("is role-aware: billing never reaches staff below the founder; team work never reaches a client", () => {
    const d = defaultPreferences();
    for (const t of ["INVOICE_SENT", "INVOICE_OVERDUE", "PAYMENT_RECEIVED"] as const) {
      assert.equal(deliveryFor(t, "EMPLOYEE", d), "off", t);
      assert.equal(deliveryFor(t, "MANAGER", d), "off", t);
      assert.notEqual(deliveryFor(t, "FOUNDER", d), "off", t);
      assert.notEqual(deliveryFor(t, "CLIENT", d), "off", t);
    }
    for (const t of ["TASK_ASSIGNED", "OVERDUE", "PROJECT_CREATED", "PROJECT_UPDATED", "DUE_TOMORROW"] as const) {
      assert.equal(deliveryFor(t, "CLIENT", d), "off", t);
    }
    assert.equal(deliveryFor("UPDATE_SHARED", "EMPLOYEE", d), "off", "shared updates are for clients");
    assert.notEqual(deliveryFor("ANNOUNCEMENT", "CLIENT", d), "off");
    assert.notEqual(deliveryFor("MESSAGE_RECEIVED", "EMPLOYEE", d), "off");
  });

  it("applies preferences, and never lets a person mute what can't be muted", () => {
    const p = resolvePreferences(JSON.stringify({ levels: { messages: "off", announcements: "off", billing: "off", projects: "email" }, digest: true }));
    assert.equal(p.levels.messages, "off");
    assert.equal(p.levels.announcements, "app", "announcements are at least in-app");
    assert.equal(p.levels.billing, "app", "billing is at least in-app");
    assert.equal(p.levels.projects, "email");
    assert.equal(p.digest, true);
    assert.equal(deliveryFor("MESSAGE_RECEIVED", "EMPLOYEE", p), "off");
    assert.deepEqual(resolvePreferences(serializePreferences(p)), p, "round-trips");
  });

  it("reads the Phase 6 portal format", () => {
    const p = resolvePreferences('{"messages":false,"reports":true}');
    assert.equal(p.levels.messages, "off");
    assert.equal(p.levels.reports, CATEGORY.reports.defaultLevel);
    assert.deepEqual(resolvePreferences("{broken"), defaultPreferences());
  });

  it("shows each role only the categories it can receive", () => {
    assert.ok(!categoriesFor("CLIENT").includes("tasks"));
    assert.ok(categoriesFor("CLIENT").includes("billing"));
    assert.ok(!categoriesFor("EMPLOYEE").includes("billing"));
    assert.ok(categoriesFor("FOUNDER").includes("billing"));
  });

  it("builds a Resend request with base64 attachments", () => {
    const body = resendPayload("Advertise X <billing@x.example>", "a@b.example", { subject: "S", html: "<p>h</p>", text: "t" }, [{ filename: "a.pdf", content: Buffer.from("%PDF") }]);
    assert.deepEqual(body, { from: "Advertise X <billing@x.example>", to: ["a@b.example"], subject: "S", html: "<p>h</p>", text: "t", attachments: [{ filename: "a.pdf", content: "JVBERg==" }] });
  });
});
