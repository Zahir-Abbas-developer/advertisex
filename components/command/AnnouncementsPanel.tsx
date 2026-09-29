"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { relativeFromNow } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";

type Announcement = { id: string; title: string; body: string; audience: string; recipients: number; createdAt: string };
const AUDIENCE_LABEL: Record<string, string> = { EVERYONE: "Everyone", TEAM: "The team", CLIENTS: "All clients" };

/** Founder announcements (Phase 8 scope 5): write once, everyone in the audience is notified. */
export function AnnouncementsPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [form, setForm] = useState({ title: "", body: "", audience: "TEAM" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch("/api/announcements", { cache: "no-store" });
    if (res.ok) setRows((await res.json()).announcements);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!window.confirm(`Send this to ${AUDIENCE_LABEL[form.audience].toLowerCase()}?`)) return;
    setBusy(true);
    const res = await safeFetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "It wasn't sent");
    }
    setErrors({});
    setForm({ title: "", body: "", audience: form.audience });
    toast.success(`Sent to ${body.announcement.recipients} ${body.announcement.recipients === 1 ? "person" : "people"}`);
    void load();
  };

  return (
    <Card padded={false}>
      <CardHeader title="Announce something" description="Everyone in the audience is notified — in the app, and by email if they chose it." />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Input aria-label="Headline" placeholder="Headline" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} />
          <Select aria-label="Audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} options={Object.entries(AUDIENCE_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
        <Textarea aria-label="Message" rows={3} placeholder="What do you want everyone to know?" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} error={errors.body} />
        <div className="flex justify-end">
          <Button size="sm" icon={<Megaphone className="h-4 w-4" />} loading={busy} disabled={form.title.trim().length < 3 || form.body.trim().length < 3} onClick={() => void send()}>
            Send announcement
          </Button>
        </div>
        {rows.length > 0 && (
          <ul className="space-y-2.5 border-t border-line pt-3">
            {rows.slice(0, 4).map((a) => (
              <li key={a.id} className="text-[13px]">
                <span className="block truncate font-medium text-ink">{a.title}</span>
                <span className="text-[12px] text-ink-muted">
                  {AUDIENCE_LABEL[a.audience] ?? a.audience} · {a.recipients} notified · {relativeFromNow(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
