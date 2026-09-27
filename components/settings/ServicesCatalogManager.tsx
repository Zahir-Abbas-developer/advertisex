"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Plus } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { BILLING_CADENCES, BILLING_LABEL, type Billing } from "@/modules/services/catalog";
import { safeFetch } from "@/lib/safe-fetch";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  billing: string | null;
  isActive: boolean;
  stageTemplates: { id: string; name: string; order: number }[];
  skills: { id: string; name: string }[];
};
type Skill = { id: string; name: string };

/**
 * The service catalog (Phase 4 scopes 1 and 3): what Advertise X sells, at
 * what price and cadence, the stages each service's projects follow, and the
 * skills it needs. Editing a template never changes projects already planned.
 */
export function ServicesCatalogManager() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Service | "new" | null>(null);

  const load = useCallback(async () => {
    const [s, k] = await Promise.all([safeFetch("/api/services?all=1", { cache: "no-store" }), safeFetch("/api/skills")]);
    if (!s.ok) return setFailed(true);
    setFailed(false);
    setServices((await s.json()).services);
    if (k.ok) setSkills(((await k.json()).skills ?? []).filter((x: Skill & { isActive?: boolean }) => x.isActive !== false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <ErrorState title="The catalog didn't load" onRetry={() => void load()} />;
  if (!services) return <Skeleton className="h-64 rounded-card" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-ink/55">
          Prices are defaults: what a client pays is set on their profile. Stage templates are copied into each new project, so editing one never rewrites work already under way.
        </p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
          Add service
        </Button>
      </div>
      {services.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Layers} title="No services yet" description="Add what you sell; projects are planned from it." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {services.map((s) => (
            <Card padded={false} key={s.id} className={cn(!s.isActive && "opacity-60")}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {s.name}
                    {!s.isActive && <Badge size="sm">Retired</Badge>}
                  </span>
                }
                description={s.price !== null ? `$${s.price.toLocaleString("en-US")} · ${BILLING_LABEL[(s.billing ?? "ONE_TIME") as Billing].toLowerCase()}` : undefined}
                action={
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                }
              />
              <CardBody className="space-y-3">
                <p className="text-[12px] text-ink/60">{s.stageTemplates.map((t) => t.name).join(" → ") || "No stages"}</p>
                <div className="flex flex-wrap gap-1">
                  {s.skills.map((k) => (
                    <Badge key={k.id} size="sm">
                      {k.name}
                    </Badge>
                  ))}
                  {s.skills.length === 0 && <span className="text-[12px] text-ink/40">No skills listed</span>}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <ServiceModal
          service={editing === "new" ? null : editing}
          skills={skills}
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

function ServiceModal({ service, skills, onClose, onSaved }: { service: Service | null; skills: Skill[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: service?.name ?? "",
    description: service?.description ?? "",
    price: service?.price != null ? String(service.price) : "0",
    billing: service?.billing ?? "ONE_TIME",
    stages: (service?.stageTemplates.map((t) => t.name) ?? ["Planning", "Delivery", "Review"]).join("\n"),
    skillIds: service?.skills.map((k) => k.id) ?? [],
    isActive: service?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);

  // Set once the service exists, so a retry after a partial failure updates
  // it instead of trying to create it a second time.
  const [savedId, setSavedId] = useState<string | null>(service?.id ?? null);

  const save = async () => {
    const stages = form.stages.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!stages.length) return toast.error("Keep at least one stage");
    setBusy(true);
    const json = (url: string, method: string, body: unknown) => safeFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const core = { name: form.name, price: Number(form.price || 0), billing: form.billing };
    const res = savedId
      ? await json(`/api/services/${savedId}`, "PATCH", { ...core, description: form.description, ...(service ? { isActive: form.isActive } : {}) })
      : await json("/api/services", "POST", { ...core, ...(form.description ? { description: form.description } : {}), stages });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return toast.error(body.error ?? "Couldn't save the service");
    }
    const id = savedId ?? body.service.id;
    setSavedId(id);
    const results = await Promise.all([json(`/api/services/${id}/stages`, "PUT", { stages }), json(`/api/services/${id}/skills`, "PUT", { skillIds: form.skillIds })]);
    setBusy(false);
    if (results.some((r) => !r.ok)) return toast.error("Saved, but the stages or skills didn't update — save again to retry");
    toast.success(service ? "Service updated" : "Service added");
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={service ? `Edit ${service.name}` : "Add a service"} size="lg" busy={busy} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-4">
        <Input label="Name" requiredMark value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Default price (USD)" type="number" min={0} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
          <Select label="Billing" value={form.billing} onChange={(e) => setForm((f) => ({ ...f, billing: e.target.value }))} options={BILLING_CADENCES.map((b) => ({ value: b, label: BILLING_LABEL[b] }))} />
        </div>
        <Textarea label="Stages" hint="One per line, in order. New projects start at the first." rows={5} value={form.stages} onChange={(e) => setForm((f) => ({ ...f, stages: e.target.value }))} />
        <fieldset>
          <legend className="mb-1.5 block text-[13px] font-medium text-ink/80">Skills it needs</legend>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {skills.map((k) => {
              const on = form.skillIds.includes(k.id);
              return (
                <button key={k.id} type="button" aria-pressed={on} onClick={() => setForm((f) => ({ ...f, skillIds: on ? f.skillIds.filter((x) => x !== k.id) : [...f.skillIds, k.id] }))} className={cn("rounded-pill border px-2.5 py-1 text-[12px]", on ? "border-brand bg-brand-tint text-ink" : "border-line text-ink/55 hover:border-ink/25")}>
                  {k.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        {service && (
          <label className="flex items-center gap-2 text-[13px] text-ink/70">
            <input type="checkbox" className="accent-brand" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Offered (unticking retires it from new projects)
          </label>
        )}
      </div>
    </Modal>
  );
}
