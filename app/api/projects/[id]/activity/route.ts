import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { describeProjectEvent } from "@/modules/projects/activity";
import { projectFor } from "@/modules/projects/server";

const TYPES = ["Project", "ProjectStage", "ProjectMilestone", "ProjectMember", "ProjectService", "ProjectComment", "Task", "File"];

/**
 * The project's activity, read from the audit log: rows about the project
 * itself, or any row whose recorded values name this project (which also
 * catches things since deleted).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "read");
  if (!found.project) return apiError("That project doesn't exist", 404);

  const marker = `"projectId":"${params.id}"`;
  const entries = await prisma.auditLog.findMany({
    where: {
      entityType: { in: TYPES },
      OR: [{ entityId: params.id }, { afterJson: { contains: marker } }, { beforeJson: { contains: marker } }],
    },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: { id: true, action: true, entityType: true, beforeJson: true, afterJson: true, createdAt: true, actorType: true, actor: { select: { name: true } } },
  });

  const parse = (json: string | null) => {
    try {
      return json ? (JSON.parse(json) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const parsed = entries.map((e) => ({ ...e, before: parse(e.beforeJson), after: parse(e.afterJson) }));
  const userIds = new Set<string>();
  const serviceIds = new Set<string>();
  for (const e of parsed) {
    const row = e.after ?? e.before ?? {};
    for (const k of ["userId", "ownerId"]) if (typeof row[k] === "string") userIds.add(row[k] as string);
    if (typeof row.serviceId === "string") serviceIds.add(row.serviceId);
  }
  const [users, services] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }),
    prisma.serviceCatalog.findMany({ where: { id: { in: [...serviceIds] } }, select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  const activity = parsed
    .map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      actor: e.actor?.name ?? (e.actorType === "SYSTEM" ? "Advertise X" : "Someone"),
      text: describeProjectEvent(e, {
        user: (id) => (typeof id === "string" ? userName.get(id) ?? null : null),
        service: (id) => (typeof id === "string" ? serviceName.get(id) ?? null : null),
      }),
    }))
    .filter((e) => e.text);
  return NextResponse.json({ activity });
}
