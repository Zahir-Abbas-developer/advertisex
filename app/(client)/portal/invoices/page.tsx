import { Receipt } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/date";
import { requireClientPage } from "@/modules/rbac/server";
import { accountOf, isOwner, portalPlan } from "@/modules/portal/server";
import { invoicesForAccount } from "@/modules/billing/portal";
import { BILLING_LABEL, type Billing } from "@/modules/services/catalog";

export const metadata = { title: "Invoices · Advertise X" };

const money = (n: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

/**
 * Invoices and the agreed plan — read-only, the account owner's (Phase 6
 * scope 5). Invoices come from billing (Phase 7) through one seam; until
 * then the list is empty and says so plainly.
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

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Invoices</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">Invoices and payments</h1>
      </header>

      <Card padded={false}>
        <CardHeader title="Invoices" />
        {invoices.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices yet" description="Your invoices will appear here, with their status and a copy to download." className="py-8" />
        ) : (
          <CardBody className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-[13px] sm:px-6">
                  <span className="text-ink">
                    {inv.number} · {formatDate(inv.issuedAt)}
                  </span>
                  <span className="tabular-nums text-ink">{money(inv.total, inv.currency)}</span>
                  <span className="text-ink/60">{inv.status === "PAID" ? "Paid" : inv.status === "OVERDUE" ? "Overdue" : inv.status === "VOID" ? "Cancelled" : "Due"}</span>
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
            <p className="text-[13px] text-ink/50">Your services will be listed here.</p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {plan.services.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]">
                    <span className="text-ink">
                      {s.name}
                      {s.status === "PAUSED" && <span className="ml-2 text-ink/45">(paused)</span>}
                    </span>
                    <span className="tabular-nums text-ink/75">
                      {money(s.price)} <span className="text-ink/45">{(BILLING_LABEL[s.billing as Billing] ?? "").toLowerCase()}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {plan.monthly > 0 && <p className="mt-3 text-[13px] text-ink/60">About {money(plan.monthly)} a month for ongoing services.</p>}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
