import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { requireApi } from "@/modules/rbac/server";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  category: z.string().trim().min(2).max(40).optional(),
  /** Deactivating hides a skill from pickers; who holds it is kept. */
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireApi("update", "skill", "Only the founder can edit the skills catalog");
  if (access.response) return access.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));

  const skill = await prisma.skill.findUnique({ where: { id: params.id } });
  if (!skill) return apiError("That skill no longer exists", 404);

  const updated = await prisma.skill.update({ where: { id: skill.id }, data: parsed.data });
  return NextResponse.json({ skill: updated });
}
