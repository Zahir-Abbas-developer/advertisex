import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/session";
import { assignmentSettings } from "@/modules/assignment/server";
import { ASSIGNMENT_MODES, DEFAULT_WEIGHTS } from "@/modules/assignment/domain";

/** The founder's assignment settings: mode, weights, and the weekly load of a role. */
export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;
  const s = await assignmentSettings();
  return NextResponse.json({ mode: s.mode, weights: { ...DEFAULT_WEIGHTS, ...s.rawWeights }, roleHours: s.roleHours, aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_ENABLED !== "false" });
}

const weight = z.number().int().min(0).max(100);
const schema = z
  .object({
    mode: z.enum(ASSIGNMENT_MODES),
    weights: z.object({ skillMatch: weight, availability: weight, capacity: weight, performance: weight, deadlineFit: weight }),
    roleHours: z.number().int().min(1).max(40),
  })
  .strict()
  .refine((v) => Object.values(v.weights).some((w) => w > 0), { message: "At least one weight must be above zero", path: ["weights"] });

export async function PATCH(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;
  const user = await getCurrentUser();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Please fix the highlighted fields", 422);
  const before = await assignmentSettings();
  await prisma.settings.update({
    where: { id: "singleton" },
    data: { assignmentMode: parsed.data.mode, assignmentWeights: JSON.stringify(parsed.data.weights), assignmentRoleHours: parsed.data.roleHours },
  });
  await recordAudit({
    actorId: user?.id ?? null,
    action: "SETTINGS_EDITED",
    entityType: "Settings",
    entityId: "singleton",
    summary: "Changed project assignment settings",
    before: { mode: before.mode, weights: before.rawWeights, roleHours: before.roleHours },
    after: parsed.data,
  });
  return NextResponse.json({ ok: true });
}
