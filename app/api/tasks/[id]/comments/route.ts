import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { notify } from "@/lib/notifications";
import { requireApi } from "@/modules/rbac/server";
import { taskAccess } from "@/modules/tasks/server";

/** Comments on a task: anyone who can see the task can read and add them. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "task");
  if (gate.response) return gate.response;
  const access = await taskAccess(gate.principal, params.id, "read");
  if (!access.ok) return apiError(access.error, access.status);

  const comments = await prisma.taskComment.findMany({
    where: { taskId: params.id },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json({ comments });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "task");
  if (gate.response) return gate.response;
  const access = await taskAccess(gate.principal, params.id, "read");
  if (!access.ok) return apiError(access.error, access.status);

  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));

  const comment = await prisma.taskComment.create({
    data: { taskId: params.id, authorId: gate.principal.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true, avatarColor: true } } },
  });

  // The assignee hears about comments on their task from anyone else.
  const { assigneeId, title } = access.task;
  if (assigneeId && assigneeId !== gate.principal.id) {
    await notify({
      userId: assigneeId,
      type: "TASK_ASSIGNED",
      title: `New comment on "${title}"`,
      body: parsed.data.body.slice(0, 140),
      href: "/tasks",
    });
  }
  return NextResponse.json({ comment }, { status: 201 });
}
