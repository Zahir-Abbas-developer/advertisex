"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSignature, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { FilesPanel } from "@/components/files/FilesPanel";
import { formatDate } from "@/lib/date";
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, type ContractStatus } from "@/modules/clients/contracts";

type Contract = {
  id: string;
  title: string;
  status: ContractStatus;
  startDate: string | null;
  endDate: string | null;
  signedAt: string | null;
  value: number | null;
  notes: string | null;
};

/** Contracts: status, dates, value (founder), and their signed files. */
export function ContractsPanel({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Contract[] | null>(null);
  const [perms, setPerms] = useState({ canManage: false, seesValue: false });
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Contract | "new" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/contracts`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setRows(body.contracts);
    setPerms({ canManage: body.canManage, seesValue: body.seesValue });
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (c: Contract) => {
    if (!window.confirm(`Delete "${c.title}" and its files?`)) return;
    const res = await fetch(`/api/clients/${clientId}/contracts/${c.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't delete it");
    toast.success("Contract deleted");
    void load();
  };

  if (failed) return <ErrorState title="Contracts didn't load" onRetry={() => void load()} />;
  if (!rows) return <Skeleton className="h-40 rounded-card" />;

  return (
    <div className="space-y-4">
      {perms.canManage && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
            Add contract
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={FileSignature} title="No contracts yet" description="Record the agreement, its dates and its status, and attach the signed copy." />
        </Card>
      ) : (
        rows.map((c) => (
          <Card key={c.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {c.title}
                  <Badge dot tone={CONTRACT_STATUS_TONE[c.status]} size="sm">
                    {CONTRACT_STATUS_LABEL[c.status]}
                  </Badge>
                </span>
              }
              description={[
                c.startDate ? `From ${formatDate(c.startDate)}` : null,
                c.endDate ? `to ${formatDate(c.endDate)}` : null,
                c.signedAt ? `signed ${formatDate(c.signedAt)}` : null,
                perms.seesValue && c.value ? `$${c.value.toLocaleString("en-US")}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "No dates yet"}
              action={
                perms.canManage ? (
                  <span className="flex gap-1">
                    <button type="button" onClick={() => setEditing(c)} className="rounded p-1.5 text-ink/50 hover:bg-surface-2 hover:text-ink" aria-label={`Edit ${c.title}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => void remove(c)} className="rounded p-1.5 text-ink/50 hover:bg-surface-2 hover:text-danger" aria-label={`Delete ${c.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                ) : undefined
              }
            />
            <CardBody className="space-y-4">
              {c.notes && <p className="text-[13px] text-ink/65">{c.notes}</p>}
              <FilesPanel owner={{ contractId: c.id }} canUpload={perms.canManage} canChangeVisibility={perms.canManage} compact />
            </CardBody>
          </Card>
        ))
      )}
      {editing && (
        <ContractModal
          clientId={clientId}
          contract={editing === "new" ? null : editing}
          seesValue={perms.seesValue}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ContractModal({ clientId, contract, seesValue, onClose, onSaved }: { clientId: string; contract: Contract | null; seesValue: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: contract?.title ?? "",
    status: contract?.status ?? "DRAFT",
    startDate: contract?.startDate ?? "",
    endDate: contract?.endDate ?? "",
    signedAt: contract?.signedAt ?? "",
    value: contract?.value != null ? String(contract.value) : "",
    notes: contract?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    const payload = {
      title: form.title,
      status: form.status,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      signedAt: form.signedAt || null,
      notes: form.notes || null,
      ...(seesValue ? { value: Number(form.value || 0) } : {}),
    };
    const res = await fetch(contract ? `/api/clients/${clientId}/contracts/${contract.id}` : `/api/clients/${clientId}/contracts`, {
      method: contract ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "Couldn't save the contract");
    }
    toast.success(contract ? "Contract updated" : "Contract added — attach the signed copy below it");
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={contract ? "Edit contract" : "Add a contract"} busy={busy} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-4">
        <Input label="Title" requiredMark value={form.title} onChange={set("title")} error={errors.title} placeholder="e.g. 90-Day Growth Sprint agreement" />
        <Select label="Status" value={form.status} onChange={set("status")} options={CONTRACT_STATUSES.map((s) => ({ value: s, label: CONTRACT_STATUS_LABEL[s] }))} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Starts" type="date" value={form.startDate} onChange={set("startDate")} error={errors.startDate} />
          <Input label="Ends" type="date" value={form.endDate} onChange={set("endDate")} error={errors.endDate} />
          <Input label="Signed" type="date" value={form.signedAt} onChange={set("signedAt")} error={errors.signedAt} />
        </div>
        {seesValue && <Input label="Value (USD)" type="number" min={0} value={form.value} onChange={set("value")} />}
        <Textarea label="Notes" rows={2} value={form.notes} onChange={set("notes")} />
      </div>
    </Modal>
  );
}
