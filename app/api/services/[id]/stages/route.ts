import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";

const schema = z.object({ stages: z.array(z.string().trim().min(1, "Name every stage").max(60)).min(1, "Keep at least one stage").max(20) }).strict();

/**
 * Replaces a service's stage template. Projects already planned keep the
 * stages they were given — a template edit never rewrites work under way.
 */
export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { response } = await requireAdminApi();
  if (response) return response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Please fix the stages", 422, { stages: parsed.error.issues[0]?.message ?? "" });
  const service = await prisma.serviceCatalog.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!service) return apiError("That service no longer exists", 404);

  await prisma.$transaction([
    prisma.serviceStageTemplate.deleteMany({ where: { serviceId: service.id } }),
    prisma.serviceStageTemplate.createMany({ data: parsed.data.stages.map((name, order) => ({ serviceId: service.id, name, order })) }),
  ]);
  return NextResponse.json({ ok: true });
}
