"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

export type ProfileForm = {
  jobTitle: string;
  responsibilities: string;
  weeklyCapacityHours: number;
  employmentStatus: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
  skills: { skillId: string; proficiency: number }[];
  /** Null for AI agents: they have no schedule. */
  schedule: {
    timezone: string;
    workDays: number[];
    startMinute: number;
    endMinute: number;
    graceMinutes: number;
  } | null;
};

type CatalogSkill = { id: string; name: string; category: string; isActive: boolean };

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** The founder's editor for one profile: role details, skills, schedule. */
export function EditProfileModal({
  id,
  initial,
  onClose,
  onSaved,
}: {
  id: string;
  initial: ProfileForm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetch("/api/skills").then(async (r) => r.ok && setCatalog((await r.json()).skills));
  }, []);

  const nameOf = (skillId: string) => catalog.find((s) => s.id === skillId)?.name ?? "…";
  const available = catalog.filter((s) => s.isActive && !form.skills.some((h) => h.skillId === s.id));

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch(`/api/employees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobTitle: form.jobTitle,
          responsibilities: form.responsibilities,
          weeklyCapacityHours: form.weeklyCapacityHours,
          employmentStatus: form.employmentStatus,
          skills: form.skills,
          ...(form.schedule ? { schedule: form.schedule } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.fields) setErrors(body.fields);
        return toast.error(body.error ?? "Couldn't save that profile.");
      }
      toast.success("Profile saved.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const s = form.schedule;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit profile"
      eyebrow="Team"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save profile</Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Title" value={form.jobTitle} error={errors.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          <Select
            label="Status"
            value={form.employmentStatus}
            onChange={(e) => setForm({ ...form, employmentStatus: e.target.value as ProfileForm["employmentStatus"] })}
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "ON_LEAVE", label: "On leave" },
              { value: "INACTIVE", label: "Inactive" },
            ]}
          />
          <Input
            label="Weekly capacity (hours)"
            type="number"
            min={0}
            max={80}
            value={form.weeklyCapacityHours}
            error={errors.weeklyCapacityHours}
            onChange={(e) => setForm({ ...form, weeklyCapacityHours: Number(e.target.value) })}
          />
          <div className="sm:col-span-2">
            <Textarea label="Responsibilities" rows={3} value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">Skills</p>
          {errors.skills && <p className="mb-2 text-[13px] text-danger">{errors.skills}</p>}
          <div className="space-y-2">
            {form.skills.map((held) => (
              <div key={held.skillId} className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2">
                <span className="text-[13px] text-ink">{nameOf(held.skillId)}</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`Proficiency ${n}`}
                      aria-pressed={held.proficiency === n}
                      onClick={() =>
                        setForm({ ...form, skills: form.skills.map((x) => (x.skillId === held.skillId ? { ...x, proficiency: n } : x)) })
                      }
                      className={cn(
                        "h-7 w-7 rounded-[8px] border text-[12px] tabular-nums transition-colors",
                        n <= held.proficiency ? "border-brand/50 bg-brand-tint text-brand" : "border-line text-ink-muted hover:border-line-strong",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label={`Remove ${nameOf(held.skillId)}`}
                    onClick={() => setForm({ ...form, skills: form.skills.filter((x) => x.skillId !== held.skillId) })}
                    className="ml-1 rounded-[8px] p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {available.length > 0 && (
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Select
                  label="Add a skill"
                  value={adding}
                  placeholder="Choose from the catalog"
                  onChange={(e) => setAdding(e.target.value)}
                  options={available.map((sk) => ({ value: sk.id, label: `${sk.name} · ${sk.category}` }))}
                />
              </div>
              <Button
                variant="secondary"
                icon={<Plus className="h-4 w-4" />}
                disabled={!adding}
                onClick={() => {
                  setForm({ ...form, skills: [...form.skills, { skillId: adding, proficiency: 3 }] });
                  setAdding("");
                }}
              >
                Add
              </Button>
            </div>
          )}
        </div>

        {s && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink/80">Working schedule</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {DAYS.map(([n, label]) => {
                const on = s.workDays.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setForm({ ...form, schedule: { ...s, workDays: on ? s.workDays.filter((d) => d !== n) : [...s.workDays, n].sort() } })
                    }
                    className={cn(
                      "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                      on ? "border-brand/50 bg-brand-tint text-brand" : "border-line text-ink-muted hover:border-line-strong",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <Input label="Starts" type="time" value={toTime(s.startMinute)} onChange={(e) => setForm({ ...form, schedule: { ...s, startMinute: fromTime(e.target.value) } })} />
              <Input label="Ends" type="time" value={toTime(s.endMinute)} error={errors["schedule.endMinute"]} onChange={(e) => setForm({ ...form, schedule: { ...s, endMinute: fromTime(e.target.value) } })} />
              <Input label="Grace (min)" type="number" min={0} max={120} value={s.graceMinutes} onChange={(e) => setForm({ ...form, schedule: { ...s, graceMinutes: Number(e.target.value) } })} />
              <Input label="Timezone" value={s.timezone} error={errors["schedule.timezone"]} hint="e.g. America/New_York" onChange={(e) => setForm({ ...form, schedule: { ...s, timezone: e.target.value } })} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
