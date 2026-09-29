import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { taskAccess } from "@/modules/tasks/server";

/**
 * A task's full history, read from the audit log the data layer writes:
 * every change to the task, its checklist, its comments and its files.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "task");
  if (gate.response) return gate.response;
  const access = await taskAccess(gate.principal, params.id, "read");
  if (!access.ok) return apiError(access.error, access.status);

  const [items, comments, files] = await Promise.all([
    prisma.taskChecklistItem.findMany({ where: { taskId: params.id }, select: { id: true } }),
    prisma.taskComment.findMany({ where: { taskId: params.id }, select: { id: true } }),
    prisma.file.findMany({ where: { taskId: params.id }, select: { id: true } }),
  ]);
  const ids = [params.id, ...items.map((r) => r.id), ...comments.map((r) => r.id), ...files.map((r) => r.id)];

  const entries = await prisma.auditLog.findMany({
    where: { entityId: { in: ids } },
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { name: true } } },
  });

  const parse = (json: string | null) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);
  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      entityType: e.entityType,
      action: e.action,
      actorName: e.actor?.name ?? null,
      actorType: e.actorType,
      before: parse(e.beforeJson),
      after: parse(e.afterJson),
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
