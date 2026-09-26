import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma, transaction } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { listDepartments, uniqueSlug } from "@/lib/departments";
import { DEPARTMENT_COLOR_TOKENS } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";

import { STANDARD_STAGES } from "@/modules/leads/domain";
const departmentSchema = z.object({
  name: z.string().trim().min(2, "Give the department a name").max(120),
  shortLabel: z
    .string()
    .trim()
    .min(1, "Give it a short label")
    .max(24, "Short labels are for badges — keep it under 24 characters"),
  colorToken: z.enum(DEPARTMENT_COLOR_TOKENS).nullish(),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  return NextResponse.json({ departments: await listDepartments() });
}

export async function POST(request: Request) {
  const { user, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = departmentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const data = parsed.data;
  // New departments land at the end rather than the top: an admin adding a
  // business line is not reordering the ones already there.
  const last = await prisma.department.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const slug = await uniqueSlug(data.name);
  // A new department starts with the standard pipeline (Phase 3) rather than
  // an empty board; its stages are its own to rename and reorder afterwards.
  const department = await transaction(async (tx) => {
    const created = await tx.department.create({
      data: {
        slug,
        name: data.name,
        shortLabel: data.shortLabel,
        colorToken: data.colorToken ?? null,
        description: data.description || null,
        order: (last?.order ?? 0) + 1,
      },
    });
    await tx.pipelineStage.createMany({
      data: STANDARD_STAGES.map((stage, index) => ({
        departmentId: created.id,
        key: stage.key,
        label: stage.label,
        kind: stage.kind,
        colorToken: stage.colorToken,
        sortOrder: index + 1,
      })),
    });
    return created;
  });

  await recordAudit({
    actorId: user!.id,
    action: "DEPARTMENT_CREATED",
    entityType: "Department",
    entityId: department.id,
    summary: `Created department ${department.name}`,
  });

  return NextResponse.json({ department }, { status: 201 });
}
