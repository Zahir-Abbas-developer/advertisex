import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { storedRoleValues, type Role } from "@/config/permissions";
import { requireApi } from "@/modules/rbac/server";
import { notify } from "@/lib/notifications";
import { canShapeProject, projectFor } from "@/modules/projects/server";

const schema = z.object({ memberIds: z.array(z.string().min(1)).max(50) }).strict();
const WORKERS: Role[] = ["FOUNDER", "MANAGER", "EMPLOYEE", "AI_AGENT"];

/** Replaces the project's team. The owner always stays on it. */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change the team", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { memberIds: "Pick team members" });
  const ownerId = found.project.ownerId;
  const ids = [...new Set([...parsed.data.memberIds, ...(ownerId ? [ownerId] : [])])];
  const valid = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true, role: { in: WORKERS.flatMap(storedRoleValues) } },
    select: { id: true },
  });
  if (valid.length !== ids.length) return apiError("Please fix the highlighted fields", 422, { memberIds: "Only active team members can be on a project" });

  const before = await prisma.projectMember.findMany({ where: { projectId: params.id }, select: { userId: true } });
  const added = ids.filter((id) => !before.some((b) => b.userId === id));
  const removed = before.filter((b) => !ids.includes(b.userId)).map((b) => b.userId);
  await prisma.$transaction([
    // One row at a time, so the activity feed can say who left and who joined.
    ...removed.map((userId) => prisma.projectMember.delete({ where: { projectId_userId: { projectId: params.id, userId } } })),
    ...added.map((userId) => prisma.projectMember.create({ data: { projectId: params.id, userId, role: userId === ownerId ? "LEAD" : "MEMBER" } })),
  ]);
  for (const userId of added.filter((id) => id !== gate.principal.id)) {
    await notify({
      userId,
      type: "PROJECT_UPDATED",
      title: `You're on ${found.project.title}`,
      body: `${found.project.client.businessName} — added to the project team.`,
      href: `/projects/${params.id}`,
    });
  }
  return NextResponse.json({ ok: true, memberIds: ids });
}
