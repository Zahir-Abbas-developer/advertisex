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
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "read");
  if (!found.project) return apiError("That project doesn't exist", 404);

  // An update records only what changed, so rows are matched by the ids of
  // the project's own records; deleted records are still found by the
  // project id their creation or deletion recorded.
  const [stages, milestones, tasks, files] = await Promise.all([
    prisma.projectStage.findMany({ where: { projectId: params.id }, select: { id: true, name: true } }),
    prisma.projectMilestone.findMany({ where: { projectId: params.id }, select: { id: true, title: true } }),
    prisma.task.findMany({ where: { projectId: params.id }, select: { id: true, title: true } }),
    prisma.file.findMany({ where: { projectId: params.id }, select: { id: true, filename: true } }),
  ]);
  const label = new Map<string, Record<string, string>>([
    ...stages.map((x) => [x.id, { name: x.name }] as const),
    ...milestones.map((x) => [x.id, { title: x.title }] as const),
    ...tasks.map((x) => [x.id, { title: x.title }] as const),
    ...files.map((x) => [x.id, { filename: x.filename }] as const),
  ]);
  const marker = `"projectId":"${params.id}"`;
  const entries = await prisma.auditLog.findMany({
    where: {
      entityType: { in: TYPES },
      OR: [{ entityId: { in: [params.id, ...label.keys()] } }, { afterJson: { contains: marker } }, { beforeJson: { contains: marker } }],
    },
    orderBy: { createdAt: "desc" },
    take: 150,
    select: { id: true, action: true, entityType: true, entityId: true, beforeJson: true, afterJson: true, createdAt: true, actorType: true, actor: { select: { name: true } } },
  });

  const parse = (json: string | null) => {
    try {
      return json ? (JSON.parse(json) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  // Names the diff left out (it holds only what changed) come from the record.
  const parsed = entries.map((e) => {
    const known = e.entityId ? label.get(e.entityId) : undefined;
    const after = parse(e.afterJson);
    const before = parse(e.beforeJson);
    return { ...e, before: before && known ? { ...known, ...before } : before, after: after && known ? { ...known, ...after } : after };
  });
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
