import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";

const schema = z.object({ name: z.string().trim().min(1, "Name the stage").max(80), serviceId: z.string().min(1).nullish() }).strict();

/** Adds a stage at the end of a service line (or the general line). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change the plan", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { name: "Name the stage" });
  const serviceId = parsed.data.serviceId ?? null;
  if (serviceId && !(await prisma.projectService.findUnique({ where: { projectId_serviceId: { projectId: params.id, serviceId } } }))) {
    return apiError("Please fix the highlighted fields", 422, { serviceId: "That service isn't on this project" });
  }
  const last = await prisma.projectStage.findFirst({ where: { projectId: params.id, serviceId }, orderBy: { order: "desc" }, select: { order: true } });
  const stage = await prisma.projectStage.create({
    data: { projectId: params.id, serviceId, name: parsed.data.name, order: (last?.order ?? -1) + 1 },
  });
  return NextResponse.json({ stage }, { status: 201 });
}
