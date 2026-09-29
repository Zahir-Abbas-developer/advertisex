import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { viewerFor } from "@/lib/viewer";
import { departmentScope } from "@/lib/visibility";
import { containsInsensitive } from "@/lib/db-features";
import { getModuleFlags } from "@/lib/modules";
import { hasAdminPower } from "@/lib/constants";

import { requireApi } from "@/modules/rbac/server";
import { limited } from "@/lib/rate-limit";
import { projectScopeWhere } from "@/modules/projects/server";
import { normalizeRole } from "@/config/permissions";
import { TASK_STATUS_LABEL, normalizeTaskStatus } from "@/modules/tasks/domain";
/**
 * Command palette search.
 *
 * Two things changed here for Advertise X. It now searches **leads**, which it did not
 * before — the pipeline was invisible to the one control meant to find
 * anything. And every record query is department-scoped through the same
 * `departmentScope` the lists use, so a hit can never surface a record the
 * viewer could not open.
 *
 * Scoping search is not the same problem as scoping a list. A list shows what
 * you asked for; search answers whether something *exists* — so an unscoped
 * result leaks the existence, the name, and often the phone number of a record
 * in a department that is not yours, even if clicking it 404s.
 *
 * Matching goes through containsInsensitive, which adds Postgres's
 * `mode: "insensitive"`. Without it search works locally on SQLite and quietly
 * stops matching case in production.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;
  const throttled = limited("search", access.principal.id);
  if (throttled) return throttled;

  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  const isAdmin = hasAdminPower(user.role);
  const viewer = await viewerFor(user);
  const scope = departmentScope(viewer);

  // A member of no department matches nothing rather than everything — the
  // direction a missing filter has to fail in.
  if (!isAdmin && viewer.departmentIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  /**
   * The columns worth searching on a person or a company.
   *
   * Phone and email are partial matches on purpose: half a number read off a
   * missed call is the most common thing anybody types into this box.
   */
  const contactMatch = [
    { businessName: containsInsensitive(query) },
    { contactName: containsInsensitive(query) },
    { email: containsInsensitive(query) },
    { phone: containsInsensitive(query) },
  ];

  try {
    const flags = await getModuleFlags();

    const principal = access.principal;
    const projectScope = projectScopeWhere(principal);
    const [leads, clients, members, projects, milestones, tasks, invoices] = await Promise.all([
      prisma.lead.findMany({
        where: { ...scope, OR: contactMatch },
        take: 6,
        orderBy: { stageChangedAt: "desc" },
        select: {
          id: true,
          businessName: true,
          contactName: true,
          stage: true,
          department: { select: { shortLabel: true } },
        },
      }),
      prisma.client.findMany({
        // Employees find the clients they work on, not every client in their
        // departments (the matrix's "assigned" scope; Phase 10).
        where: { ...scope, OR: contactMatch, ...(access.principal.role === "EMPLOYEE" ? { id: { in: [...access.principal.assignedClientIds] } } : {}) },
        take: 6,
        select: {
          id: true,
          businessName: true,
          industry: true,
          status: true,
          department: { select: { shortLabel: true } },
        },
      }),
      prisma.user.findMany({
        where: { name: containsInsensitive(query), isActive: true },
        take: 5,
        select: { id: true, name: true, jobTitle: true, avatarColor: true, role: true },
      }),
      // Projects, as the Projects page scopes them (Phase 10: they used to hide
      // behind the parked retainer module's flag).
      projectScope
        ? prisma.project.findMany({
            where: { ...projectScope, title: containsInsensitive(query) },
            take: 4,
            select: {
              id: true,
              title: true,
              client: { select: { businessName: true } },
            },
          })
        : [],
      flags.retainerProjects
        ? prisma.milestone.findMany({
            where: {
              title: containsInsensitive(query),
              ...(isAdmin ? {} : { assigneeId: user.id }),
            },
            take: 4,
            orderBy: { dueDate: "asc" },
            select: {
              id: true,
              title: true,
              status: true,
              module: {
                select: {
                  project: {
                    select: { id: true, client: { select: { businessName: true } } },
                  },
                },
              },
            },
          })
        : [],
      // Tasks: the founder's everywhere; others', in their departments — an
      // employee's only their own.
      prisma.task.findMany({
        where: {
          title: containsInsensitive(query),
          ...(isAdmin ? {} : { departmentId: { in: [...viewer.departmentIds] } }),
          ...(principal.role === "EMPLOYEE" ? { OR: [{ assigneeId: user.id }, { createdById: user.id }] } : {}),
        },
        take: 5,
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, status: true, dueAt: true, department: { select: { shortLabel: true } } },
      }),
      // Invoices are the founder's, by number or client.
      principal.role === "FOUNDER"
        ? prisma.invoice.findMany({
            where: { OR: [{ numberLabel: containsInsensitive(query) }, { client: { businessName: containsInsensitive(query) } }] },
            take: 4,
            orderBy: { createdAt: "desc" },
            select: { id: true, numberLabel: true, status: true, client: { select: { businessName: true } } },
          })
        : [],
    ]);

    return NextResponse.json({
      results: [
        ...leads.map((lead) => ({
          kind: "lead" as const,
          id: lead.id,
          title: lead.businessName,
          subtitle: `${lead.department.shortLabel} · ${lead.contactName}`,
          href: `/pipeline?lead=${lead.id}`,
        })),
        ...clients.map((client) => ({
          kind: "client" as const,
          id: client.id,
          title: client.businessName,
          subtitle: `${client.department.shortLabel} · ${client.industry ?? "Client"}`,
          href: `/clients/${client.id}`,
        })),
        ...projects.map((project) => ({
          kind: "project" as const,
          id: project.id,
          title: project.title,
          subtitle: project.client.businessName,
          href: `/projects/${project.id}`,
        })),
        ...milestones.map((milestone) => ({
          kind: "milestone" as const,
          id: milestone.id,
          title: milestone.title,
          subtitle: milestone.module.project.client.businessName,
          // Opens the drawer on the board rather than a dead end.
          href: `/board?milestone=${milestone.id}`,
        })),
        ...tasks.map((task) => ({
          kind: "task" as const,
          id: task.id,
          title: task.title,
          subtitle: `${task.department.shortLabel} · ${taskStatusLabel(task.status)}`,
          href: `/tasks?task=${task.id}`,
        })),
        ...invoices.map((invoice) => ({
          kind: "invoice" as const,
          id: invoice.id,
          title: invoice.numberLabel ?? "Draft invoice",
          subtitle: invoice.client.businessName,
          href: `/invoices/${invoice.id}`,
        })),
        ...members.map((member) => ({
          kind: normalizeRole(member.role) === "AI_AGENT" ? ("agent" as const) : ("member" as const),
          id: member.id,
          title: member.name,
          subtitle: member.jobTitle,
          // AI employees have a public work page; people's profiles are the ops view.
          href: normalizeRole(member.role) === "AI_AGENT" ? (isAdmin ? `/team/${member.id}` : "/agents") : isAdmin ? `/team/${member.id}` : "/my-performance",
        })),
      ],
    });
  } catch {
    return apiError("Search failed", 500);
  }
}

const taskStatusLabel = (status: string) => TASK_STATUS_LABEL[normalizeTaskStatus(status)];
