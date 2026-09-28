"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatMoney } from "@/lib/pipeline-types";
import { LEAD_SOURCE_LABEL, type LeadFilters, type LeadSource } from "@/modules/leads/domain";

type Row = {
  id: string;
  businessName: string;
  contactName: string;
  location?: string | null;
  source: string;
  dealValue?: number;
  stage: string;
  stageLabel: string;
  department: string;
  owner: { name: string } | null;
  tags?: string[];
  createdAt: string;
  stageChangedAt: string;
};

type Sort = "updated" | "created" | "value" | "name";

/**
 * The pipeline as a sortable, paged table — every lead across the viewer's
 * departments, with the same filters as the board. Paged server-side, so a
 * pipeline of any size loads one page at a time.
 */
export function LeadTable({ filters, onOpen }: { filters: LeadFilters; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("updated");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<{ leads: Row[]; total: number; pages: number; canSeeValues: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  // A new filter starts again at page one.
  useEffect(() => setPage(1), [filters]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    const query = new URLSearchParams({ f: JSON.stringify({ ...filters, departmentId: undefined }), page: String(page), sort, dir });
    void fetch(`/api/leads/table?${query}`, { cache: "no-store" }).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) return setFailed(true);
      setFailed(false);
      setData(await res.json());
    });
    return () => {
      cancelled = true;
    };
  }, [filters, page, sort, dir, retry]);

  function sortBy(next: Sort) {
    if (next === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setDir(next === "name" ? "asc" : "desc");
    }
  }

  const SortHead = ({ id, children, right }: { id: Sort; children: React.ReactNode; right?: boolean }) => (
    <TH className={right ? "text-right" : undefined} aria-sort={sort === id ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => sortBy(id)} className="inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-ink">
        {children}
        {sort === id && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TH>
  );

  if (failed) return <ErrorState title="The table didn't load" description="Try again in a moment." onRetry={() => setRetry((n) => n + 1)} />;
  if (!data) return <Skeleton className="h-[420px] rounded-card" />;
  if (data.total === 0) {
    return (
      <Card padded={false}>
        <EmptyState title="No leads match" description="Loosen a filter, or add a lead." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] tabular-nums text-ink-muted">{data.total.toLocaleString()} lead{data.total === 1 ? "" : "s"}</p>
      <TableShell>
        <Table>
          <THead>
            <TR>
              <SortHead id="name">Business</SortHead>
              <TH>Stage</TH>
              <TH>Source</TH>
              <TH>Owner</TH>
              {data.canSeeValues && <SortHead id="value" right>Value</SortHead>}
              <SortHead id="created">Created</SortHead>
              <SortHead id="updated">Last move</SortHead>
            </TR>
          </THead>
          <TBody>
            {data.leads.map((lead) => (
              <TR key={lead.id}>
                <TD>
                  <button type="button" onClick={() => onOpen(lead.id)} className="text-left hover:text-brand">
                    <span className="block text-[13px] font-medium text-ink">{lead.businessName}</span>
                    <span className="block text-[12px] text-ink-muted">
                      {lead.contactName}
                      {lead.location ? ` · ${lead.location}` : ""} · {lead.department}
                    </span>
                  </button>
                </TD>
                <TD><Badge size="sm" tone="neutral">{lead.stageLabel}</Badge></TD>
                <TD className="text-[13px] text-ink-muted">{LEAD_SOURCE_LABEL[lead.source as LeadSource] ?? lead.source}</TD>
                <TD className="text-[13px] text-ink-muted">{lead.owner?.name ?? "—"}</TD>
                {data.canSeeValues && <TD className="text-right tabular-nums">{lead.dealValue !== undefined ? formatMoney(lead.dealValue, true) : "—"}</TD>}
                <TD className="text-[13px] tabular-nums text-ink-muted">{lead.createdAt.slice(0, 10)}</TD>
                <TD className="text-[13px] tabular-nums text-ink-muted">{lead.stageChangedAt.slice(0, 10)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableShell>
      <Pagination page={page} pageCount={data.pages} onPageChange={setPage} />
    </div>
  );
}
