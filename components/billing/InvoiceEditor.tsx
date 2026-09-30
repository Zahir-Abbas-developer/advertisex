"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { CURRENCY_CODES, formatMoney, lineAmount, parseMoney, parseQuantity } from "@/modules/billing/money";
import { localDateKey } from "@/components/billing/shared";

type Line = { key: string; serviceId: string; description: string; quantity: string; rate: string };
type Defaults = {
  currency: string;
  paymentTermsDays: number;
  clients: { id: string; businessName: string }[];
  services: { id: string; name: string }[];
  projects: { id: string; title: string }[];
  lines: { serviceId: string | null; description: string; quantity: string; rate: string }[];
};
export type EditorInitial = {
  id: string;
  clientId: string;
  projectId: string | null;
  currency: string;
  dueDate: string;
  notes: string | null;
  lines: { serviceId: string | null; description: string; quantity: string; rate: string }[];
};

let seq = 0;
const blank = (l?: Partial<Line>): Line => ({ key: `l${++seq}`, serviceId: "", description: "", quantity: "1", rate: "", ...l });
const addDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateKey(d);
};

/**
 * A new invoice, or a draft being edited. Totals are computed as you type
 * with the same integer functions the server uses, so what you see is what
 * gets saved. Choosing a client offers its active services as lines.
 */
export function InvoiceEditor({ initial, presetClientId }: { initial?: EditorInitial; presetClientId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [failed, setFailed] = useState(false);
  const [clientId, setClientId] = useState(initial?.clientId ?? presetClientId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines.length ? initial.lines.map((l) => blank({ ...l, serviceId: l.serviceId ?? "" })) : [blank()]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "send" | null>(null);

  const loadDefaults = useCallback(
    async (forClient: string, fillLines: boolean) => {
      const res = await safeFetch(`/api/invoices/draft-defaults${forClient ? `?clientId=${encodeURIComponent(forClient)}` : ""}`, { cache: "no-store" });
      if (!res.ok) return setFailed(true);
      const body: Defaults = await res.json();
      setFailed(false);
      setDefaults(body);
      setCurrency((c) => c || body.currency);
      setDueDate((d) => d || addDays(body.paymentTermsDays));
      if (fillLines && body.lines.length) setLines(body.lines.map((l) => blank({ ...l, serviceId: l.serviceId ?? "" })));
    },
    [],
  );

  useEffect(() => {
    void loadDefaults(initial?.clientId ?? presetClientId ?? "", !initial && Boolean(presetClientId));
  }, [loadDefaults, initial, presetClientId]);

  const untouched = lines.every((l) => !l.description.trim() && !l.rate.trim());
  const chooseClient = (id: string) => {
    setClientId(id);
    setProjectId("");
    void loadDefaults(id, untouched);
  };

  const computed = useMemo(
    () =>
      lines.map((l) => {
        const q = parseQuantity(l.quantity);
        const r = parseMoney(l.rate, { allowNegative: true });
        return q.ok && r.ok ? lineAmount(q.value, r.value) : null;
      }),
    [lines],
  );
  const total = computed.reduce<number>((s, a) => s + (a ?? 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async (andSend: boolean) => {
    setBusy(andSend ? "send" : "save");
    const payload = {
      clientId,
      projectId: projectId || null,
      currency,
      dueDate,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({ serviceId: l.serviceId || null, description: l.description, quantity: l.quantity, rate: l.rate })),
    };
    const res = await safeFetch(initial ? `/api/invoices/${initial.id}` : "/api/invoices", {
      method: initial ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(null);
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "The invoice wasn't saved");
    }
    const id = initial?.id ?? body.invoice.id;
    if (andSend) {
      const sent = await safeFetch(`/api/invoices/${id}/send`, { method: "POST" });
      const out = await sent.json().catch(() => ({}));
      setBusy(null);
      if (!sent.ok) {
        toast.error(out.error ?? "Saved, but not sent");
        return router.push(`/invoices/${id}`);
      }
      toast.success(out.emailed ? `${out.numberLabel} sent and emailed` : `${out.numberLabel} sent — it's in the client's portal`);
    } else {
      setBusy(null);
      toast.success("Draft saved");
    }
    router.push(`/invoices/${id}`);
    router.refresh();
  };

  if (failed) return <ErrorState title="The invoice form didn't load" onRetry={() => void loadDefaults(clientId, false)} />;
  if (!defaults) return <Skeleton className="h-96 rounded-card" />;

  return (
    <div className="space-y-6">
      <div>
        <Link href={initial ? `/invoices/${initial.id}` : "/invoices"} className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> {initial ? "Back to the invoice" : "All invoices"}
        </Link>
        <h1 className="mt-3 font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{initial ? "Edit draft" : "New invoice"}</h1>
      </div>

      <Card padded={false}>
        <CardHeader title="Who and when" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Client"
            value={clientId}
            onChange={(e) => chooseClient(e.target.value)}
            placeholder="Choose a client"
            options={defaults.clients.map((c) => ({ value: c.id, label: c.businessName }))}
            error={errors.clientId}
            disabled={Boolean(initial)}
          />
          <Select
            label="Project (optional)"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            options={[{ value: "", label: "No project" }, ...defaults.projects.map((p) => ({ value: p.id, label: p.title }))]}
            error={errors.projectId}
          />
          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))} error={errors.currency} />
          <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title="Lines" description="Quantity × rate, rounded to the cent. A negative rate makes a discount line." />
        <CardBody className="space-y-4">
          {errors.lines && <p className="text-[13px] text-danger-ink">{errors.lines}</p>}
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-3 border-b border-line pb-4 last:border-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_90px_130px_120px_36px] sm:items-start">
              <Select
                label={i === 0 ? "Service" : undefined}
                aria-label="Service"
                value={l.serviceId}
                onChange={(e) => {
                  const s = defaults.services.find((x) => x.id === e.target.value);
                  setLine(i, { serviceId: e.target.value, description: l.description || s?.name || "" });
                }}
                options={[{ value: "", label: "Other" }, ...defaults.services.map((s) => ({ value: s.id, label: s.name }))]}
              />
              <Input label={i === 0 ? "Description" : undefined} aria-label="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} error={errors[`lines.${i}.description`]} />
              <Input label={i === 0 ? "Qty" : undefined} aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} error={errors[`lines.${i}.quantity`]} />
              <Input label={i === 0 ? "Rate" : undefined} aria-label="Rate" inputMode="decimal" placeholder="0.00" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} error={errors[`lines.${i}.rate`]} />
              <div className={i === 0 ? "sm:pt-7" : ""}>
                <p className="flex h-10 items-center justify-end font-medium tabular-nums text-ink">{computed[i] === null ? "—" : formatMoney(computed[i]!, currency || "USD")}</p>
              </div>
              <div className={i === 0 ? "sm:pt-7" : ""}>
                <button
                  type="button"
                  onClick={() => setLines((ls) => (ls.length === 1 ? [blank()] : ls.filter((_, j) => j !== i)))}
                  className="flex h-10 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-danger-ink"
                  aria-label={`Remove line ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((ls) => [...ls, blank()])}>
              Add line
            </Button>
            <p className="text-[15px] text-ink-2">
              Total <span className="ml-2 font-display text-[22px] font-bold tabular-nums text-ink">{formatMoney(total, currency || "USD")}</span>
            </p>
          </div>
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title="Notes" description="Printed on the invoice — payment instructions, a thank-you, a PO number." />
        <CardBody>
          <Textarea aria-label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </CardBody>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" loading={busy === "save"} disabled={busy !== null} onClick={() => void save(false)}>
          Save draft
        </Button>
        <Button icon={<Send className="h-4 w-4" />} loading={busy === "send"} disabled={busy !== null} onClick={() => void save(true)}>
          Save and send
        </Button>
      </div>
    </div>
  );
}
