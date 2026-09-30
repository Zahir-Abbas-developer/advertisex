"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { startOfCompanyDay, toDateInput } from "@/lib/date";
import { FIRST_PROJECT_DAYS, PROJECT_PRIORITIES, PROJECT_PRIORITY_LABEL } from "@/modules/projects/domain";
import { safeFetch } from "@/lib/safe-fetch";

type Service = { id: string; name: string; stageTemplates: { name: string }[]; skills: { id: string; name: string }[] };
type Person = { id: string; name: string; jobTitle: string | null; isAgent: boolean; skills: { id: string; name: string }[] };

// Today on the company calendar — UTC runs a day ahead every New York evening.
const today = () => toDateInput(startOfCompanyDay(new Date()));
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const blankForm = (clientId?: string) => ({
  clientId: clientId ?? "",
  title: "",
  description: "",
  serviceIds: [] as string[],
  startDate: today(),
  deadline: plusDays(today(), FIRST_PROJECT_DAYS),
  priority: "MEDIUM",
  ownerId: "",
  memberIds: [] as string[],
});

/**
 * A new project: client, services (each bringing its stage template and
 * skills), dates, priority, owner and team. People who hold the skills the
 * chosen services need are listed first.
 */
export function NewProjectModal({ open, onClose, clientId }: { open: boolean; onClose: () => void; clientId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [clients, setClients] = useState<{ id: string; businessName: string }[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState(() => blankForm(clientId));

  useEffect(() => {
    if (!open) return;
    // Each opening starts clean.
    setForm(blankForm(clientId));
    setErrors({});
    void Promise.all([
      clientId ? Promise.resolve(null) : safeFetch("/api/clients?options=1").then((r) => (r.ok ? r.json() : { clients: [] })),
      safeFetch("/api/services").then((r) => (r.ok ? r.json() : { services: [] })),
      safeFetch("/api/projects/people").then((r) => (r.ok ? r.json() : { people: [] })),
    ]).then(([c, s, p]) => {
      if (c) setClients(c.clients);
      setServices(s.services);
      setPeople(p.people);
    });
  }, [open, clientId]);

  const needed = useMemo(() => {
    const ids = new Set<string>();
    for (const s of services) if (form.serviceIds.includes(s.id)) for (const k of s.skills) ids.add(k.id);
    return ids;
  }, [services, form.serviceIds]);

  const ranked = useMemo(
    () =>
      [...people]
        .map((p) => ({ ...p, match: p.skills.filter((s) => needed.has(s.id)).length }))
        .sort((a, b) => b.match - a.match || a.name.localeCompare(b.name)),
    [people, needed],
  );

  const toggle = (key: "serviceIds" | "memberIds", id: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const save = async () => {
    setBusy(true);
    const res = await safeFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, description: form.description || null, ownerId: form.ownerId || null }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "The project wasn't created");
    }
    toast.success("Project created — its plan is ready");
    onClose();
    router.push(`/projects/${body.project.id}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="Each service brings its own stages and the skills it needs."
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {!clientId && (
          <Select
            label="Client"
            requiredMark
            value={form.clientId}
            onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
            placeholder="Pick a client"
            options={clients.map((c) => ({ value: c.id, label: c.businessName }))}
            error={errors.clientId}
          />
        )}
        <Input label="Project name" requiredMark value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} error={errors.title} placeholder="e.g. Website relaunch" />

        <fieldset>
          <legend className="mb-1.5 block text-[13px] font-medium text-ink/80">Services</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((s) => {
              const on = form.serviceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle("serviceIds", s.id)}
                  aria-pressed={on}
                  className={cn("flex items-start gap-2.5 rounded-[10px] border p-3 text-left transition-colors", on ? "border-brand bg-brand-tint" : "border-line hover:border-ink/20")}
                >
                  <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-brand bg-brand text-on-brand" : "border-line")}>
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{s.name}</span>
                    <span className="block truncate text-[11px] text-ink-muted">{s.stageTemplates.map((t) => t.name).join(" → ")}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {errors.serviceIds && <p className="mt-1.5 text-[12px] text-danger-ink">{errors.serviceIds}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input type="date" label="Start" requiredMark value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} error={errors.startDate} />
          <Input type="date" label="Deadline" requiredMark value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} error={errors.deadline} />
          <Select label="Priority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} options={PROJECT_PRIORITIES.map((p) => ({ value: p, label: PROJECT_PRIORITY_LABEL[p] }))} />
        </div>

        <Select
          label="Owner"
          value={form.ownerId}
          onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))}
          placeholder="Who runs it"
          options={ranked.filter((p) => !p.isAgent).map((p) => ({ value: p.id, label: `${p.name}${p.jobTitle ? ` — ${p.jobTitle}` : ""}` }))}
          error={errors.ownerId}
        />

        <fieldset>
          <legend className="mb-1.5 block text-[13px] font-medium text-ink/80">
            Team {needed.size > 0 && <span className="font-normal text-ink-muted">— people with the skills these services need come first</span>}
          </legend>
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {ranked.map((p) => {
              const on = form.memberIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle("memberIds", p.id)}
                  className={cn("rounded-pill border px-3 py-1 text-[12px] transition-colors", on ? "border-brand bg-brand-tint text-ink" : "border-line text-ink-2 hover:border-ink/25")}
                >
                  {p.name}
                  {p.isAgent && <span className="ml-1 text-ink-2">AI</span>}
                  {p.match > 0 && <span className="ml-1 text-success-ink">· {p.match} skill{p.match > 1 ? "s" : ""}</span>}
                </button>
              );
            })}
          </div>
          {errors.memberIds && <p className="mt-1.5 text-[12px] text-danger-ink">{errors.memberIds}</p>}
        </fieldset>

        <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </div>
    </Modal>
  );
}
