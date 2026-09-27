import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";

/** Either plain ids (weight 3) or skills with their weights (1–5). */
const schema = z.union([
  z.object({ skillIds: z.array(z.string().min(1)).max(40) }).strict(),
  z.object({ skills: z.array(z.object({ skillId: z.string().min(1), weight: z.number().int().min(1).max(5) })).max(40) }).strict(),
]);

/** Replaces the skills a service needs, with their weights — what new projects derive theirs from. */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireAdminApi();
  if (response) return response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  const rows = "skills" in parsed.data ? parsed.data.skills : parsed.data.skillIds.map((skillId) => ({ skillId, weight: 3 }));
  const weightOf = new Map(rows.map((r) => [r.skillId, r.weight]));
  const ids = [...weightOf.keys()];
  const [service, known] = await Promise.all([
    prisma.serviceCatalog.findUnique({ where: { id: params.id }, select: { id: true } }),
    prisma.skill.count({ where: { id: { in: ids } } }),
  ]);
  if (!service) return apiError("That service no longer exists", 404);
  if (known !== ids.length) return apiError("One of those skills isn't in the taxonomy", 422);

  await prisma.$transaction([
    prisma.serviceSkill.deleteMany({ where: { serviceId: service.id } }),
    prisma.serviceSkill.createMany({ data: ids.map((skillId) => ({ serviceId: service.id, skillId, weight: weightOf.get(skillId) ?? 3 })) }),
  ]);
  return NextResponse.json({ ok: true });
}
