import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";
import { analyze, assignmentSettings, AssignmentError, decide, planFor, sweepRebalance } from "@/modules/assignment/server";
import { WEIGHT_LABEL } from "@/modules/assignment/domain";

/**
 * The project's team plan (Phase 5): the required skills with weights and
 * sources, one recommendation per role with its explanation, the ranked
 * options for overriding it (with why anyone ineligible is), and any open
 * reassignment suggestions. Scores are recomputed live; decisions are stored.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "read");
  if (!found.project) return apiError("That project doesn't exist", 404);

  const [settings, stored, suggestions, live, skills] = await Promise.all([
    assignmentSettings(),
    prisma.assignmentRecommendation.findMany({
      where: { projectId: params.id },
      include: {
        recommended: { select: { id: true, name: true, avatarColor: true, role: true } },
        chosen: { select: { id: true, name: true, avatarColor: true, role: true } },
        decidedBy: { select: { name: true } },
      },
    }),
    prisma.reassignmentSuggestion.findMany({
      where: { projectId: params.id, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: { skill: { select: { name: true } }, from: { select: { id: true, name: true } }, to: { select: { id: true, name: true } } },
    }),
    planFor(params.id),
    prisma.projectSkill.findMany({ where: { projectId: params.id }, select: { skillId: true, source: true, weight: true } }),
  ]);

  const roles = live.plan.map((role) => {
    const rec = stored.find((r) => r.skillId === role.skillId) ?? null;
    const detail = rec ? (JSON.parse(rec.detail || "{}") as { components?: Record<string, number> | null }) : {};
    return {
      skillId: role.skillId,
      skillName: role.skillName,
      weight: role.weight,
      source: skills.find((s) => s.skillId === role.skillId)?.source ?? "DERIVED",
      recommendation: rec
        ? {
            id: rec.id,
            status: rec.status,
            mode: rec.mode,
            score: rec.score,
            explanation: rec.explanation,
            components: detail.components ?? null,
            recommended: rec.recommended,
            chosen: rec.chosen,
            overrideReason: rec.overrideReason,
            decidedBy: rec.decidedBy?.name ?? null,
            decidedAt: rec.decidedAt?.toISOString() ?? null,
          }
        : null,
      // Live: who could take it now, best first — the override options.
      options: [
        ...(role.recommended ? [role.recommended] : []),
        ...role.alternatives,
      ].map((e) => ({ userId: e.userId, name: e.name, isAgent: e.isAgent, score: e.score, explanation: e.explanation, eligible: true })),
      gap: role.gap,
    };
  });

  // Everyone who holds each skill, eligible or not, for the override picker.
  const holders = Object.fromEntries(
    live.plan.map((role) => [
      role.skillId,
      live.candidates
        .filter((c) => (c.skills.get(role.skillId) ?? 0) > 0)
        .map((c) => ({ userId: c.userId, name: c.name, proficiency: c.skills.get(role.skillId) ?? 0 })),
    ]),
  );

  return NextResponse.json({
    mode: settings.mode,
    weights: Object.fromEntries(Object.entries(settings.weights).map(([k, v]) => [k, { label: WEIGHT_LABEL[k as keyof typeof WEIGHT_LABEL], share: v }])),
    roles,
    holders,
    everyone: live.candidates.map((c) => ({ userId: c.userId, name: c.name, isAgent: c.isAgent })).sort((a, b) => a.name.localeCompare(b.name)),
    suggestions: suggestions.map((s) => ({ id: s.id, skill: s.skill.name, from: s.from, to: s.to, reason: s.reason, createdAt: s.createdAt.toISOString() })),
    viewer: { canDecide: canShapeProject(gate.principal, found.project) },
  });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("analyze") }),
  z.object({ action: z.literal("acceptAll") }),
  z.object({ action: z.literal("checkBalance") }),
]);

/** Re-run the analysis, accept every open recommendation, or check the balance now. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers decide assignments", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Unknown action", 422);

  if (parsed.data.action === "analyze") {
    const settings = await assignmentSettings();
    return NextResponse.json({ result: await analyze(params.id, settings.mode) });
  }
  if (parsed.data.action === "checkBalance") {
    return NextResponse.json({ result: await sweepRebalance(new Date(), params.id) });
  }
  const open = await prisma.assignmentRecommendation.findMany({ where: { projectId: params.id, status: "PROPOSED" }, select: { id: true } });
  try {
    for (const r of open) await decide(gate.principal.id, r.id, params.id, { kind: "ACCEPT" });
  } catch (error) {
    if (error instanceof AssignmentError) return apiError(error.message, error.status);
    throw error;
  }
  return NextResponse.json({ accepted: open.length });
}
