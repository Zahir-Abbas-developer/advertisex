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
export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  // Kept skills keep their weight and source; a skill the services need is
  // DERIVED at its catalog weight; one added by hand is MANUAL at 3.
  const [existing, serviceSkills] = await Promise.all([
    prisma.projectSkill.findMany({ where: { projectId: params.id }, select: { skillId: true, weight: true, source: true } }),
    prisma.serviceSkill.findMany({ where: { service: { projects: { some: { projectId: params.id } } } }, select: { skillId: true, weight: true } }),
  ]);
  const derived = new Map<string, number>();
  for (const k of serviceSkills) derived.set(k.skillId, Math.max(derived.get(k.skillId) ?? 0, k.weight));
  const rows = ids.map((skillId) => {
    const kept = existing.find((e) => e.skillId === skillId);
    if (kept) return { projectId: params.id, skillId, source: kept.source, weight: kept.weight };
    return derived.has(skillId)
      ? { projectId: params.id, skillId, source: "DERIVED", weight: derived.get(skillId)! }
      : { projectId: params.id, skillId, source: "MANUAL", weight: 3 };
  });
  await prisma.$transaction([
    prisma.projectSkill.deleteMany({ where: { projectId: params.id, skillId: { notIn: ids } } }),
    ...rows.filter((r) => !existing.some((e) => e.skillId === r.skillId)).map((r) => prisma.projectSkill.create({ data: r })),
  ]);
  return NextResponse.json({ ok: true });
}
