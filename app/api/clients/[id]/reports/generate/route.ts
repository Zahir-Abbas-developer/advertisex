import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";
import { currentMonth } from "@/modules/client-analytics/server";
import { generateMonthlyReport, ReportError } from "@/modules/monthly-reports/server";

const schema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month"), regenerate: z.boolean().optional() }).strict();

/** Generates (or rebuilds a draft of) a client's monthly report now, instead of waiting for the monthly run. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("create", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", 404);
  const c = found.client;
  if (!authorize(gate.principal, "create", "clientReport", { organizationId: c.organizationId, departmentId: c.departmentId, clientId: c.id }).allowed) return apiError("You can't create this client's reports", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Pick a month", 422, { month: "Pick a month" });
  if (parsed.data.month > (await currentMonth())) return apiError("That month hasn't happened yet", 422, { month: "A past or current month" });
  try {
    const { report, created } = await generateMonthlyReport(c.id, parsed.data.month, { createdById: gate.principal.id, regenerate: parsed.data.regenerate });
    return NextResponse.json({ report: { id: report.id, reviewState: report.reviewState, status: report.status }, created }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ReportError) return apiError(error.message, error.status);
    throw error;
  }
}
