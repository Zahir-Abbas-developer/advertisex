import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { viewerFor } from "@/lib/viewer";
import { getCurrentUser } from "@/lib/session";
import { canSeePipelineTotals, isOwner } from "@/lib/visibility";
import { serializeLead } from "@/lib/serializers";
import { requireApi } from "@/modules/rbac/server";
import { LEAD_INCLUDE, filtersFromRequest, toLeadSource, whereFor } from "@/modules/leads/server";

const SORTS = {
  created: "createdAt",
  updated: "stageChangedAt",
  value: "dealValue",
  name: "businessName",
} as const;

/**
 * The pipeline as a table: every lead the viewer may see, across their
 * departments, filtered and sorted server-side and paged — the same filters
 * as the board and the export (modules/leads/server.ts).
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const viewer = await viewerFor(user);
  const canSeeValues = canSeePipelineTotals(viewer);
  const url = new URL(request.url);
  const filters = filtersFromRequest(url, canSeeValues);
  const where = whereFor(filters, isOwner(viewer) ? null : viewer.departmentIds);

  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") ?? 50)));
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const sortKey = (url.searchParams.get("sort") ?? "updated") as keyof typeof SORTS;
  // Nobody may sort by a number they cannot see.
  const sortField = sortKey === "value" && !canSeeValues ? "stageChangedAt" : (SORTS[sortKey] ?? "stageChangedAt");
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  const [total, rows, stages] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ [sortField]: dir }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { ...LEAD_INCLUDE, department: { select: { shortLabel: true } } },
    }),
    prisma.pipelineStage.findMany({ select: { departmentId: true, key: true, label: true, kind: true } }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    leads: rows.map((row) => ({
      ...serializeLead(toLeadSource(row), viewer),
      department: row.department.shortLabel,
      stageLabel: stages.find((s) => s.departmentId === row.departmentId && s.key === row.stage)?.label ?? row.stage,
    })),
    canSeeValues,
  });
}
