import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { viewerFor } from "@/lib/viewer";
import { metricsFor, RANGE_PRESETS, type RangePreset } from "@/lib/analytics";
import { canSeeMemberNumbers, canSeePipelineTotals } from "@/lib/visibility";

import { requireApi } from "@/modules/rbac/server";
/**
 * The dashboard's figures.
 *
 * Every number is computed in `lib/analytics.ts` against the viewer's own
 * departments. Nothing is filtered here and nothing is filtered in the
 * component: an aggregate is a disclosure like any other, and a total computed
 * over records the viewer cannot open is a leak with a number in front of it.
 *
 * The `departmentId` parameter can only narrow what the viewer may already see.
 * `metricsFor` ignores one they do not belong to rather than trusting it —
 * a query string is not a permission.
 *
 * Money and colleagues' numbers follow the visibility rules on top (Phase 10):
 * pipeline value, won value and revenue only for those who may see pipeline
 * totals; `memberId` only for someone whose numbers the viewer may see; the
 * per-person table only rows the viewer may see.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "analytics");
  if (access.response) return access.response;

  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("preset");
  const preset: RangePreset =
    requested && (RANGE_PRESETS as readonly string[]).includes(requested)
      ? (requested as RangePreset)
      : "THIS_MONTH";

  const viewer = await viewerFor(user);

  const memberId = searchParams.get("memberId");
  if (memberId && !canSeeMemberNumbers(viewer, memberId)) return apiError("Not found", 404);

  const analytics = await metricsFor(viewer, {
    departmentId: searchParams.get("departmentId"),
    memberId,
    preset,
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  const byMember = analytics.byMember.filter((row) => canSeeMemberNumbers(viewer, row.userId));
  if (canSeePipelineTotals(viewer)) return NextResponse.json({ ...analytics, byMember });

  const { totals, byDepartment, charts } = analytics;
  return NextResponse.json({
    ...analytics,
    totals: { ...totals, openDeals: { count: totals.openDeals.count, value: null }, wonDeals: { count: totals.wonDeals.count, value: null }, revenue: null },
    byDepartment: byDepartment.map((row) => ({ ...row, revenue: null })),
    byMember,
    charts: { ...charts, revenueByDepartment: [], pipelineByStage: charts.pipelineByStage.map((row) => ({ ...row, value: null })) },
  });
}
