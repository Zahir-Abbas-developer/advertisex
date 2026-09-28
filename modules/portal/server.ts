import "server-only";
import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { dueDeadline } from "@/lib/date";
import { notify } from "@/lib/notifications";
import type { Principal } from "@/modules/rbac/authorize";
import { isOpenProject, normalizeProjectStatus } from "@/modules/projects/domain";
import { summarize } from "@/modules/projects/server";
import { monthlyEquivalent } from "@/modules/services/catalog";
import { signedUrl } from "@/modules/files/server";
import { CLIENT_STATUS_TEXT, parsePrefs, projectView, type NotificationKind } from "@/modules/portal/views";

/**
 * The client portal's data (Phase 6). Every function takes the CLIENT
 * principal and scopes to *its* account: rows are found by `id AND
 * client.clientAccountId = <mine>`, so another account's id — typed into a
 * URL or an API call — finds nothing and reads as "not found". The tenancy
 * extension adds the organization filter underneath as a second wall.
 */

export class PortalError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function accountOf(principal: Principal): string {
  if (principal.role !== "CLIENT" || !principal.clientAccountId) throw new PortalError("Not found", 404);
  return principal.clientAccountId;
}

const mine = (principal: Principal) => ({ clientAccountId: accountOf(principal) });

export async function isOwner(principal: Principal): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: principal.id }, select: { clientRole: true } });
  return u?.clientRole === "OWNER";
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function portalProjects(principal: Principal) {
  const rows = await prisma.project.findMany({
    where: { client: mine(principal), status: { not: "CANCELLED" } },
    orderBy: { endDate: "asc" },
    select: { id: true, title: true, status: true, startDate: true, endDate: true, services: { select: { service: { select: { name: true } } } }, stages: { select: { name: true, status: true, order: true, serviceId: true } } },
  });
  const summaries = await summarize(rows);
  return rows.map((p) => {
    const status = normalizeProjectStatus(p.status);
    const current = [...p.stages].sort((a, b) => a.order - b.order).find((s) => s.status !== "DONE");
    return {
      id: p.id,
      title: p.title,
      status,
      statusText: CLIENT_STATUS_TEXT[status] ?? "In progress",
      open: isOpenProject(status),
      progress: summaries.get(p.id)!.progress.percent,
      deadline: p.endDate.toISOString().slice(0, 10),
      services: p.services.map((s) => s.service.name),
      currentStage: status === "COMPLETED" ? null : current?.name ?? null,
    };
  });
}

export async function portalProject(principal: Principal, projectId: string) {
  const p = await prisma.project.findFirst({
    where: { id: projectId, client: mine(principal), status: { not: "CANCELLED" } },
    select: {
      id: true,
      title: true,
      status: true,
      startDate: true,
      endDate: true,
      services: { select: { service: { select: { id: true, name: true } } } },
      stages: { select: { name: true, order: true, status: true, serviceId: true } },
      milestones: { select: { title: true, dueDate: true, status: true, completedAt: true } },
      updates: { where: { visibility: "CLIENT" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, body: true, visibility: true, createdAt: true, author: { select: { name: true } } } },
      comments: { where: { visibility: "CLIENT" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, body: true, visibility: true, createdAt: true, author: { select: { name: true } } } },
    },
  });
  if (!p) return null;
  // Comments the team shared read as short updates; internal ones were never loaded.
  const sharedComments = p.comments.map((c) => ({ id: c.id, title: "Note from your team", body: c.body, visibility: c.visibility, createdAt: c.createdAt, author: c.author }));
  const progress = (await summarize([p])).get(p.id)!.progress.percent;
  return projectView({
    project: { ...p, status: normalizeProjectStatus(p.status) },
    progress,
    services: p.services.map((s) => s.service),
    stages: p.stages,
    milestones: p.milestones,
    updates: [...p.updates, ...sharedComments],
    now: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function portalOverview(principal: Principal) {
  const account = accountOf(principal);
  const now = new Date();
  const timeZone = await companyTimezone();
  const [projects, services, milestones, updates, reports] = await Promise.all([
    portalProjects(principal),
    prisma.clientService.findMany({ where: { client: { clientAccountId: account }, status: "ACTIVE" }, select: { service: { select: { name: true } } } }),
    prisma.projectMilestone.findMany({
      where: { status: "OPEN", dueDate: { not: null }, project: { client: { clientAccountId: account }, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } } },
      orderBy: { dueDate: "asc" },
      take: 6,
      select: { title: true, dueDate: true, project: { select: { id: true, title: true } } },
    }),
    prisma.projectUpdate.findMany({
      where: { visibility: "CLIENT", project: { client: { clientAccountId: account }, status: { not: "CANCELLED" } } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, createdAt: true, project: { select: { id: true, title: true } } },
    }),
    prisma.clientReport.findMany({
      where: { status: "PUBLISHED", client: { clientAccountId: account } },
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: { id: true, title: true, publishedAt: true, reads: { where: { userId: principal.id }, select: { readAt: true } } },
    }),
  ]);
  const activity = [
    ...updates.map((u) => ({ kind: "update" as const, id: u.id, title: u.title, detail: u.project.title, href: `/portal/projects/${u.project.id}`, at: u.createdAt.toISOString() })),
    ...reports.map((r) => ({ kind: "report" as const, id: r.id, title: r.title, detail: r.reads.length ? "Report" : "New report", href: `/portal/reports`, at: (r.publishedAt ?? now).toISOString() })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  return {
    projects: projects.filter((p) => p.open),
    completedCount: projects.filter((p) => p.status === "COMPLETED").length,
    services: [...new Set(services.map((s) => s.service.name))],
    upcoming: milestones.map((m) => ({
      title: m.title,
      dueDate: m.dueDate!.toISOString().slice(0, 10),
      late: dueDeadline(m.dueDate!, timeZone) < now,
      project: m.project,
    })),
    activity,
    unreadReports: reports.filter((r) => r.reads.length === 0).length,
  };
}

// ---------------------------------------------------------------------------
// Reports library
// ---------------------------------------------------------------------------

export async function portalReports(principal: Principal) {
  const rows = await prisma.clientReport.findMany({
    where: { status: "PUBLISHED", client: mine(principal) },
    orderBy: [{ periodMonth: "desc" }, { publishedAt: "desc" }],
    select: { id: true, title: true, kind: true, periodMonth: true, publishedAt: true, file: { select: { mimeType: true, size: true } }, reads: { where: { userId: principal.id }, select: { readAt: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    periodMonth: r.periodMonth,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    mimeType: r.file.mimeType,
    size: r.file.size,
    unread: r.reads.length === 0,
  }));
}

/** Opens a report: marks it read for this person and returns a short-lived link. */
export async function openReport(principal: Principal, reportId: string, disposition: "inline" | "attachment") {
  const r = await prisma.clientReport.findFirst({ where: { id: reportId, status: "PUBLISHED", client: mine(principal) }, select: { id: true, fileId: true, file: { select: { mimeType: true } } } });
  if (!r) return null;
  await prisma.clientReportRead.upsert({ where: { reportId_userId: { reportId: r.id, userId: principal.id } }, create: { reportId: r.id, userId: principal.id }, update: {} });
  const inline = disposition === "inline" && (r.file.mimeType === "application/pdf" || r.file.mimeType.startsWith("image/"));
  return signedUrl(r.fileId, inline ? "inline" : "attachment");
}

// ---------------------------------------------------------------------------
// Plan & billing (read-only; invoices arrive with Phase 7)
// ---------------------------------------------------------------------------

export async function portalPlan(principal: Principal) {
  const rows = await prisma.clientService.findMany({
    where: { client: mine(principal), status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { startDate: "asc" },
    select: { id: true, price: true, billing: true, status: true, startDate: true, service: { select: { name: true } } },
  });
  return {
    services: rows.map((r) => ({ id: r.id, name: r.service.name, price: r.price, billing: r.billing, status: r.status, since: r.startDate.toISOString().slice(0, 10) })),
    monthly: rows.filter((r) => r.status === "ACTIVE").reduce((t, r) => t + monthlyEquivalent(r.price, r.billing), 0),
  };
}

// ---------------------------------------------------------------------------
// People on the account, invitations, preferences
// ---------------------------------------------------------------------------

export const INVITE_DAYS = 7;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates an invitation; returns the one-time link (shown once, emailed when email is set up). */
export async function createInvite(input: { organizationId: string; clientAccountId: string; email: string; name: string; clientRole: "OWNER" | "MEMBER"; invitedById: string }) {
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw new PortalError("Someone already has an account with that email", 409);
  await prisma.clientInvite.updateMany({ where: { clientAccountId: input.clientAccountId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = randomBytes(24).toString("base64url");
  const invite = await prisma.clientInvite.create({
    data: {
      organizationId: input.organizationId,
      clientAccountId: input.clientAccountId,
      email,
      name: input.name.trim(),
      clientRole: input.clientRole,
      tokenHash: hashToken(token),
      invitedById: input.invitedById,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
    select: { id: true, email: true, expiresAt: true },
  });
  return { invite, path: `/invite/${token}` };
}

export async function accountPeople(clientAccountId: string) {
  const [users, invites] = await Promise.all([
    prisma.user.findMany({ where: { clientAccountId, role: "CLIENT" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, clientRole: true, isActive: true, avatarColor: true, createdAt: true } }),
    prisma.clientInvite.findMany({ where: { clientAccountId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, clientRole: true, expiresAt: true } }),
  ]);
  return {
    users: users.map((u) => ({ ...u, clientRole: u.clientRole ?? "MEMBER", createdAt: u.createdAt.toISOString() })),
    invites: invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
  };
}

/** Tells a project's client that an update was shared with them. */
export async function notifyUpdateShared(projectId: string, title: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { title: true, client: { select: { clientAccountId: true } } } });
  if (!p?.client.clientAccountId) return;
  await notifyAccount(p.client.clientAccountId, "updates", {
    type: "UPDATE_SHARED",
    title: `${p.title}: ${title}`,
    body: "Your team shared an update on your project.",
    href: `/portal/projects/${projectId}`,
  });
}

/** Tells an account's logins something, honouring each person's preference for that kind. */
export async function notifyAccount(clientAccountId: string, kind: NotificationKind, message: { type: "REPORT_SHARED" | "UPDATE_SHARED" | "MESSAGE_RECEIVED"; title: string; body: string; href: string }) {
  const users = await prisma.user.findMany({ where: { clientAccountId, role: "CLIENT", isActive: true }, select: { id: true, notificationPrefs: true } });
  for (const u of users.filter((x) => parsePrefs(x.notificationPrefs)[kind])) {
    await notify({ userId: u.id, ...message });
  }
}
