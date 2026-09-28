"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/modules/billing/domain";
import { formatMoney, toDecimalString } from "@/modules/billing/money";
import { localDateKey, newIdempotencyKey } from "@/components/billing/shared";

/**
 * Record a payment. The idempotency key is made when the dialog opens and
 * reused for every retry from it, so a double click or a flaky network
 * records the payment once.
 */
export function RecordPaymentModal({
  open,
  onClose,
  invoiceId,
  balanceMinor,
  currency,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  balanceMinor: number;
  currency: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [key] = useState(newIdempotencyKey);
  const [form, setForm] = useState({ amount: toDecimalString(balanceMinor), method: "BANK_TRANSFER", paidAt: localDateKey(), reference: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/invoices/${invoiceId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ ...form, reference: form.reference.trim() || null }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "The payment wasn't recorded");
    }
    toast.success(body.replayed ? "Already recorded" : "Payment recorded");
    onDone();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Record a payment"
      description={`Balance due: ${formatMoney(balanceMinor, currency)}. Part-payments are fine.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={`Amount (${currency})`} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={errors.amount} />
        <Input label="Date received" type="date" value={form.paidAt} max={localDateKey()} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} error={errors.paidAt} />
        <Select label="Method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
        <Input label="Reference (optional)" placeholder="Wire or check number" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} error={errors.reference} />
      </div>
    </Modal>
  );
}

/** A reason-required confirmation: voiding an invoice or reversing a payment. */
export function ReasonModal({
  open,
  onClose,
  title,
  description,
  confirm,
  url,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirm: string;
  url: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await safeFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.fields?.reason);
      return toast.error(body.error ?? "That didn't work");
    }
    toast.success("Done");
    onDone();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void submit()}>
            {confirm}
          </Button>
        </>
      }
    >
      <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={error} placeholder="Kept in the history" />
    </Modal>
  );
}
