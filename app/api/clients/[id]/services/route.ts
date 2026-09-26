import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { parseDateInput } from "@/lib/date";
import { requireApi } from "@/modules/rbac/server";
import { BILLING_CADENCES } from "@/modules/services/catalog";
import { clientFor, seesMoney } from "@/modules/clients/server";

/**
 * Services a client has bought. Everyone who may read the client sees which;
 * only the founder sees and sets what they pay.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "client");
  if (gate.response) return gate.response;
  const found = await clientFor(gate.principal, params.id, "read");
  if (!found.client) return apiError("Not found", found.status);

  const money = seesMoney(gate.principal);
  const rows = await prisma.clientService.findMany({
    where: { clientId: params.id },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    select: { id: true, status: true, startDate: true, endDate: true, billing: true, price: true, service: { select: { id: true, name: true } } },
  });
  return NextResponse.json({
    services: rows.map((r) => ({ ...r, price: money ? r.price : null })),
    canManage: money,
  });
}

const schema = z
  .object({
    serviceId: z.string().min(1, "Pick a service"),
    price: z.number().int().min(0).max(10_000_000).optional(),
    billing: z.enum(BILLING_CADENCES).optional(),
    startDate: z.string().min(1, "Pick a start date"),
    endDate: z.string().nullish(),
  })
  .strict();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "client");
  if (gate.response) return gate.response;
  if (!seesMoney(gate.principal)) return apiError("Only the founder records what a client buys", 403);
  const found = await clientFor(gate.principal, params.id, "update");
  if (!found.client) return apiError("Not found", found.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;
  const service = await prisma.serviceCatalog.findUnique({ where: { id: d.serviceId }, select: { id: true, price: true, billing: true, isActive: true } });
  if (!service?.isActive) return apiError("Please fix the highlighted fields", 422, { serviceId: "That service isn't available" });
  const start = parseDateInput(d.startDate);
  const end = d.endDate ? parseDateInput(d.endDate) : null;
  if (!start || (d.endDate && !end)) return apiError("Please fix the highlighted fields", 422, { startDate: "Not a date" });

  const row = await prisma.clientService.create({
    data: {
      organizationId: found.client.organizationId ?? gate.principal.organizationId ?? "",
      clientId: found.client.id,
      serviceId: service.id,
      // The catalog price is the default; what this client agreed wins.
      price: d.price ?? service.price,
      billing: d.billing ?? service.billing,
      startDate: start,
      endDate: end,
    },
  });
  return NextResponse.json({ service: row }, { status: 201 });
}
