import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { viewerFor } from "@/lib/viewer";
import { canSeePipelineTotals } from "@/lib/visibility";
import { serializeLead } from "@/lib/serializers";
import { creatableDepartments } from "@/lib/departments";
import { commissionsFor, stagesFor } from "@/lib/stages";
import { hasAdminPower } from "@/lib/constants";

import { requireApi } from "@/modules/rbac/server";
import { LEAD_INCLUDE, filtersFromRequest, toLeadSource, whereFor } from "@/modules/leads/server";
/**
 * One department's board.
 *
 * Separate from `GET /api/leads`, which answers "every lead" for the older
 * global pipeline. A board is always a board *of something*: its columns are
 * the chosen department's `PipelineStage` rows, in that department's order,
 * with that department's colours. Nothing here knows how many stages exist or
 * what they are called (Doctrine 3).
 *
 * The department defaults to the viewer's first, so a member with one business
 * line never has to choose.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;

  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const isAdmin = hasAdminPower(user.role);
  const departments = await creatableDepartments(user.id, isAdmin);

  if (departments.length === 0) {
    return NextResponse.json({
      departments: [],
      department: null,
      stages: [],
      leads: [],
      totals: [],
      commissions: [],
      viewer: { id: user.id, isAdmin },
    });
  }

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("departmentId");
  const department =
    departments.find((row) => row.id === requested) ?? departments[0];

  // A requested department the viewer is not in is refused rather than quietly
  // swapped for one they are in — silently showing different data than was
  // asked for is how people come to trust the wrong number.
  if (requested && requested !== department.id) {
    return apiError("That department isn't one of yours", 403);
  }

  const viewer = await viewerFor(user);
  const showTotals = canSeePipelineTotals(viewer);
  const url = new URL(request.url);
  const filters = filtersFromRequest(url, showTotals);
  const legacyOwner = searchParams.get("ownerId");
  if (legacyOwner && legacyOwner !== "ALL" && !filters.ownerId) filters.ownerId = legacyOwner;
  const where = whereFor({ ...filters, departmentId: undefined }, [department.id]);

  /* Paged per column (Phase 3: fast with 1,000+ leads). Counts and values
     come from one aggregate over the whole filtered set, so a column's header
     is exact however few of its cards are loaded; the cards themselves arrive
     PAGE at a time, and `?stage=KEY&skip=N` fetches one column's next page. */
  const PAGE = Math.min(100, Math.max(10, Number(searchParams.get("take") ?? 50)));
  const oneStage = searchParams.get("stage");
  const skip = Math.max(0, Number(searchParams.get("skip") ?? 0));

  if (oneStage) {
    const rows = await prisma.lead.findMany({
      where: { AND: [where, { stage: oneStage }] },
      orderBy: [{ stageChangedAt: "desc" }, { id: "asc" }],
      skip,
      take: PAGE + 1,
      include: LEAD_INCLUDE,
    });
    return NextResponse.json({
      stage: oneStage,
      leads: rows.slice(0, PAGE).map((row) => serializeLead(toLeadSource(row), viewer)),
      hasMore: rows.length > PAGE,
    });
  }

  const [stages, grouped, commissions, services] = await Promise.all([
    stagesFor(department.id),
    prisma.lead.groupBy({ by: ["stage"], where, _count: { _all: true }, _sum: { dealValue: true } }),
    commissionsFor(department.id),
    // Still supplied to the creation form: the service catalogue is an
    // inherited concept awaiting a decision, and dropping it here would remove
    // a working field by omission rather than by choice.
    prisma.serviceCatalog.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      select: { id: true, slug: true, name: true },
    }),
  ]);

  const firstPages = await Promise.all(
    stages.map((stage) =>
      prisma.lead.findMany({
        where: { AND: [where, { stage: stage.key }] },
        orderBy: [{ stageChangedAt: "desc" }, { id: "asc" }],
        take: PAGE,
        include: LEAD_INCLUDE,
      }),
    ),
  );
  const serialized = firstPages.flat().map((row) => serializeLead(toLeadSource(row), viewer));

  // Column headers carry a count for everyone and a total only for those
  // allowed the money — a stage with four small deals and a stage with one
  // large one are not the same pipeline, and a count alone says they are.
  const totals = stages.map((stage, index) => {
    const g = grouped.find((row) => row.stage === stage.key);
    const count = g?._count._all ?? 0;
    return {
      stage: stage.key,
      count,
      hasMore: count > firstPages[index].length,
      ...(showTotals ? { value: g?._sum.dealValue ?? 0 } : {}),
    };
  });

  return NextResponse.json({
    departments: departments.map((row) => ({
      id: row.id,
      shortLabel: row.shortLabel,
      name: row.name,
      colorToken: row.colorToken,
    })),
    department: {
      id: department.id,
      name: department.name,
      shortLabel: department.shortLabel,
      colorToken: department.colorToken,
    },
    stages,
    leads: serialized,
    totals,
    // Commission is money: the table is only assembled for viewers allowed to
    // see deal values at all.
    commissions: showTotals ? commissions : [],
    services,
    filters,
    viewer: {
      id: user.id,
      isAdmin,
      canSeeDealValues: showTotals,
      // Bulk import, analytics and conversion are management actions.
      canManage: access.principal.role === "FOUNDER" || access.principal.role === "MANAGER",
    },
    owners: await prisma.departmentMembership
      .findMany({
        where: { departmentId: department.id, user: { isActive: true } },
        select: { user: { select: { id: true, name: true } } },
      })
      .then((rows) => rows.map((r) => r.user).sort((a, b) => a.name.localeCompare(b.name))),
  });
}
