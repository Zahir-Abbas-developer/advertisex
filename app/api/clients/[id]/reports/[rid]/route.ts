import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { remove } from "@/lib/uploads";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";
import { notifyAccount } from "@/modules/portal/server";

async function load(principal: Parameters<typeof clientFor>[0], clientId: string, reportId: string, action: "update" | "delete") {
  const found = await clientFor(principal, clientId, "read");
  if (!found.client) return { error: apiError("Not found", 404) };
  const c = found.client;
  if (!authorize(principal, action, "clientReport", { organizationId: c.organizationId, departmentId: c.departmentId, clientId: c.id }).allowed) {
    return { error: apiError("You can't change this client's reports", 403) };
  }
  const report = await prisma.clientReport.findFirst({ where: { id: reportId, clientId }, select: { id: true, status: true, title: true, fileId: true, generated: true, reviewState: true, summary: true, summarySource: true, data: true, periodMonth: true, file: { select: { storedName: true } } } });
  if (!report) return { error: apiError("Not found", 404) };
  return { client: c, report };
}

const schema = z.object({ status: z.enum(["DRAFT", "PUBLISHED"]).optional(), title: z.string().trim().min(2).max(160).optional() }).strict();

/** Publishes (or withdraws) a report, or renames it. Publishing tells the client. */
export async function PATCH(request: Request, props: { params: Promise<{ id: string; rid: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const loaded = await load(gate.principal, params.id, params.rid, "update");
  if ("error" in loaded) return loaded.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  const { report, client } = loaded;
  const publishing = parsed.data.status === "PUBLISHED" && report.status !== "PUBLISHED";
  // A generated report reaches the client only through review (…/review, "approve").
  if (publishing && report.generated && report.reviewState !== "APPROVED") return apiError("Review and approve this report first", 409);

  const updated = await prisma.clientReport.update({
    where: { id: report.id },
    data: { ...parsed.data, ...(parsed.data.status ? { publishedAt: parsed.data.status === "PUBLISHED" ? new Date() : null } : {}) },
    select: { id: true, status: true, title: true },
  });
  // The file follows: visible to the client only while the report is published.
  if (parsed.data.status) await prisma.file.update({ where: { id: report.fileId }, data: { visibility: updated.status === "PUBLISHED" ? "CLIENT" : "INTERNAL" } });
  if (publishing && client.clientAccountId) {
    await notifyAccount(client.clientAccountId, "reports", { type: "REPORT_SHARED", title: `New report: ${updated.title}`, body: "Open it in your reports.", href: "/portal/reports" });
  }
  return NextResponse.json({ report: updated });
}

/** A report for the team, with a generated report's summary and figures (for review). */
export async function GET(_request: Request, props: { params: Promise<{ id: string; rid: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", 404);
  const r = await prisma.clientReport.findFirst({ where: { id: params.rid, clientId: params.id }, include: { reviewedBy: { select: { name: true } } } });
  if (!r) return apiError("Not found", 404);
  const c = found.client;
  const canReview = authorize(gate.principal, "update", "clientReport", { organizationId: c.organizationId, departmentId: c.departmentId, clientId: c.id }).allowed;
  return NextResponse.json({
    report: { id: r.id, title: r.title, status: r.status, generated: r.generated, reviewState: r.reviewState, summary: r.summary, summarySource: r.summarySource, data: r.data ? JSON.parse(r.data) : null, reviewedBy: r.reviewedBy?.name ?? null, reviewedAt: r.reviewedAt?.toISOString() ?? null, periodMonth: r.periodMonth },
    canReview,
  });
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string; rid: string }> }) {
  const params = await props.params;
  const gate = await requireApi("delete", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const loaded = await load(gate.principal, params.id, params.rid, "delete");
  if ("error" in loaded) return loaded.error;
  // The report row cascades from its file.
  await prisma.file.delete({ where: { id: loaded.report.fileId } });
  await remove(loaded.report.file.storedName);
  return NextResponse.json({ ok: true });
}
