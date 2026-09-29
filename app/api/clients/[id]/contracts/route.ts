import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { parseDateInput } from "@/lib/date";
import { requireApi } from "@/modules/rbac/server";
import { clientFor, seesMoney } from "@/modules/clients/server";
import { contractFields } from "@/modules/clients/contracts";
import { toView } from "@/modules/files/server";

/** A client's contracts, with their files. Values are the founder's only. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "client");
  if (gate.response) return gate.response;
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", found.status);

  const money = seesMoney(gate.principal);
  const rows = await prisma.contract.findMany({
    where: { clientId: params.id },
    orderBy: [{ createdAt: "desc" }],
    include: { files: { orderBy: { createdAt: "desc" }, include: { uploader: { select: { id: true, name: true } } } } },
  });
  return NextResponse.json({
    contracts: rows.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      startDate: c.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: c.endDate?.toISOString().slice(0, 10) ?? null,
      signedAt: c.signedAt?.toISOString().slice(0, 10) ?? null,
      value: money ? c.value : null,
      notes: c.notes,
      files: c.files.map(toView),
    })),
    canManage: gate.principal.role === "FOUNDER" || gate.principal.role === "MANAGER",
    seesValue: money,
  });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  if (gate.principal.role === "EMPLOYEE") return apiError("Only the founder and managers manage contracts", 403);
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);

  const parsed = z.object(contractFields).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;
  const dates: Record<string, Date | null> = {};
  for (const k of ["startDate", "endDate", "signedAt"] as const) {
    const v = d[k];
    const parsedDate = v ? parseDateInput(v) : null;
    if (v && !parsedDate) return apiError("Please fix the highlighted fields", 422, { [k]: "Not a date" });
    dates[k] = parsedDate;
  }
  if (dates.startDate && dates.endDate && dates.endDate < dates.startDate) return apiError("Please fix the highlighted fields", 422, { endDate: "Ends before it starts" });

  const contract = await prisma.contract.create({
    data: {
      organizationId: found.client.organizationId ?? gate.principal.organizationId ?? "",
      clientId: found.client.id,
      title: d.title,
      status: d.status,
      startDate: dates.startDate,
      endDate: dates.endDate,
      signedAt: dates.signedAt,
      value: seesMoney(gate.principal) ? d.value ?? 0 : 0,
      notes: d.notes ?? null,
    },
    select: { id: true },
  });
  return NextResponse.json({ contract }, { status: 201 });
}
