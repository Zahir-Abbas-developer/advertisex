"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { numberLabel } from "@/modules/billing/domain";

type Billing = { name: string; invoicePrefix: string; nextInvoiceNumber: number; currency: string; paymentTermsDays: number; billingAddress: string | null; billingEmail: string | null };

/** What every invoice prints and defaults to (Phase 7). The next number is shown, never edited: it is the sequence. */
export function BillingSettingsForm() {
  const toast = useToast();
  const [form, setForm] = useState<Billing | null>(null);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch("/api/settings/billing", { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setForm(body.billing);
    setCurrencies(body.currencies);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <ErrorState title="Billing settings didn't load" onRetry={() => void load()} />;
  if (!form) return <Skeleton className="h-64 rounded-card" />;

  const save = async () => {
    setBusy(true);
    const res = await safeFetch("/api/settings/billing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoicePrefix: form.invoicePrefix, currency: form.currency, paymentTermsDays: Number(form.paymentTermsDays), billingAddress: form.billingAddress || null, billingEmail: form.billingEmail || "" }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "Couldn't save");
    }
    setErrors({});
    toast.success("Billing settings saved");
  };

  return (
    <Card padded={false}>
      <CardHeader title="Invoices" description={`Printed on every invoice from ${form.name}. The next invoice will be ${numberLabel(form.invoicePrefix, form.nextInvoiceNumber)}.`} />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Number prefix" value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })} error={errors.invoicePrefix} hint="INV gives INV-0001" />
          <Select label="Default currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} options={currencies.map((c) => ({ value: c, label: c }))} hint="The overview reports in this currency" />
          <Input label="Payment terms (days)" type="number" min={0} max={120} value={String(form.paymentTermsDays)} onChange={(e) => setForm({ ...form, paymentTermsDays: Number(e.target.value) })} error={errors.paymentTermsDays} hint="Due date = issue date + terms" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Textarea label="Your address" rows={3} value={form.billingAddress ?? ""} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} error={errors.billingAddress} />
          <Input label="Billing email" type="email" value={form.billingEmail ?? ""} onChange={(e) => setForm({ ...form, billingEmail: e.target.value })} error={errors.billingEmail} hint="Printed in the invoice footer" />
        </div>
        <div className="flex justify-end">
          <Button loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
