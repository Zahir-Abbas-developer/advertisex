"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, type LeadFilters } from "@/modules/leads/domain";
import { cn } from "@/lib/utils";

type View = { id: string; name: string; filters: LeadFilters };

/**
 * Pipeline filters — the same shape the board, the table, the export and
 * saved views all use (modules/leads/domain.ts). Value filters appear only
 * for people who may see deal values; the server ignores them otherwise.
 */
export function LeadFilterBar({
  filters,
  onChange,
  stages,
  owners,
  canSeeValues,
}: {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
  stages: { key: string; label: string }[];
  owners: { id: string; name: string }[];
  canSeeValues: boolean;
}) {
  const toast = useToast();
  const [q, setQ] = useState(filters.q ?? "");
  const [views, setViews] = useState<View[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const loadViews = useCallback(async () => {
    const res = await fetch("/api/views", { cache: "no-store" });
    if (res.ok) setViews((await res.json()).views);
  }, []);
  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  // Search is debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((filters.q ?? "") !== q) onChange({ ...filters, q: q || undefined });
    }, 300);
    return () => clearTimeout(id);
  }, [q, filters, onChange]);

  const set = (patch: Partial<LeadFilters>) => onChange({ ...filters, ...patch });
  const active = Object.entries(filters).filter(([k, v]) => k !== "departmentId" && v !== undefined && !(Array.isArray(v) && v.length === 0)).length;

  async function saveView() {
    if (!naming?.trim()) return;
    const res = await fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: naming.trim(), filters: { ...filters, departmentId: undefined } }),
    });
    if (!res.ok) return toast.error("That view didn't save.");
    toast.success("View saved.");
    setNaming(null);
    void loadViews();
  }

  async function removeView(id: string) {
    await fetch(`/api/views/${id}`, { method: "DELETE" });
    void loadViews();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Input
            aria-label="Search leads"
            placeholder="Search business, contact, email, location"
            icon={<Search className="h-4 w-4" />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Select
            aria-label="Source"
            value={filters.sources?.[0] ?? ""}
            onChange={(e) => set({ sources: e.target.value ? [e.target.value as (typeof LEAD_SOURCES)[number]] : undefined })}
            options={[{ value: "", label: "Any source" }, ...LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] }))]}
          />
        </div>
        <div className="w-44">
          <Select
            aria-label="Owner"
            value={filters.ownerId ?? ""}
            onChange={(e) => set({ ownerId: e.target.value || undefined })}
            options={[{ value: "", label: "Anyone" }, { value: "none", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
          />
        </div>
        <Button variant="ghost" onClick={() => setMore((m) => !m)}>
          {more ? "Fewer filters" : "More filters"}
          {active > 0 && <span className="ml-1.5 rounded-pill bg-brand-tint px-1.5 text-[11px] tabular-nums text-brand">{active}</span>}
        </Button>
        {views.length > 0 && (
          <Dropdown
            trigger={
              <span className="inline-flex h-11 items-center gap-2 rounded-pill border border-line px-4 text-[13px] text-ink/80 hover:bg-surface-2">
                <Bookmark className="h-4 w-4" /> Views
              </span>
            }
            items={views.flatMap((v) => [
              { key: v.id, label: v.name, onSelect: () => onChange({ ...v.filters, departmentId: filters.departmentId }) },
            ]).concat(views.map((v) => ({ key: `del-${v.id}`, label: `Delete “${v.name}”`, icon: <Trash2 />, danger: true, onSelect: () => void removeView(v.id) })))}
          />
        )}
        {naming === null ? (
          <Button variant="ghost" onClick={() => setNaming("")} disabled={active === 0}>
            Save view
          </Button>
        ) : (
          <form
            className="flex items-end gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveView();
            }}
          >
            <Input aria-label="View name" placeholder="Name this view" value={naming} onChange={(e) => setNaming(e.target.value)} />
            <Button type="submit" size="sm">Save</Button>
            <button type="button" aria-label="Cancel" onClick={() => setNaming(null)} className="rounded-[8px] p-2 text-ink/40 hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </form>
        )}
        {active > 0 && (
          <Button variant="ghost" onClick={() => { setQ(""); onChange({ departmentId: filters.departmentId }); }}>
            Clear
          </Button>
        )}
      </div>

      {more && (
        <div className="space-y-3 rounded-card border border-line bg-surface p-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink/80">Stages</p>
            <div className="flex flex-wrap gap-1.5">
              {stages.map((s) => {
                const on = filters.stages?.includes(s.key) ?? false;
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? (filters.stages ?? []).filter((k) => k !== s.key) : [...(filters.stages ?? []), s.key];
                      set({ stages: next.length ? next : undefined });
                    }}
                    className={cn(
                      "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                      on ? "border-brand/50 bg-brand-tint text-brand" : "border-line text-ink/60 hover:border-line-strong",
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {canSeeValues && (
              <>
                <Input label="Min value" type="number" min={0} value={filters.minValue ?? ""} onChange={(e) => set({ minValue: e.target.value ? Number(e.target.value) : undefined })} />
                <Input label="Max value" type="number" min={0} value={filters.maxValue ?? ""} onChange={(e) => set({ maxValue: e.target.value ? Number(e.target.value) : undefined })} />
              </>
            )}
            <Input label="Created from" type="date" value={filters.createdFrom ?? ""} onChange={(e) => set({ createdFrom: e.target.value || undefined })} />
            <Input label="Created to" type="date" value={filters.createdTo ?? ""} onChange={(e) => set({ createdTo: e.target.value || undefined })} />
            <Input label="Tag" placeholder="e.g. brunch" value={filters.tag ?? ""} onChange={(e) => set({ tag: e.target.value.trim().toLowerCase() || undefined })} />
          </div>
        </div>
      )}
    </div>
  );
}
