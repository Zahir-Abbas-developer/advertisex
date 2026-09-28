"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Receipt, RefreshCw, Search } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";
import { formatMoney, InvoiceStatusBadge, type InvoiceRow } from "@/components/billing/shared";

const FILTERS = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "DRAFT", label: "Drafts" },
  { key: "PAID", label: "Paid" },
  { key: "VOID", label: "Void" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

/** Every invoice, newest first: filter by status, search by number or client, paginate. */
export function InvoicesList() {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ invoices: InvoiceRow[]; total: number; pageSize: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (filter) params.set("status", filter);
    if (q.trim()) params.set("q", q.trim());
    const res = await safeFetch(`/api/invoices?${params}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [filter, q, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const checkOverdue = async () => {
    setChecking(true);
    const res = await safeFetch("/api/invoices/sweep", { method: "POST" });
    setChecking(false);
    if (!res.ok) return toast.error("Couldn't check right now");
    const body = await res.json();
    toast.success(body.moved ? `${body.moved} invoice${body.moved === 1 ? "" : "s"} now overdue` : "Nothing new is overdue");
    void load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Invoices"
        description="Draft, send and track every invoice. Amounts are exact to the cent."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={checking} onClick={() => void checkOverdue()}>
              Check overdue
            </Button>
            <Link href="/invoices/new" className={buttonClasses("primary", "sm")}>
              <Plus className="h-4 w-4" /> New invoice
            </Link>
          </div>
        }
      />

      <Tabs
        items={FILTERS.map((f) => ({ key: f.key, label: f.label }))}
        active={filter}
        onChange={(k) => {
          setFilter(k);
          setPage(1);
        }}
        right={
          <div className="mb-2 w-full sm:w-64">
            <Input aria-label="Search invoices" placeholder="Number or client" icon={<Search className="h-4 w-4" />} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        }
      />

      {failed ? (
        <ErrorState title="Invoices didn't load" onRetry={() => void load()} />
      ) : !data ? (
        <Skeleton className="h-64 rounded-card" />
      ) : data.invoices.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={Receipt}
            title={filter || q ? "No invoices match" : "No invoices yet"}
            description={filter || q ? "Try another filter or search." : "Create the first one — lines can start from the client's services."}
            action={!filter && !q ? <Link href="/invoices/new" className={buttonClasses("primary", "md")}>New invoice</Link> : undefined}
          />
        </Card>
      ) : (
        <>
          <TableShell>
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Client</TH>
                  <TH>Status</TH>
                  <TH>Issued</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Balance</TH>
                </TR>
              </THead>
              <TBody>
                {data.invoices.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <Link href={`/invoices/${i.id}`} className="font-medium text-ink hover:text-brand">
                        {i.numberLabel ?? "Draft"}
                      </Link>
                    </TD>
                    <TD>
                      <span className="block text-ink/85">{i.client.businessName}</span>
                      {i.project && <span className="block text-[12px] text-ink/45">{i.project.title}</span>}
                    </TD>
                    <TD>
                      <InvoiceStatusBadge status={i.status} />
                    </TD>
                    <TD className="text-ink/60">{i.issueDate ? formatDate(i.issueDate) : "—"}</TD>
                    <TD className="text-ink/60">{formatDate(i.dueDate)}</TD>
                    <TD className="text-right tabular-nums text-ink">{formatMoney(i.totalMinor, i.currency)}</TD>
                    <TD className="text-right tabular-nums text-ink/80">{i.status === "DRAFT" || i.status === "VOID" ? "—" : formatMoney(i.balanceMinor, i.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
          <Pagination page={page} pageCount={Math.ceil(data.total / data.pageSize)} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
