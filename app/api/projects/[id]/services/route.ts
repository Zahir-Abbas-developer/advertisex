import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma, transaction } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor, servicesForPlan, writePlan } from "@/modules/projects/server";

const schema = z.object({ serviceIds: z.array(z.string().min(1)).max(20) }).strict();

/**
 * Changes the services on a project. An added service brings its stage line
 * (from its template) and its skills; a removed one takes its stage line with
 * it (milestones in those stages stay, unstaged) and any skill no remaining
 * service needs, unless it was added by hand.
 */
export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change a project's services", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { serviceIds: "Pick services" });
  const wanted = [...new Set(parsed.data.serviceIds)];

  const current = (await prisma.projectService.findMany({ where: { projectId: params.id }, select: { serviceId: true } })).map((s) => s.serviceId);
  const addIds = wanted.filter((id) => !current.includes(id));
  const removeIds = current.filter((id) => !wanted.includes(id));
  const adding = await servicesForPlan(addIds);
  if (adding.length !== addIds.length) return apiError("Please fix the highlighted fields", 422, { serviceIds: "One of those services isn't available" });

  const keepSkills = new Set(
    (await prisma.serviceSkill.findMany({ where: { serviceId: { in: wanted } }, select: { skillId: true } })).map((s) => s.skillId),
  );

  await transaction(async (tx) => {
    if (removeIds.length) {
      await tx.projectStage.deleteMany({ where: { projectId: params.id, serviceId: { in: removeIds } } });
      await tx.projectService.deleteMany({ where: { projectId: params.id, serviceId: { in: removeIds } } });
      await tx.projectSkill.deleteMany({ where: { projectId: params.id, source: "DERIVED", skillId: { notIn: [...keepSkills] } } });
    }
    if (adding.length && current.length === 0) {
      // The generic plan was standing in for services; the real ones replace
      // it, except any stage that already holds milestones.
      await tx.projectStage.deleteMany({ where: { projectId: params.id, serviceId: null, milestones: { none: {} } } });
    }
    if (adding.length) {
      // writePlan adds the services, their stage lines and their skills; a
      // skill the project already lists is skipped rather than duplicated.
      const existingSkills = new Set((await tx.projectSkill.findMany({ where: { projectId: params.id }, select: { skillId: true } })).map((s) => s.skillId));
      await writePlan(
        tx,
        params.id,
        adding.map((s) => ({ ...s, skills: s.skills.filter((k) => !existingSkills.has(k.skillId)) })),
        new Date(),
      );
    }
    // A project whose last service went keeps a generic plan rather than none.
    if (wanted.length === 0 && (await tx.projectStage.count({ where: { projectId: params.id } })) === 0) {
      await writePlan(tx, params.id, [], new Date());
    }
  });
  return NextResponse.json({ ok: true, added: addIds.length, removed: removeIds.length });
}
