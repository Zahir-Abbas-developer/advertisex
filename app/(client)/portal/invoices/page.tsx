import Link from "next/link";
import { ChevronRight, Download, Receipt } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { InvoiceStatusBadge } from "@/components/billing/shared";
import { formatDate } from "@/lib/date";
import { requireClientPage } from "@/modules/rbac/server";
import { accountOf, isOwner, portalPlan } from "@/modules/portal/server";
import { invoicesForAccount } from "@/modules/billing/portal";
import { formatMoney } from "@/modules/billing/money";
import { BILLING_LABEL, type Billing } from "@/modules/services/catalog";

export const metadata = { title: "Invoices · Advertise X" };

const whole = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/**
 * Invoices and the agreed plan — read-only, the account owner's (Phase 6
 * scope 5; invoices from Phase 7). Never a draft; another account's never.
 */
export default async function PortalInvoices() {
  const principal = await requireClientPage();
  if (!(await isOwner(principal))) {
    return (
      <Card padded={false}>
        <EmptyState icon={Receipt} title="Billing is with your account's owner" description="Invoices and payments are visible to the person who manages your account with us." />
      </Card>
    );
  }
  const [invoices, plan] = await Promise.all([invoicesForAccount(accountOf(principal)), portalPlan(principal)]);
  const due = invoices.filter((i) => ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(i.status));
  const currencies = [...new Set(due.map((i) => i.currency))];
  const overdue = due.filter((i) => i.status === "OVERDUE").length;

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Invoices</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">Invoices and payments</h1>
        <p className="mt-2 text-[14px] text-ink-muted">
          {due.length === 0
            ? "You're all paid up — thank you."
            : currencies.length === 1
              ? `${formatMoney(due.reduce((s, i) => s + i.balanceMinor, 0), currencies[0])} due across ${due.length} invoice${due.length === 1 ? "" : "s"}${overdue ? `, ${overdue} past due` : ""}.`
              : `${due.length} invoices have a balance due.`}
        </p>
      </header>

      <Card padded={false}>
        <CardHeader title="Your invoices" />
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices yet" description="Your invoices will appear here, with their status and a copy to download." className="py-8" />
        ) : (
          <CardBody className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                  <Link href={`/portal/invoices/${inv.id}`} className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="min-w-[96px] font-medium text-ink group-hover:text-brand">{inv.number}</span>
                    <span className="text-[13px] text-ink-muted">{inv.issuedAt ? formatDate(inv.issuedAt) : ""} · due {formatDate(inv.dueAt)}</span>
                    <InvoiceStatusBadge forClient status={inv.status} />
                    <span className="ml-auto text-right tabular-nums text-ink">
                      {formatMoney(inv.totalMinor, inv.currency)}
                      {inv.balanceMinor > 0 && inv.balanceMinor !== inv.totalMinor && <span className="block text-[12px] text-ink-muted">{formatMoney(inv.balanceMinor, inv.currency)} left</span>}
                    </span>
                  </Link>
                  <a href={`${inv.downloadUrl}?download=1`} className="rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Download ${inv.number}`}>
                    <Download className="h-4 w-4" />
                  </a>
                  <ChevronRight className="hidden h-4 w-4 text-ink-muted sm:block" />
                </li>
              ))}
            </ul>
          </CardBody>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader title="Your plan" description="The services you have with us, as agreed." />
        <CardBody>
          {plan.services.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Your services will be listed here.</p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {plan.services.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]">
                    <span className="text-ink">
                      {s.name}
                      {s.status === "PAUSED" && <span className="ml-2 text-ink-muted">(paused)</span>}
                    </span>
                    <span className="tabular-nums text-ink-2">
                      {whole(s.price)} <span className="text-ink-muted">{(BILLING_LABEL[s.billing as Billing] ?? "").toLowerCase()}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {plan.monthly > 0 && <p className="mt-3 text-[13px] text-ink-muted">About {whole(plan.monthly)} a month for ongoing services.</p>}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
