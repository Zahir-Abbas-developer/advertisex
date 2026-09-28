"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";
import { formatMoney, InvoiceStatusBadge, type InvoiceRow } from "@/components/billing/shared";

/** A client's invoices, on its profile (founder only — billing is the founder's). */
export function ClientInvoicesPanel({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/invoices?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setRows((await res.json()).invoices);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <ErrorState title="Invoices didn't load" onRetry={() => void load()} />;
  if (!rows) return <Skeleton className="h-40 rounded-card" />;
  const owed = rows.filter((r) => ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(r.status));

  return (
    <Card padded={false}>
      <CardHeader
        title="Invoices"
        description={owed.length ? `${owed.length} open · ${owed.filter((r) => r.status === "OVERDUE").length} overdue` : "Nothing owed"}
        action={
          <Link href={`/invoices/new?clientId=${clientId}`} className={buttonClasses("secondary", "sm")}>
            <Plus className="h-4 w-4" /> New invoice
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" description="A new invoice starts from this client's active services." className="py-8" />
      ) : (
        <CardBody className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/invoices/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-[13px] hover:bg-surface-2 sm:px-6">
                  <span className="min-w-[88px] font-medium text-ink">{r.numberLabel ?? "Draft"}</span>
                  <InvoiceStatusBadge status={r.status} />
                  <span className="text-ink-muted">{r.issueDate ? formatDate(r.issueDate) : "Not sent"} · due {formatDate(r.dueDate)}</span>
                  <span className="ml-auto tabular-nums text-ink">{formatMoney(r.totalMinor, r.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      )}
    </Card>
  );
}
