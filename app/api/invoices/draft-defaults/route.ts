import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { suggestedLines } from "@/modules/billing/server";

/** What a new invoice starts from: the organization's currency and terms, and (with `?clientId=`) that client's projects and active services as lines. */
export async function GET(request: Request) {
  const gate = await requireApi("create", "invoice");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  const clientId = new URL(request.url).searchParams.get("clientId");
  const [org, clients, services] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: gate.principal.organizationId }, select: { currency: true, paymentTermsDays: true } }),
    prisma.client.findMany({ where: { status: { not: "CHURNED" } }, orderBy: { businessName: "asc" }, select: { id: true, businessName: true }, take: 500 }),
    prisma.serviceCatalog.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }) : null;
  return NextResponse.json({
    currency: org.currency,
    paymentTermsDays: org.paymentTermsDays,
    clients,
    services,
    projects: client ? await prisma.project.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true } }) : [],
    lines: client ? await suggestedLines(client.id) : [],
  });
}
