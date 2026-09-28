import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { companyTimezone } from "@/lib/company-time";
import { requireApi } from "@/modules/rbac/server";
import { toCsv } from "@/modules/leads/csv";
import { dateOnlyKey, dayKey, INVOICE_STATUS_LABEL, isInvoiceStatus, PAYMENT_METHOD_LABEL, RANGES, RANGE_LABEL, type PaymentMethod, type Range } from "@/modules/billing/domain";
import { toDecimalString } from "@/modules/billing/money";
import { financialOverview } from "@/modules/billing/overview";

/**
 * Exports as CSV (formula-safe cells): `?kind=summary` (the overview's
 * figures and breakdowns for the range), `invoices` (every sent invoice) or
 * `payments` (every payment in the range, reversals marked). Amounts are
 * decimal strings from integer cents — never float-formatted.
 */
export async function GET(request: Request) {
  const gate = await requireApi("read", "finance");
  if (gate.response) return gate.response;
  const organizationId = gate.principal.organizationId;
  if (!organizationId) return apiError("Not found", 404);
  const p = new URL(request.url).searchParams;
  const kind = p.get("kind") ?? "summary";
  const raw = p.get("range") ?? "month";
  const range: Range = (RANGES as readonly string[]).includes(raw) ? (raw as Range) : "month";
  const o = await financialOverview(organizationId, range);
  const d = toDecimalString;
  let rows: unknown[][];

  if (kind === "summary") {
    rows = [
      ["Advertise X — financial summary", RANGE_LABEL[range], `${o.range.from} to ${o.range.to}`, o.currency],
      [],
      ["Figure", "Amount"],
      ["Payments received", d(o.receivedMinor)],
      ["Invoiced", d(o.invoicedMinor)],
      ["Pending (not yet due)", d(o.pendingMinor)],
      ["Overdue", d(o.overdueMinor)],
      ["Outstanding", d(o.outstandingMinor)],
      ["MRR", d(o.mrrMinor)],
      ["ARR", d(o.arrMinor)],
      ["New clients", o.newClients],
      ["Closed deals", o.closedDeals.count],
      ["Closed deal value", d(o.closedDeals.valueMinor)],
      [],
      ["Revenue by client", "Amount"],
      ...o.byClient.map((c) => [c.clientName, d(c.amountMinor)]),
      [],
      ["Revenue by service", "Amount"],
      ...o.byService.map((s) => [s.name, d(s.amountMinor)]),
      [],
      ["Month", "Received", "Invoiced"],
      ...o.trend.map((t) => [t.month, d(t.receivedMinor), d(t.invoicedMinor)]),
    ];
  } else if (kind === "invoices") {
    const invoices = await prisma.invoice.findMany({ where: { organizationId, status: { not: "DRAFT" } }, orderBy: { number: "asc" }, include: { client: { select: { businessName: true } }, project: { select: { title: true } } } });
    rows = [
      ["Number", "Client", "Project", "Status", "Currency", "Issued", "Due", "Total", "Paid", "Balance"],
      ...invoices.map((i) => [
        i.numberLabel,
        i.client.businessName,
        i.project?.title ?? "",
        isInvoiceStatus(i.status) ? INVOICE_STATUS_LABEL[i.status] : i.status,
        i.currency,
        i.issueDate ? dateOnlyKey(i.issueDate) : "",
        dateOnlyKey(i.dueDate),
        d(i.totalMinor),
        d(i.paidMinor),
        d(i.status === "VOID" ? 0 : i.totalMinor - i.paidMinor),
      ]),
    ];
  } else if (kind === "payments") {
    const tz = await companyTimezone();
    const payments = await prisma.payment.findMany({ where: { organizationId }, orderBy: { paidAt: "asc" }, include: { invoice: { select: { numberLabel: true, client: { select: { businessName: true } } } } } });
    rows = [
      ["Date", "Client", "Invoice", "Method", "Reference", "Currency", "Amount", "Reversed"],
      ...payments
        .filter((x) => {
          const k = dayKey(x.paidAt, tz);
          return k >= o.range.from && k <= o.range.to;
        })
        .map((x) => [dayKey(x.paidAt, tz), x.invoice.client.businessName, x.invoice.numberLabel, PAYMENT_METHOD_LABEL[x.method as PaymentMethod] ?? x.method, x.reference ?? "", x.currency, d(x.amountMinor), x.reversedAt ? "yes" : ""]),
    ];
  } else {
    return apiError("Unknown export", 400);
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="advertisex-${kind}-${o.range.from}-to-${o.range.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
