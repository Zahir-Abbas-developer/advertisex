import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { taskBoard } from "@/lib/tasks";
import { canUseDepartment } from "@/lib/departments";
import { canBeAssigned } from "@/lib/assignment";
import { autoAssign, taskSignals } from "@/lib/auto-assign";
import { notify } from "@/lib/notifications";
import { parseDateInput } from "@/lib/date";
import { hasAdminPower, TASK_PRIORITIES } from "@/lib/constants";

import { projectFor } from "@/modules/projects/server";
import { requireApi } from "@/modules/rbac/server";
/**
 * The daily working surface: everything owed, in buckets.
 *
 * Department-scoped, so this list cannot become a way to read another business
 * line's client names — a task title carries one.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "task");
  if (access.response) return access.response;

  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const priority = searchParams.get("priority");

  const { rows, timeZone } = await taskBoard(user.id, hasAdminPower(user.role), {
    departmentId: searchParams.get("departmentId"),
    assigneeId: searchParams.get("assigneeId"),
    priority:
      priority && (TASK_PRIORITIES as readonly string[]).includes(priority)
        ? (priority as (typeof TASK_PRIORITIES)[number])
        : null,
    mineOnly: searchParams.get("mine") === "1",
  });

  return NextResponse.json({
    tasks: rows,
    timeZone,
    viewer: { id: user.id, isAdmin: hasAdminPower(user.role) },
  });
}

const createSchema = z
  .object({
    title: z.string().trim().min(2, "Give the task a title").max(160),
    note: z.string().trim().max(2000).nullish(),
    /** Omitted for a project task: the project decides it. */
    departmentId: z.string().min(1, "Pick a department").optional(),
    leadId: z.string().min(1).nullish(),
    clientId: z.string().min(1).nullish(),
    /** Phase 4: a task in a project (its client's department, its team). */
    projectId: z.string().min(1).nullish(),
    assigneeId: z.string().min(1).nullish(),
    /** `YYYY-MM-DD`, read on the company clock like every other due date. */
    dueAt: z.string().trim().nullish(),
    priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  })
  .refine((value) => Boolean(value.departmentId || value.projectId), {
    message: "Pick a department",
    path: ["departmentId"],
  })
  .refine((value) => !(value.leadId && value.clientId), {
    message: "A task hangs off a lead or a client, not both",
    path: ["leadId"],
  });

export async function POST(request: Request) {
  const access = await requireApi("create", "task");
  if (access.response) return access.response;

  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const data = parsed.data as typeof parsed.data & { departmentId: string };
  const isAdmin = hasAdminPower(user.role);

  // A project task: the project decides the department and the client, and
  // anyone working on the project may add one for anyone on its team.
  let projectTeam: Set<string> | null = null;
  if (data.projectId) {
    const found = await projectFor(access.principal, data.projectId, "update");
    if (!found.project) return apiError("That project doesn't exist", found.status);
    if (data.leadId) return apiError("Please fix the highlighted fields", 422, { leadId: "A project task can't also hang off a lead" });
    data.departmentId = found.project.client.departmentId;
    data.clientId = found.project.clientId;
    const members = await prisma.projectMember.findMany({ where: { projectId: found.project.id }, select: { userId: true } });
    projectTeam = new Set([...members.map((m) => m.userId), ...(found.project.ownerId ? [found.project.ownerId] : [])]);
  } else if (!data.departmentId || !(await canUseDepartment(user.id, isAdmin, data.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  // The record a task hangs off must live in the same department, or the task
  // would appear on one board while its subject sits on another.
  if (data.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId },
      select: { departmentId: true },
    });
    if (!lead || lead.departmentId !== data.departmentId) {
      return apiError("Please fix the highlighted fields", 422, {
        leadId: "That lead isn't in this department",
      });
    }
  }
  if (data.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
      select: { departmentId: true },
    });
    if (!client || client.departmentId !== data.departmentId) {
      return apiError("Please fix the highlighted fields", 422, {
        clientId: "That client isn't in this department",
      });
    }
  }

  if (data.assigneeId && projectTeam && !projectTeam.has(data.assigneeId)) {
    return apiError("Please fix the highlighted fields", 422, {
      assigneeId: "That person isn't on this project's team",
    });
  }
  if (data.assigneeId && !projectTeam && !(await canBeAssigned(data.departmentId, data.assigneeId))) {
    return apiError("Please fix the highlighted fields", 422, {
      assigneeId: "That person isn't in this department",
    });
  }

  const dueAt = data.dueAt ? parseDateInput(data.dueAt) : null;
  if (data.dueAt && !dueAt) {
    return apiError("Please fix the highlighted fields", 422, {
      dueAt: "That isn't a date we can read",
    });
  }

  /* Who does the work. An explicit choice wins; otherwise the title and note
     are read for what the job actually is and it goes to the person in this
     department who does that, falling back to the lightest workload. The old
     default — whoever typed it in — is still the floor, because unassigned
     work is invisible work. */
  const routed = data.assigneeId || projectTeam
    ? null
    : await autoAssign(
        data.departmentId,
        taskSignals({ title: data.title, note: data.note }),
      );

  const assigneeId = data.assigneeId ?? routed?.userId ?? user.id;

  const task = await prisma.task.create({
    data: {
      departmentId: data.departmentId,
      leadId: data.leadId ?? null,
      clientId: data.clientId ?? null,
      projectId: data.projectId ?? null,
      title: data.title,
      note: data.note || null,
      assigneeId,
      createdById: user.id,
      dueAt,
      priority: data.priority,
    },
  });

  // Work that lands on someone silently is work they find out about late.
  if (assigneeId !== user.id) {
    await notify({
      userId: assigneeId,
      type: "TASK_ASSIGNED",
      title: "A task was assigned to you",
      body: routed?.reason
        ? `${data.title} — ${routed.reason}.`
        : `${data.title} was assigned to you.`,
      href: "/tasks",
    });
  }

  return NextResponse.json(
    {
      task,
      assignment:
        routed && routed.userId
          ? {
              userId: routed.userId,
              name: routed.name,
              strategy: routed.strategy,
              reason: routed.reason,
            }
          : null,
    },
    { status: 201 },
  );
}
