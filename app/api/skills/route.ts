import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { requireApi } from "@/modules/rbac/server";

/** The skills taxonomy: readable by all staff, extended by the founder. */
export async function GET() {
  const access = await requireApi("read", "skill");
  if (access.response) return access.response;

  const skills = await prisma.skill.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true, isActive: true, _count: { select: { holders: true } } },
  });
  return NextResponse.json({
    skills: skills.map(({ _count, ...s }) => ({ ...s, holders: _count.holders })),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  category: z.string().trim().min(2).max(40).default("General"),
});

export async function POST(request: Request) {
  const access = await requireApi("create", "skill", "Only the founder can extend the skills catalog");
  if (access.response) return access.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));

  const exists = await prisma.skill.findFirst({ where: { name: { equals: parsed.data.name } } });
  if (exists) return apiError("Please fix the highlighted fields", 422, { name: "That skill is already in the catalog" });

  if (!access.principal.organizationId) return apiError("Your account has no organization", 403);
  const skill = await prisma.skill.create({
    data: { name: parsed.data.name, category: parsed.data.category, organizationId: access.principal.organizationId },
  });
  return NextResponse.json({ skill }, { status: 201 });
}
