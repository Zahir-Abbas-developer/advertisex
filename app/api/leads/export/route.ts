import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { viewerFor } from "@/lib/viewer";
import { getCurrentUser } from "@/lib/session";
import { canSeeDealValue, canSeePipelineTotals, isOwner } from "@/lib/visibility";
import { requireApi } from "@/modules/rbac/server";
import { CSV_COLUMNS, toCsv } from "@/modules/leads/csv";
import { filtersFromRequest, whereFor } from "@/modules/leads/server";

const MAX_ROWS = 10_000;

/**
 * Leads as CSV — the same filters and scope as the table, in the import's
 * column format, so an export can be edited and imported back. Deal values
 * follow the usual rule: blank for anyone who may not see them.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You must be signed in" }, { status: 401 });

  const viewer = await viewerFor(user);
  const url = new URL(request.url);
  const filters = filtersFromRequest(url, canSeePipelineTotals(viewer));
  const where = whereFor(filters, isOwner(viewer) ? null : viewer.departmentIds);

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
    include: { owner: { select: { email: true } } },
  });

  const rows = [
    [...CSV_COLUMNS],
    ...leads.map((l) => [
      l.businessName,
      l.contactName,
      l.email ?? "",
      l.phone ?? "",
      l.website ?? "",
      l.location ?? "",
      l.country ?? "",
      l.industry ?? "",
      l.source,
      l.sourceDetail ?? "",
      canSeeDealValue(viewer, { ownerId: l.ownerId }) ? l.dealValue : "",
      l.stage,
      l.owner?.email ?? "",
      l.tags,
      l.notes ?? "",
    ]),
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
