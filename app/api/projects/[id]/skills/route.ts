import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";

const schema = z.object({ skillIds: z.array(z.string().min(1)).max(60) }).strict();

/**
 * Replaces the project's required skills. A skill its services need is kept
 * as DERIVED; one added by hand is MANUAL. Either can be removed.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change required skills", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { skillIds: "Pick skills" });
  const ids = [...new Set(parsed.data.skillIds)];
  const known = await prisma.skill.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  if (known.length !== ids.length) return apiError("Please fix the highlighted fields", 422, { skillIds: "One of those skills isn't in the taxonomy" });

  const derived = new Set(
    (await prisma.serviceSkill.findMany({ where: { service: { projects: { some: { projectId: params.id } } } }, select: { skillId: true } })).map((s) => s.skillId),
  );
  await prisma.$transaction([
    prisma.projectSkill.deleteMany({ where: { projectId: params.id } }),
    prisma.projectSkill.createMany({ data: ids.map((skillId) => ({ projectId: params.id, skillId, source: derived.has(skillId) ? "DERIVED" : "MANUAL" })) }),
  ]);
  return NextResponse.json({ ok: true });
}
