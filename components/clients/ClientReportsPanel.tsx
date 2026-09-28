"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileBarChart, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { formatBytes } from "@/lib/utils";
import { formatDate } from "@/lib/date";
import { REPORT_KINDS, REPORT_KIND_LABEL } from "@/modules/portal/views";

type Report = {
  id: string;
  title: string;
  kind: string;
  periodMonth: string;
  periodLabel: string;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
  file: { filename: string; size: number };
  createdBy: { name: string } | null;
  readBy: string[];
};

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

/**
 * The client's reports library, the team side (Phase 6 scope 4): upload a
 * report, publish it to the portal (the client is told), and see who has
 * opened it. Automated reports arrive in Phase 8 through the same library.
 */
export function ClientReportsPanel({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Report[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "MONTHLY", periodMonth: lastMonth(), publish: true });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/clients/${clientId}/reports`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setRows(body.reports);
    setCanManage(body.canManage);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (!file) return setErrors({ file: "Choose the report file" });
    setBusy(true);
    const data = new FormData();
    data.set("file", file);
    data.set("title", form.title);
    data.set("kind", form.kind);
    data.set("periodMonth", form.periodMonth);
    data.set("publish", String(form.publish));
    const res = await safeFetch(`/api/clients/${clientId}/reports`, { method: "POST", body: data });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "The report wasn't added");
    }
    toast.success(form.publish ? "Report published — the client has been told" : "Saved as a draft");
    setFile(null);
    setErrors({});
    setForm({ ...form, title: "" });
    void load();
  };

  const patch = async (r: Report, status: Report["status"]) => {
    const res = await safeFetch(`/api/clients/${clientId}/reports/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) return toast.error("Couldn't change that");
    toast.success(status === "PUBLISHED" ? "Published — the client has been told" : "Withdrawn from the portal");
    void load();
  };

  const remove = async (r: Report) => {
    if (!window.confirm(`Delete "${r.title}"? It disappears from the client's portal too.`)) return;
    const res = await safeFetch(`/api/clients/${clientId}/reports/${r.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't delete it");
    void load();
  };

  if (failed) return <ErrorState title="Reports didn't load" onRetry={() => void load()} />;
  if (!rows) return <Skeleton className="h-48 rounded-card" />;

  return (
    <div className="space-y-6">
      {canManage && (
        <Card padded={false}>
          <CardHeader title="Add a report" description="PDF is best. Automated monthly reports arrive later; this is the manual path." />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} options={REPORT_KINDS.map((k) => ({ value: k, label: REPORT_KIND_LABEL[k] }))} />
              <Input label="Month it covers" type="month" value={form.periodMonth} onChange={(e) => setForm({ ...form, periodMonth: e.target.value })} error={errors.periodMonth} />
              <Input label="Title (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Monthly report — September" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input ref={input} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => input.current?.click()}>
                {file ? file.name : "Choose file"}
              </Button>
              {errors.file && <span className="text-[12px] text-danger">{errors.file}</span>}
              <label className="flex items-center gap-2 text-[13px] text-ink/65">
                <input type="checkbox" className="accent-brand" checked={form.publish} onChange={(e) => setForm({ ...form, publish: e.target.checked })} />
                Publish to the client now
              </label>
              <Button size="sm" loading={busy} onClick={() => void upload()}>
                Add report
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={FileBarChart} title="No reports yet" description="Published reports appear in the client's portal, by month." />
        </Card>
      ) : (
        <Card padded={false}>
          <CardBody className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-ink">{r.title}</p>
                    <p className="text-[12px] text-ink/45">
                      {r.periodLabel} · {REPORT_KIND_LABEL[r.kind as keyof typeof REPORT_KIND_LABEL] ?? "Report"} · {formatBytes(r.file.size)}
                      {r.publishedAt ? ` · published ${formatDate(r.publishedAt)}` : ""}
                      {r.status === "PUBLISHED" ? (r.readBy.length ? ` · opened by ${r.readBy.join(", ")}` : " · not opened yet") : ""}
                    </p>
                  </div>
                  <Badge size="sm" tone={r.status === "PUBLISHED" ? "success" : "neutral"}>
                    {r.status === "PUBLISHED" ? "In the portal" : "Draft"}
                  </Badge>
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => void patch(r, r.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED")}>
                        {r.status === "PUBLISHED" ? "Withdraw" : "Publish"}
                      </Button>
                      <button type="button" onClick={() => void remove(r)} className="rounded p-1.5 text-ink/45 hover:text-danger" aria-label={`Delete ${r.title}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
