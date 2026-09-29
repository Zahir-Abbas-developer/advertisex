import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { parseDateInput } from "@/lib/date";
import { remove } from "@/lib/uploads";
import { requireApi } from "@/modules/rbac/server";
import { clientFor, seesMoney } from "@/modules/clients/server";
import { contractFields } from "@/modules/clients/contracts";

const schema = z
  .object({
    title: contractFields.title.optional(),
    status: z.enum(["DRAFT", "SENT", "SIGNED", "ACTIVE", "EXPIRED", "TERMINATED"]).optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    signedAt: z.string().nullable().optional(),
    value: contractFields.value,
    notes: contractFields.notes,
  })
  .strict();

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string; contractId: string }> }
) {
  const params = await props.params;
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  if (gate.principal.role === "EMPLOYEE") return apiError("Only the founder and managers manage contracts", 403);
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  const { startDate, endDate, signedAt, value, ...rest } = parsed.data;
  if (value !== undefined && !seesMoney(gate.principal)) return apiError("Only the founder sets a contract's value", 403);
  const data: Record<string, unknown> = { ...rest, ...(value !== undefined ? { value } : {}) };
  for (const [k, v] of Object.entries({ startDate, endDate, signedAt })) {
    if (v === undefined) continue;
    const d = v ? parseDateInput(v) : null;
    if (v && !d) return apiError("Please fix the highlighted fields", 422, { [k]: "Not a date" });
    data[k] = d;
  }
  // A contract marked signed without a date was signed today.
  if (rest.status === "SIGNED" && signedAt === undefined) {
    const existing = await prisma.contract.findFirst({ where: { id: params.contractId, clientId: params.id }, select: { signedAt: true } });
    if (existing && !existing.signedAt) data.signedAt = new Date();
  }

  const { count } = await prisma.contract.updateMany({ where: { id: params.contractId, clientId: params.id }, data });
  if (!count) return apiError("Not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string; contractId: string }> }
) {
  const params = await props.params;
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  if (gate.principal.role === "EMPLOYEE") return apiError("Only the founder and managers manage contracts", 403);
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);

  const contract = await prisma.contract.findFirst({ where: { id: params.contractId, clientId: params.id }, select: { id: true, files: { select: { storedName: true } } } });
  if (!contract) return apiError("Not found", 404);
  await prisma.contract.delete({ where: { id: contract.id } });
  for (const f of contract.files) await remove(f.storedName);
  return NextResponse.json({ ok: true });
}
