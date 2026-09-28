import "server-only";

import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { buildOverview, dateOnlyKey, dayKey, isInvoiceStatus, lastMonths, monthlyMinor, rangeBounds, type Overview, type Range } from "@/modules/billing/domain";

/**
 * The founder's financial overview (Phase 7 scope 3). The database is read
 * once per figure family; the arithmetic is `buildOverview` and
 * `monthlyMinor` (pure, unit-tested), so the page, the export and the
 * reconciliation test all use the same formulas (docs/METRICS.md).
 */

export type FinancialOverview = Overview & {
  todayKey: string;
  mrrMinor: number;
  arrMinor: number;
  mrrByService: { name: string; amountMinor: number }[];
  newClients: number;
  closedDeals: { count: number; valueMinor: number };
};

export async function financialOverview(organizationId: string, range: Range, now = new Date()): Promise<FinancialOverview> {
  const tz = await companyTimezone();
  const today = dayKey(now, tz);
  const bounds = rangeBounds(range, today);
  // Every range starts within the 12-month trend window. Fetch from a day
  // before it (time zones), then compare exact company-calendar keys in JS.
  const earliest = new Date(`${lastMonths(today, 12)[0]}-01T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 1);
  const inRange = (at: Date) => {
    const k = dayKey(at, tz);
    return k >= bounds.from && k <= bounds.to;
  };

  const [org, invoices, payments, services, clients, deals] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { currency: true } }),
    prisma.invoice.findMany({
      where: { organizationId, status: { not: "DRAFT" } },
      select: {
        id: true,
        clientId: true,
        status: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        issueDate: true,
        client: { select: { businessName: true } },
        lines: { select: { serviceId: true, amountMinor: true, service: { select: { name: true } } } },
      },
    }),
    prisma.payment.findMany({ where: { organizationId, paidAt: { gte: earliest } }, select: { invoiceId: true, amountMinor: true, paidAt: true, reversedAt: true } }),
    prisma.clientService.findMany({ where: { organizationId, status: "ACTIVE" }, select: { price: true, billing: true, status: true, service: { select: { name: true } } } }),
    prisma.client.findMany({ where: { organizationId, createdAt: { gte: earliest } }, select: { createdAt: true } }),
    prisma.salesActivity.findMany({
      where: { type: "DEAL_CLOSED", occurredAt: { gte: earliest }, department: { organizationId } },
      select: { occurredAt: true, leadId: true, lead: { select: { dealValue: true } } },
    }),
  ]);

  const overview = buildOverview({
    currency: org.currency,
    todayKey: today,
    range,
    invoices: invoices.map((i) => ({
      id: i.id,
      clientId: i.clientId,
      clientName: i.client.businessName,
      status: isInvoiceStatus(i.status) ? i.status : "SENT",
      currency: i.currency,
      totalMinor: i.totalMinor,
      paidMinor: i.paidMinor,
      issueKey: i.issueDate ? dateOnlyKey(i.issueDate) : null,
      lines: i.lines.map((l) => ({ serviceId: l.serviceId, serviceName: l.service?.name ?? null, amountMinor: l.amountMinor })),
    })),
    payments: payments.map((p) => ({ invoiceId: p.invoiceId, amountMinor: p.amountMinor, paidKey: dayKey(p.paidAt, tz), reversed: Boolean(p.reversedAt) })),
  });

  const mrrMap = new Map<string, number>();
  for (const s of services) {
    const m = monthlyMinor({ priceWhole: s.price, billing: s.billing, status: s.status });
    if (m) mrrMap.set(s.service.name, (mrrMap.get(s.service.name) ?? 0) + m);
  }
  const mrrMinor = [...mrrMap.values()].reduce((a, b) => a + b, 0);
  // A deal closes once per lead (DEAL_CLOSED is written the first time a lead is won).
  const closed = deals.filter((d) => inRange(d.occurredAt));
  const seen = new Set<string>();
  let valueMinor = 0;
  for (const d of closed) {
    if (!d.leadId || seen.has(d.leadId)) continue;
    seen.add(d.leadId);
    valueMinor += (d.lead?.dealValue ?? 0) * 100;
  }

  return {
    ...overview,
    todayKey: today,
    mrrMinor,
    arrMinor: mrrMinor * 12,
    mrrByService: [...mrrMap.entries()].map(([name, amountMinor]) => ({ name, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor),
    newClients: clients.filter((c) => inRange(c.createdAt)).length,
    closedDeals: { count: seen.size, valueMinor },
  };
}
