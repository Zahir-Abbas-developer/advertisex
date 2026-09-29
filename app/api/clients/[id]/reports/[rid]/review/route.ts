import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";
import { approveAndPublish, ReportError, reviseSummary } from "@/modules/monthly-reports/server";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revise"), summary: z.string().trim().min(40, "A few sentences, please").max(2000) }).strict(),
  z.object({ action: z.literal("approve") }).strict(),
]);

/**
 * The human review of a generated report: edit its summary (the PDF is
 * re-rendered), or approve it — which publishes it to the client's library
 * and tells them. Founders and the department's managers only.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string; rid: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", 404);
  const c = found.client;
  if (!authorize(gate.principal, "update", "clientReport", { organizationId: c.organizationId, departmentId: c.departmentId, clientId: c.id }).allowed) return apiError("You can't review this client's reports", 403);
  const report = await prisma.clientReport.findFirst({ where: { id: params.rid, clientId: c.id }, select: { id: true } });
  if (!report) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Not a valid review", 422, { summary: parsed.error.issues[0]?.message ?? "" });
  try {
    if (parsed.data.action === "revise") await reviseSummary(report.id, parsed.data.summary);
    else await approveAndPublish(report.id, gate.principal.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ReportError) return apiError(error.message, error.status);
    throw error;
  }
}
