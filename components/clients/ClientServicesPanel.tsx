"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShoppingBag } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/date";
import { BILLING_CADENCES, BILLING_LABEL, type Billing } from "@/modules/services/catalog";
import { safeFetch } from "@/lib/safe-fetch";

type Row = { id: string; status: string; startDate: string; endDate: string | null; billing: string; price: number | null; service: { id: string; name: string } };
type Billing4 = { monthlyRecurring: number; oneTime: number; activeServices: number; contractedValue: number; annualRunRate: number } | null;

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = { ACTIVE: "success", PAUSED: "warning", ENDED: "neutral" };

/**
 * Services the client has bought, and (for the founder) what they pay. The
 * billing summary is computed from these; invoices arrive with billing.
 */
export function ClientServicesPanel({ clientId, billing }: { clientId: string; billing: Billing4 }) {
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/clients/${clientId}/services`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setRows(body.services);
    setCanManage(body.canManage);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (row: Row, status: "ACTIVE" | "PAUSED" | "ENDED") => {
    const res = await safeFetch(`/api/clients/${clientId}/services/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) return toast.error("Couldn't change that");
    void load();
    // The billing figures on the overview are computed from these.
    router.refresh();
  };

  if (failed) return <ErrorState title="Services didn't load" onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      {billing && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Monthly recurring" value={money(billing.monthlyRecurring)} hint="Quarterly and yearly spread per month" />
          <StatCard label="Annual run rate" value={money(billing.annualRunRate)} hint="Recurring × 12" />
          <StatCard label="One-time work" value={money(billing.oneTime)} hint="Not yet ended" />
          <StatCard label="Contracted" value={money(billing.contractedValue)} hint="Signed and active contracts" />
        </div>
      )}
      <Card padded={false}>
        <CardHeader
          title="Services purchased"
          description={billing ? "Invoicing and payments arrive with billing; these figures are what has been agreed." : undefined}
          action={
            canManage ? (
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                Add service
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {!rows ? (
            <Skeleton className="h-24" />
          ) : rows.length === 0 ? (
            <EmptyState icon={ShoppingBag} title="Nothing purchased yet" description="Record what the client bought — it drives their projects and their billing." className="py-6" />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{r.service.name}</p>
                    <p className="text-[12px] text-ink/45">
                      Since {formatDate(r.startDate)}
                      {r.endDate ? ` · until ${formatDate(r.endDate)}` : ""}
                    </p>
                  </div>
                  {r.price !== null && (
                    <span className="tabular-nums text-[13px] text-ink">
                      {money(r.price)} <span className="text-ink/45">{BILLING_LABEL[r.billing as Billing]?.toLowerCase()}</span>
                    </span>
                  )}
                  <Badge dot tone={STATUS_TONE[r.status] ?? "neutral"} size="sm">
                    {r.status === "ACTIVE" ? "Active" : r.status === "PAUSED" ? "Paused" : "Ended"}
                  </Badge>
                  {canManage && (
                    <Select
                      aria-label={`Status of ${r.service.name}`}
                      value={r.status}
                      onChange={(e) => void setStatus(r, e.target.value as "ACTIVE" | "PAUSED" | "ENDED")}
                      options={[
                        { value: "ACTIVE", label: "Active" },
                        { value: "PAUSED", label: "Paused" },
                        { value: "ENDED", label: "Ended" },
                      ]}
                      className="w-28"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {adding && (
        <AddServiceModal
          clientId={clientId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AddServiceModal({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<{ id: string; name: string; price: number | null; billing: string | null }[]>([]);
  const [form, setForm] = useState({ serviceId: "", price: "", billing: "", startDate: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void safeFetch("/api/services").then(async (r) => r.ok && setCatalog((await r.json()).services));
  }, []);

  const pick = (id: string) => {
    const s = catalog.find((c) => c.id === id);
    setForm((f) => ({ ...f, serviceId: id, price: s?.price != null ? String(s.price) : f.price, billing: s?.billing ?? f.billing }));
  };

  const save = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/clients/${clientId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A blank price means "the catalog price" — the server fills it in.
      body: JSON.stringify({ serviceId: form.serviceId, ...(form.price.trim() ? { price: Number(form.price) } : {}), ...(form.billing ? { billing: form.billing } : {}), startDate: form.startDate }),
    });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't add that");
    toast.success("Service recorded");
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Add a purchased service" busy={busy} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Add</Button></>}>
      <div className="space-y-4">
        <Select label="Service" requiredMark value={form.serviceId} onChange={(e) => pick(e.target.value)} placeholder="Pick a service" options={catalog.map((c) => ({ value: c.id, label: c.name }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Price (USD)" type="number" min={0} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} hint="Defaults to the catalog price" />
          <Select label="Billing" value={form.billing} onChange={(e) => setForm((f) => ({ ...f, billing: e.target.value }))} options={BILLING_CADENCES.map((b) => ({ value: b, label: BILLING_LABEL[b] }))} />
        </div>
        <Input label="Start date" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
      </div>
    </Modal>
  );
}
