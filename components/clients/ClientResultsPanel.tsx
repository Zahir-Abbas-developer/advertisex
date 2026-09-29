"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, PencilLine, PlugZap, RefreshCw } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { AXIS, CHART, CURSOR, TOOLTIP, chartAnimation } from "@/components/charts/theme";
import { relativeFromNow } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";
import { cn } from "@/lib/utils";
import { previousMonth, type Channel, type MetricView, type Unit } from "@/modules/client-analytics/metrics";

type ChannelView = {
  channel: Channel;
  label: string;
  question: string;
  hasData: boolean;
  fromServices: boolean;
  headline: string;
  metrics: MetricView[];
  trend: { month: string; value: number | null }[];
  editable: { key: string; label: string; unit: Unit; text: string }[];
};
type Results = {
  month: string;
  currency: string;
  demoData: boolean;
  channels: ChannelView[];
  connections: { provider: string; label: string; status: string; lastSyncedAt: string | null; lastError: string | null; live: boolean; channels: string[] }[];
  mockSync: boolean;
};

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const UNIT_HINT: Record<Unit, string> = { count: "e.g. 1250", money: "e.g. 1450.00", decimal: "e.g. 7.3", seconds: "e.g. 1:36" };

/** A client's results by channel (Phase 8 scope 3): the numbers behind monthly reports. */
export function ClientResultsPanel({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<{ results: Results; canEdit: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<ChannelView | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/clients/${clientId}/results${month ? `?month=${month}` : ""}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    const body = await res.json();
    setData(body);
    if (!month) setMonth(body.results.month);
  }, [clientId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const months = useMemo(() => {
    if (!data) return [];
    const out = [data.results.month];
    // Up to twelve months back from the latest the API allows.
    let m = data.results.month;
    for (let i = 0; i < 11; i++) {
      m = previousMonth(m);
      out.push(m);
    }
    return out;
  }, [data]);

  const sync = async (provider: string) => {
    setSyncing(provider);
    const res = await safeFetch(`/api/clients/${clientId}/results/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, months: 6 }) });
    setSyncing(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error ?? "The sync didn't work");
    toast.success(body.mode === "mock" ? "Demo data loaded" : "Synced");
    void load();
  };

  if (failed) return <ErrorState title="Results didn't load" onRetry={() => void load()} />;
  if (!data) return <Skeleton className="h-72 rounded-card" />;
  const r = data.results;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-base font-bold text-ink-heading">Results — {monthLabel(r.month)}</p>
          <p className="text-[13px] text-ink-muted">Against {monthLabel(previousMonth(r.month))}. Monthly reports are built from these numbers.</p>
        </div>
        <div className="w-52">
          <Select aria-label="Month" value={r.month} onChange={(e) => setMonth(e.target.value)} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
        </div>
      </div>

      {r.demoData && (
        <p className="flex items-center gap-2 rounded-card border border-info/30 bg-info-tint px-4 py-3 text-[13px] text-ink">
          <Info className="h-4 w-4 shrink-0 text-info" /> Some of these figures are demo data, not the client&apos;s real accounts. Connect the account or enter results by hand to replace them.
        </p>
      )}

      {r.channels.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={PlugZap} title="No results to track yet" description="Results appear for the services this client has (ads, website, SEO, local SEO)." />
        </Card>
      ) : (
        r.channels.map((c) => (
          <Card key={c.channel} padded={false}>
            <CardHeader
              title={c.label}
              description={c.question}
              action={
                data.canEdit ? (
                  <Button variant="secondary" size="sm" icon={<PencilLine className="h-4 w-4" />} onClick={() => setEditing(c)}>
                    Enter results
                  </Button>
                ) : undefined
              }
            />
            <CardBody>
              {!c.hasData ? (
                <p className="text-[13px] text-ink-muted">Nothing recorded for {monthLabel(r.month)} yet.</p>
              ) : (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {c.metrics.map((m) => (
                      <div key={m.key} className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-3">
                        <p className="text-[11px] text-ink-muted">{m.label}</p>
                        <p className="mt-1 font-display text-[18px] font-bold tabular-nums text-ink">{m.display}</p>
                        {m.good !== null && (
                          <p className={cn("text-[11px] font-medium", m.good ? "text-success-ink" : "text-data-negative")}>{(m.change ?? 0) > 0 ? "Up" : "Down"} on last month</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-[12px] text-ink-muted">{c.headline}, six months</p>
                    <div role="img" aria-label={`Chart: ${c.headline} over the last six months, ${c.trend.map((t) => `${t.month}: ${t.value ?? "none"}`).join(", ")}`} className="mt-2 h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={c.trend} margin={{ left: 0, right: 0, top: 8 }}>
                          <XAxis dataKey="month" tickFormatter={(m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} {...AXIS} />
                          <Tooltip cursor={CURSOR} contentStyle={TOOLTIP} labelFormatter={(l) => monthLabel(String(l))} formatter={(v) => (v === null ? "—" : Number(v).toLocaleString())} />
                          <Bar isAnimationActive={chartAnimation()} dataKey="value" name={c.headline} fill={CHART.data1} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        ))
      )}

      <Card padded={false}>
        <CardHeader title="Connected accounts" description="Live sync from each platform is being switched on provider by provider. Until then, results are entered by hand." />
        <CardBody className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {r.connections.map((c) => (
              <li key={c.provider} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-ink">{c.label}</span>
                  <span className="block text-[12px] text-ink-muted">
                    {c.lastSyncedAt ? `Last synced ${relativeFromNow(c.lastSyncedAt)}` : c.live ? "Ready to connect" : "Live sync not switched on yet"}
                    {c.lastError ? ` · ${c.lastError}` : ""}
                  </span>
                </span>
                <Badge size="sm" tone={c.status === "CONNECTED" ? "success" : c.status === "MOCK" ? "info" : c.status === "ERROR" ? "danger" : "neutral"}>
                  {c.status === "CONNECTED" ? "Connected" : c.status === "MOCK" ? "Demo data" : c.status === "ERROR" ? "Error" : "Not connected"}
                </Badge>
                {data.canEdit && (c.live || r.mockSync) && (
                  <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={syncing === c.provider} onClick={() => void sync(c.provider)}>
                    {c.live ? "Sync" : "Load demo data"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {editing && <EntryModal clientId={clientId} month={r.month} channel={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />}
    </div>
  );
}

function EntryModal({ clientId, month, channel, onClose, onSaved }: { clientId: string; month: string; channel: ChannelView; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(channel.editable.map((e) => [e.key, e.text])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/clients/${clientId}/results`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, channel: channel.channel, values }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "Not saved");
    }
    toast.success("Results saved");
    onSaved();
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`${channel.label} — ${monthLabel(month)}`}
      description="Manual entries take precedence over synced and demo figures. Leave a field blank to clear your entry."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save results
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {channel.editable.map((e) => (
          <Input key={e.key} label={e.label} inputMode="decimal" placeholder={UNIT_HINT[e.unit]} value={values[e.key] ?? ""} onChange={(ev) => setValues({ ...values, [e.key]: ev.target.value })} error={errors[e.key]} />
        ))}
      </div>
    </Modal>
  );
}
