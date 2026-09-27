import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { parseDateInput } from "@/lib/date";
import { containsInsensitive } from "@/lib/db-features";
import { requireApi } from "@/modules/rbac/server";
import {
  isOpenProject,
  normalizeProjectStatus,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
} from "@/modules/projects/domain";
import { createProject, ProjectError, projectScopeWhere, summarize } from "@/modules/projects/server";

/**
 * Projects (Phase 4).
 *
 *   GET  ?status=OPEN|<status>|ALL &clientId= &q= &mine=1 → list with progress and schedule
 *   POST → create a project and its plan (founder; managers for their clients)
 *
 * No money here: budgets and prices are the founder's, and this list is read
 * by managers and employees too.
 */
export async function GET(request: Request) {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const principal = gate.principal;
  const scope = projectScopeWhere(principal);
  if (!scope) return apiError("You don't have access to projects", 403);

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "OPEN";
  const clientId = url.searchParams.get("clientId");
  const q = url.searchParams.get("q")?.trim();
  const mine = url.searchParams.get("mine") === "1";

  const rows = await prisma.project.findMany({
    where: {
      AND: [
        scope,
        clientId ? { clientId } : {},
        q ? { OR: [{ title: containsInsensitive(q) }, { client: { businessName: containsInsensitive(q) } }] } : {},
        mine ? { OR: [{ ownerId: principal.id }, { members: { some: { userId: principal.id } } }] } : {},
        // "Completed" includes legacy closed-out cycles, which read as completed.
        status === "ALL" || status === "OPEN" ? {} : status === "COMPLETED" ? { status: { in: ["COMPLETED", "OVERDUE_CLOSEOUT"] } } : { status },
      ],
    },
    orderBy: [{ endDate: "asc" }],
    take: 500,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      startDate: true,
      endDate: true,
      client: { select: { id: true, businessName: true } },
      owner: { select: { id: true, name: true, avatarColor: true } },
      members: { select: { user: { select: { id: true, name: true, avatarColor: true } } } },
      services: { select: { service: { select: { id: true, name: true } } } },
      stages: { select: { id: true, name: true, status: true, order: true, serviceId: true }, orderBy: { order: "asc" } },
    },
  });
  // Legacy statuses are read through normalizeProjectStatus, so "open" is
  // filtered here rather than in the query.
  const visible = status === "OPEN" ? rows.filter((r) => isOpenProject(r.status)) : rows;
  const summaries = await summarize(visible);

  return NextResponse.json({
    projects: visible.map((p) => {
      const s = summaries.get(p.id)!;
      const current = p.stages.find((st) => st.status === "ACTIVE") ?? p.stages.find((st) => st.status !== "DONE") ?? null;
      return {
        id: p.id,
        title: p.title,
        status: normalizeProjectStatus(p.status),
        priority: p.priority,
        startDate: p.startDate.toISOString().slice(0, 10),
        deadline: p.endDate.toISOString().slice(0, 10),
        client: p.client,
        owner: p.owner,
        team: p.members.map((m) => m.user),
        services: p.services.map((x) => x.service),
        currentStage: current ? current.name : null,
        progress: s.progress.percent,
        progressBasis: s.progress.basis,
        schedule: s.schedule,
        daysOverdue: s.daysOverdue,
        openMilestones: s.openMilestones,
        openTasks: s.openTasks,
      };
    }),
    viewer: { canCreate: principal.role === "FOUNDER" || principal.role === "MANAGER" },
  });
}

const createSchema = z
  .object({
    clientId: z.string().min(1, "Pick a client"),
    title: z.string().trim().min(2, "Name the project").max(160),
    description: z.string().trim().max(4000).nullish(),
    serviceIds: z.array(z.string().min(1)).max(20).default([]),
    startDate: z.string().min(1, "Pick a start date"),
    deadline: z.string().min(1, "Pick a deadline"),
    status: z.enum(PROJECT_STATUSES).default("PLANNING"),
    priority: z.enum(PROJECT_PRIORITIES).default("MEDIUM"),
    ownerId: z.string().min(1).nullish(),
    memberIds: z.array(z.string().min(1)).max(50).default([]),
  })
  .strict();

export async function POST(request: Request) {
  const gate = await requireApi("create", "project");
  if (gate.response) return gate.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  }
  const d = parsed.data;
  const startDate = parseDateInput(d.startDate);
  const endDate = parseDateInput(d.deadline);
  if (!startDate || !endDate) {
    return apiError("Please fix the highlighted fields", 422, { ...(!startDate ? { startDate: "Not a date" } : {}), ...(!endDate ? { deadline: "Not a date" } : {}) });
  }

  try {
    const project = await createProject(gate.principal, {
      clientId: d.clientId,
      title: d.title,
      description: d.description,
      serviceIds: d.serviceIds,
      startDate,
      endDate,
      status: d.status,
      priority: d.priority,
      ownerId: d.ownerId ?? null,
      memberIds: d.memberIds,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectError) {
      return apiError(error.message, error.status, error.fields?.endDate ? { ...error.fields, deadline: error.fields.endDate } : error.fields);
    }
    throw error;
  }
}
