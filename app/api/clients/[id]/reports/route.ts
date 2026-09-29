import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma, transaction } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { MAX_UPLOAD_BYTES, isAllowedType, save } from "@/lib/uploads";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { clientFor } from "@/modules/clients/server";
import { notifyAccount } from "@/modules/portal/server";
import { monthLabel, REPORT_KINDS, REPORT_KIND_LABEL } from "@/modules/portal/views";

/**
 * A client's reports library, the team side (Phase 6 scope 4 — the manual
 * upload path; automated generation is Phase 8). A report is a file with a
 * title, a type and the month it covers; it reaches the portal only once
 * published.
 */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", found.status);
  const target = { organizationId: found.client.organizationId, departmentId: found.client.departmentId, clientId: found.client.id };
  if (!authorize(gate.principal, "read", "clientReport", target).allowed) return apiError("Not found", 404);

  const rows = await prisma.clientReport.findMany({
    where: { clientId: params.id },
    orderBy: [{ periodMonth: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      kind: true,
      periodMonth: true,
      status: true,
      publishedAt: true,
      createdAt: true,
      fileId: true,
      generated: true,
      reviewState: true,
      summarySource: true,
      file: { select: { filename: true, size: true, mimeType: true } },
      createdBy: { select: { name: true } },
      reads: { select: { readAt: true, user: { select: { name: true } } } },
    },
  });
  return NextResponse.json({
    reports: rows.map((r) => ({ ...r, periodLabel: monthLabel(r.periodMonth), readBy: r.reads.map((x) => x.user.name), reads: undefined })),
    canManage: authorize(gate.principal, "create", "clientReport", target).allowed,
  });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("create", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", found.status);
  const client = found.client;
  if (!authorize(gate.principal, "create", "clientReport", { organizationId: client.organizationId, departmentId: client.departmentId, clientId: client.id }).allowed) {
    return apiError("You can't add reports for this client", 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected a report upload", 400);
  }
  const title = String(form.get("title") ?? "").trim();
  const kind = String(form.get("kind") ?? "MONTHLY");
  const periodMonth = String(form.get("periodMonth") ?? "").trim();
  const publish = form.get("publish") === "true";
  const upload = form.get("file");
  const fields: Record<string, string> = {};
  if (!(upload instanceof File) || upload.size === 0) fields.file = "Choose the report file";
  if (!(REPORT_KINDS as readonly string[]).includes(kind)) fields.kind = "Pick a type";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) fields.periodMonth = "Pick the month it covers";
  if (Object.keys(fields).length) return apiError("Please fix the highlighted fields", 422, fields);
  const file = upload as File;
  if (file.size > MAX_UPLOAD_BYTES) return apiError(`That file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}`, 413, { file: "Too large" });
  if (!isAllowedType(file.type)) return apiError("Reports are PDFs, images, documents or spreadsheets", 415, { file: "Unsupported type" });
  if (!client.organizationId) return apiError("This client has no organization", 422);
  const organizationId = client.organizationId;

  const storedName = await save(randomUUID(), file.type, Buffer.from(await file.arrayBuffer()));
  const name = title || `${REPORT_KIND_LABEL[kind as keyof typeof REPORT_KIND_LABEL]} — ${monthLabel(periodMonth)}`;
  const report = await transaction(async (tx) => {
    const f = await tx.file.create({
      data: { organizationId, uploaderId: gate.principal.id, clientId: client.id, filename: file.name.slice(0, 200) || "report", storedName, mimeType: file.type, size: file.size, visibility: publish ? "CLIENT" : "INTERNAL" },
      select: { id: true },
    });
    return tx.clientReport.create({
      data: { organizationId, clientId: client.id, title: name, kind, periodMonth, fileId: f.id, status: publish ? "PUBLISHED" : "DRAFT", publishedAt: publish ? new Date() : null, createdById: gate.principal.id },
      select: { id: true, status: true, title: true },
    });
  });
  if (report.status === "PUBLISHED" && client.clientAccountId) {
    await notifyAccount(client.clientAccountId, "reports", { type: "REPORT_SHARED", title: `New report: ${report.title}`, body: "Open it in your reports.", href: "/portal/reports" });
  }
  return NextResponse.json({ report }, { status: 201 });
}
