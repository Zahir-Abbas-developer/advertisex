import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { parseDateInput, startOfCompanyDay } from "@/lib/date";
import { companyTimezone } from "@/lib/company-time";
import { requireApi } from "@/modules/rbac/server";
import { BILLING_CADENCES } from "@/modules/services/catalog";
import { clientFor, seesMoney } from "@/modules/clients/server";

const schema = z
  .object({
    price: z.number().int().min(0).max(10_000_000).optional(),
    billing: z.enum(BILLING_CADENCES).optional(),
    status: z.enum(["ACTIVE", "PAUSED", "ENDED"]).optional(),
    endDate: z.string().nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: { id: string; rowId: string } }) {
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  if (!seesMoney(gate.principal)) return apiError("Only the founder changes what a client buys", 403);
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  const { endDate, ...rest } = parsed.data;
  const end = endDate === undefined ? undefined : endDate ? parseDateInput(endDate) : null;
  if (endDate && !end) return apiError("Please fix the highlighted fields", 422, { endDate: "Not a date" });

  const { count } = await prisma.clientService.updateMany({
    where: { id: params.rowId, clientId: params.id },
    data: {
      ...rest,
      ...(end !== undefined ? { endDate: end } : {}),
      // Ending without a date ends today (date-only); reactivating clears it.
      ...(rest.status === "ENDED" && end === undefined ? { endDate: startOfCompanyDay(new Date(), await companyTimezone()) } : {}),
      ...(rest.status === "ACTIVE" && end === undefined ? { endDate: null } : {}),
    },
  });
  if (!count) return apiError("Not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string; rowId: string } }) {
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  if (!seesMoney(gate.principal)) return apiError("Only the founder changes what a client buys", 403);
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);
  const { count } = await prisma.clientService.deleteMany({ where: { id: params.rowId, clientId: params.id } });
  if (!count) return apiError("Not found", 404);
  return NextResponse.json({ ok: true });
}
