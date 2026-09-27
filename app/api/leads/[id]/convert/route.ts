import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { ConvertError, convertLead } from "@/modules/leads/convert";
import { onProjectCreated } from "@/modules/assignment/server";

const convertSchema = z.object({
  serviceIds: z.array(z.string().min(1)).max(20).default([]),
  projectTitle: z.string().trim().max(160).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  monthlyBudget: z.number().int().min(0).max(10_000_000).optional(),
  invite: z
    .object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email("That doesn't look like an email") })
    .nullish(),
});

/**
 * Convert in one action (Phase 3 scope 7): client account, client, first
 * project, history linked, lead won, optional client login — one transaction
 * (modules/leads/convert.ts). Founder or a manager of the lead's department.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("create", "client", "Converting a deal is for the founder and managers");
  if (gate.response) return gate.response;

  const parsed = convertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));

  const lead = await prisma.lead.findUnique({ where: { id: params.id }, select: { departmentId: true } });
  if (!lead) return apiError("That lead no longer exists", 404);
  if (!authorize(gate.principal, "create", "client", { departmentId: lead.departmentId }).allowed) {
    return apiError("That lead isn't in one of your departments", 403);
  }

  try {
    const result = await convertLead(gate.principal, params.id, parsed.data);
    // The first project gets its team plan like any other (Phase 5).
    await onProjectCreated(result.projectId, gate.principal.id);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ConvertError) return apiError(error.message, error.status, error.fields);
    throw error;
  }
}
