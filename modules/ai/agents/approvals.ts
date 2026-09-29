import "server-only";

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { moveLeadStage } from "@/lib/stages";
import { storedRoleValues } from "@/config/permissions";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { approveAndPublish } from "@/modules/monthly-reports/server";
import { ensureThreads, post, threadFor } from "@/modules/messages/server";
import { saveDraft } from "@/modules/billing/server";
import { dayKey } from "@/modules/billing/domain";
import { companyTimezone } from "@/lib/company-time";

/**
 * Human-in-the-loop (Phase 9 scope 2). An agent's consequential proposal
 * becomes an ApprovalRequest; a founder or the subject department's manager
 * approves or rejects it; approving executes it *as the approver*, through
 * the same code people use — so the approver's permissions apply and the
 * audit log names them.
 */

export const APPROVAL_KINDS = ["SEND_CLIENT_MESSAGE", "LEAD_OUTCOME", "CREATE_INVOICE", "PUBLISH_REPORT"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_LABEL: Record<ApprovalKind, string> = {
  SEND_CLIENT_MESSAGE: "Send a message to a client",
  LEAD_OUTCOME: "Mark a lead won or lost",
  CREATE_INVOICE: "Create an invoice",
  PUBLISH_REPORT: "Publish a report to a client",
};

export class ApprovalError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Env = { organizationId: string; runId: string; agentId: string; agentName: string };

/** Where a subject lives (for scoping who may decide, and for notifying). */
async function subjectScope(subjectType: string, subjectId: string) {
  if (subjectType === "lead") {
    const l = await prisma.lead.findUnique({ where: { id: subjectId }, select: { departmentId: true, department: { select: { organizationId: true } } } });
    return l ? { organizationId: l.department.organizationId, departmentId: l.departmentId } : null;
  }
  const c = await prisma.client.findUnique({ where: { id: subjectId }, select: { id: true, organizationId: true, departmentId: true } });
  return c ? { organizationId: c.organizationId, departmentId: c.departmentId, clientId: c.id } : null;
}

async function reviewers(organizationId: string, departmentId: string) {
  const [founders, leads] = await Promise.all([
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { in: storedRoleValues("FOUNDER") } }, select: { id: true } }),
    // Those who can decide: the department's managers (by role — a team lead who is an employee can't).
    prisma.departmentMembership.findMany({ where: { departmentId, user: { isActive: true, organizationId, role: { in: storedRoleValues("MANAGER") } } }, select: { userId: true } }),
  ]);
  return [...new Set([...founders.map((f) => f.id), ...leads.map((l) => l.userId)])];
}

/** Called by a consequential tool: records the proposal and asks the reviewers. Nothing else happens. */
export async function proposeApproval(env: Env, p: { kind: ApprovalKind; subjectType: "lead" | "client"; subjectId: string; summary: string; payload: Record<string, unknown> }) {
  const scope = await subjectScope(p.subjectType, p.subjectId);
  const request = await prisma.approvalRequest.create({
    data: { organizationId: env.organizationId, runId: env.runId, agentId: env.agentId, kind: p.kind, subjectType: p.subjectType, subjectId: p.subjectId, departmentId: scope?.departmentId ?? null, summary: p.summary.slice(0, 300), payload: JSON.stringify(p.payload) },
  });
  if (scope?.departmentId) {
    for (const userId of await reviewers(env.organizationId, scope.departmentId)) {
      await notify({ userId, type: "APPROVAL_NEEDED", title: `${env.agentName} needs a decision`, body: request.summary, href: `/approvals?focus=${request.id}`, dedupeKey: `approval:${request.id}:${userId}` });
    }
  }
  return { approvalId: request.id, status: "PENDING" as const };
}

/** May this person decide this request? Founders: anything. Managers: their departments', never an invoice. */
export async function canDecide(principal: Principal, r: { kind: string; subjectType: string; subjectId: string }) {
  const scope = await subjectScope(r.subjectType, r.subjectId);
  if (!scope) return false;
  if (r.kind === "CREATE_INVOICE" && principal.role !== "FOUNDER") return false; // money is the founder's
  return authorize(principal, "update", "approval", { organizationId: scope.organizationId ?? undefined, departmentId: scope.departmentId }).allowed;
}

async function execute(principal: Principal, kind: ApprovalKind, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (kind) {
    case "LEAD_OUTCOME": {
      const out = await moveLeadStage({ leadId: String(payload.leadId), toStageKey: String(payload.toStageKey), actorId: principal.id, lostReason: (payload.lostReason as string | null) ?? null });
      if (!out.ok) throw new ApprovalError(out.error, out.status);
      return { stage: out.stage.key, converted: out.converted };
    }
    case "PUBLISH_REPORT": {
      const r = await approveAndPublish(String(payload.reportId), principal.id);
      return { reportId: r.id, status: r.status };
    }
    case "SEND_CLIENT_MESSAGE": {
      const clientId = String(payload.clientId);
      await ensureThreads(clientId);
      const team = await prisma.messageThread.findFirst({ where: { clientId, kind: "TEAM", projectId: null }, select: { id: true } });
      const thread = team ? await threadFor(principal, team.id) : null;
      if (!thread) throw new ApprovalError("You can't write to this client's conversation", 403);
      const message = await post(principal, thread, String(payload.body));
      return { messageId: message.id, threadId: thread.id };
    }
    case "CREATE_INVOICE": {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: principal.organizationId! }, select: { currency: true } });
      const today = dayKey(new Date(), await companyTimezone());
      const due = new Date(`${today}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + Number(payload.dueInDays ?? 14));
      const invoice = await saveDraft(principal, { clientId: String(payload.clientId), currency: org.currency, dueDate: due.toISOString().slice(0, 10), lines: payload.lines as { description: string; quantity: string; rate: string }[], notes: "Drafted by an AI agent; reviewed before sending." });
      return { invoiceId: invoice.id, status: invoice.status };
    }
  }
}

/**
 * Approve (and execute) or reject. Conditional on PENDING, so a request is
 * decided once. A failed execution is recorded (FAILED, with the reason) and
 * nothing half-happens — each executor is a single existing operation.
 */
export async function decide(principal: Principal, id: string, decision: "APPROVED" | "REJECTED", note?: string | null) {
  const r = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!r || r.organizationId !== principal.organizationId) throw new ApprovalError("Not found", 404);
  if (!(await canDecide(principal, r))) throw new ApprovalError("You can't decide this one", 403);
  const claimed = await prisma.approvalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: decision === "REJECTED" ? "REJECTED" : "APPROVED", decidedById: principal.id, decidedAt: new Date(), note: note ?? null } });
  if (claimed.count !== 1) throw new ApprovalError("Already decided", 409);

  let result: Record<string, unknown> | null = null;
  if (decision === "APPROVED") {
    try {
      result = await execute(principal, r.kind as ApprovalKind, JSON.parse(r.payload));
      await prisma.approvalRequest.update({ where: { id }, data: { result: JSON.stringify(result) } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "It couldn't be carried out";
      await prisma.approvalRequest.update({ where: { id }, data: { status: "FAILED", result: JSON.stringify({ error: message }) } });
      await finishRunIfSettled(r.runId);
      throw error instanceof ApprovalError ? error : new ApprovalError(message, 422);
    }
  }
  await prisma.auditLog.create({
    data: { actorId: principal.id, actorType: "HUMAN", organizationId: r.organizationId, action: "APPROVAL_DECIDED", entityType: "ApprovalRequest", entityId: r.id, summary: `${decision === "APPROVED" ? "Approved" : "Rejected"}: ${r.summary}`, beforeJson: JSON.stringify({ kind: r.kind, payload: JSON.parse(r.payload) }), afterJson: JSON.stringify({ decision, note: note ?? null, result }) },
  });
  await finishRunIfSettled(r.runId);
  // The agent's requester hears how it went.
  const run = r.runId ? await prisma.agentRun.findUnique({ where: { id: r.runId }, select: { requestedById: true } }) : null;
  if (run?.requestedById && run.requestedById !== principal.id) {
    await notify({ userId: run.requestedById, type: "AGENT_NOTICE", title: `${decision === "APPROVED" ? "Approved" : "Rejected"}: ${r.summary}`, body: note ?? "", href: `/agents/runs/${r.runId}` });
  }
  return { status: decision, result };
}

/** A run waiting on approvals is DONE once none is pending. */
export async function finishRunIfSettled(runId: string | null) {
  if (!runId) return;
  const pending = await prisma.approvalRequest.count({ where: { runId, status: "PENDING" } });
  if (pending === 0) await prisma.agentRun.updateMany({ where: { id: runId, status: "AWAITING_APPROVAL" }, data: { status: "DONE", finishedAt: new Date() } });
}
