"use client";

import { useState } from "react";
import {
  DollarSign,
  MoreHorizontal,
  Pencil,
  Info,
  Trash2,
  Users,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Drawer } from "@/components/ui/Drawer";
import { Dropdown } from "@/components/ui/Dropdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";

// Sample names and figures are fictional and must never coincide with seeded
// or real data: this page renders for any signed-in developer, and the leak
// scanner rightly treats a real client's budget on it as a leak.
/** The founder's palette, exactly (CLAUDE.md §7, forest-mint-theme.css). */
const PALETTE = [
  { name: "green-950", hex: "#022313", cls: "bg-green-950", note: "ink · darkest segment" },
  { name: "green-800", hex: "#0E5B37", cls: "bg-green-800", note: "brand" },
  { name: "green-600", hex: "#279D61", cls: "bg-green-600", note: "series 1 · positive" },
  { name: "green-400", hex: "#51B883", cls: "bg-green-400", note: "series 2" },
  { name: "green-200", hex: "#9BD4B4", cls: "bg-green-200", note: "series 3" },
  { name: "green-100", hex: "#CEE4D9", cls: "bg-green-100", note: "track · light fill" },
  { name: "green-50", hex: "#E7F4EB", cls: "bg-green-50", note: "page bg" },
  { name: "white", hex: "#FFFFFF", cls: "bg-surface", note: "card" },
  { name: "gray-50", hex: "#F8F8FB", cls: "bg-gray-50", note: "surface-2" },
  { name: "gray-100", hex: "#F1F1F4", cls: "bg-gray-100", note: "table header" },
  { name: "gray-600", hex: "#656565", cls: "bg-gray-600", note: "negative · muted text" },
  { name: "gray-300", hex: "#CBCBCD", cls: "bg-gray-300", note: "neutral" },
  { name: "chart-fill", hex: "#D5E0DC", cls: "bg-data-area", note: "area fill" },
  { name: "teal-500", hex: "#50A6BC", cls: "bg-teal-500", note: "teal accent" },
] as const;

const ROLE_TOKENS = [
  { name: "canvas", cls: "bg-canvas", note: "page" },
  { name: "surface", cls: "bg-surface", note: "cards" },
  { name: "surface-2", cls: "bg-surface-2", note: "elevated · hover" },
  { name: "surface-head", cls: "bg-surface-head", note: "table header" },
  { name: "brand", cls: "bg-brand", note: "CTA · active · hero KPI" },
  { name: "brand-strong", cls: "bg-brand-strong", note: "pressed · deep panels" },
  { name: "ink", cls: "bg-ink", note: "text · 16.8:1" },
  { name: "ink-heading", cls: "bg-ink-heading", note: "card titles · 8.2:1" },
  { name: "ink-2", cls: "bg-ink-2", note: "secondary text" },
  { name: "ink-muted", cls: "bg-ink-muted", note: "muted text · 5.8:1" },
  { name: "danger", cls: "bg-danger", note: "destructive · errors only" },
  { name: "warn", cls: "bg-warn", note: "warning fills · icons" },
] as const;

/** A stacked bar runs dark → light down the scale, with teal as one contrasting final segment. */
const STACKED = [
  { cls: "bg-data-5", share: 30, label: "30%" },
  { cls: "bg-data-4", share: 18, label: "18%" },
  { cls: "bg-data-1", share: 11, label: "11%" },
  { cls: "bg-data-2", share: 6, label: "6%" },
  { cls: "bg-data-3", share: 17, label: "17%" },
  { cls: "bg-data-track", share: 11, label: "11%" },
  { cls: "bg-data-alt", share: 7, label: "7%" },
] as const;

const DELTAS = [0.1, 0.2, 0.4, 0.3, 0.2, 0.2, -0.1, -0.3, -0.2, -0.3] as const;

const TYPE_SCALE = [12, 14, 16, 20, 24, 32, 40] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ShowcaseBody() {
  const toast = useToast();
  const [tab, setTab] = useState<"overview" | "activity" | "settings">("overview");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [page, setPage] = useState(2);
  const [checked, setChecked] = useState(true);

  return (
    <main className="mx-auto max-w-[1200px] space-y-12 px-4 py-10 sm:px-8">
      <header>
        <p className="eyebrow text-brand">Forest &amp; Mint</p>
        <h1 className="mt-2 font-display text-[34px] font-bold leading-none tracking-[-0.03em] text-ink">
          Design system
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
          Every token and primitive, rendered live. The written law is{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">docs/DESIGN_SYSTEM.md</code>;
          if this page and that file disagree, one of them has a bug. Development only.
        </p>
      </header>

      <Section title="The palette">
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            {PALETTE.map((c) => (
              <div key={c.name} className="border-b border-r border-line">
                <div className={`h-16 ${c.cls}`} />
                <div className="px-3 py-2">
                  <p className="text-[12px] font-medium tabular-nums text-ink">{c.hex}</p>
                  <p className="text-[11px] text-ink-muted">
                    {c.name} · {c.note}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[13px] text-ink-muted">
          Exact values from the reference dashboard. Green-600 and lighter, and teal, are data and fills — never text.
        </p>
      </Section>

      <Section title="Role tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ROLE_TOKENS.map((token) => (
            <div key={token.name} className="rounded-card border border-line bg-surface p-3">
              <div className={`h-10 rounded-[8px] border border-line ${token.cls}`} />
              <p className="mt-2 text-[13px] font-medium text-ink">{token.name}</p>
              <p className="text-[12px] text-ink-muted">{token.note}</p>
            </div>
          ))}
        </div>
        <Card>
          <p className="font-display text-base font-bold text-ink-heading">Card title — ink-heading</p>
          <p className="mt-1 text-sm text-ink">Body — ink on white, 16.8:1.</p>
          <p className="mt-1 text-sm text-ink-2">Secondary — ink-2.</p>
          <p className="mt-1 text-sm text-ink-muted">Muted — ink-muted (gray-600), 5.8:1.</p>
        </Card>
      </Section>

      <Section title="Data">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <p className="font-display text-base font-bold text-ink-heading">Stacked share</p>
            <div className="mt-4 space-y-2.5">
              {["2024", "2023", "2022"].map((year) => (
                <div key={year} className="flex items-center gap-3">
                  <span className="w-10 text-[11px] tabular-nums text-ink-muted">{year}</span>
                  <div className="flex h-5 flex-1 overflow-hidden rounded-[4px]">
                    {STACKED.map((seg, i) => (
                      <span
                        key={i}
                        className={`${seg.cls} flex items-center justify-center text-[10px] font-semibold tabular-nums ${i < 3 ? "text-white" : "text-ink"}`}
                        style={{ width: `${seg.share}%` }}
                      >
                        {seg.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <p className="font-display text-base font-bold text-ink-heading">Positive green, negative gray</p>
            <div className="mt-4 flex h-32 items-center gap-2">
              {DELTAS.map((d, i) => (
                <div key={i} className="flex h-full flex-1 flex-col justify-center">
                  <div className="flex h-1/2 items-end">
                    {d > 0 && <div className="w-full rounded-t-[3px] bg-data-1" style={{ height: `${d * 250}%` }} />}
                  </div>
                  <div className="h-px bg-data-baseline" />
                  <div className="flex h-1/2 items-start">
                    {d < 0 && <div className="w-full rounded-b-[3px] bg-data-negative" style={{ height: `${-d * 250}%` }} />}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-ink-muted">A fall is data, not an error: gray, never red.</p>
          </Card>
        </div>
      </Section>

      <Section title="Typography">
        <Card>
          <div className="space-y-3">
            {TYPE_SCALE.map((size) => (
              <div key={size} className="flex items-baseline gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
                <span className="w-10 shrink-0 text-[12px] tabular-nums text-ink-muted">{size}</span>
                <span
                  className={size >= 20 ? "font-display font-semibold tracking-[-0.02em] text-ink" : "text-ink/85"}
                  style={{ fontSize: size, lineHeight: size >= 20 ? 1.15 : 1.5 }}
                >
                  Restaurants win on repeat guests
                </span>
              </div>
            ))}
            <p className="pt-1 text-sm text-ink-muted">
              Display: Inter Tight 500–700. Body: Inter 400–600. Numbers are always
              tabular: <span className="font-display text-lg font-bold tabular-nums text-ink">$48,250</span>{" "}
              <span className="tabular-nums text-success-ink">+12.4%</span>
            </p>
          </div>
        </Card>
      </Section>

      <Section title="Buttons">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="dark">Dark</Button>
            <Button size="sm">Small</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Card>
      </Section>

      <Section title="KPI tiles">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard variant="hero" label="MRR" value="$48,250" hint="+12.4% vs last month" icon={DollarSign} />
          <StatCard label="Active clients" value="23" icon={Users} />
          <StatCard label="Loading" value="—" loading />
        </div>
      </Section>

      <Section title="Badges & avatars">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            {(["success", "warning", "danger", "info", "neutral"] as BadgeTone[]).map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
            <span className="mx-2 h-6 w-px bg-line" aria-hidden />
            <Avatar name="Dara Okoye" color="#0E5B37" />
            <Avatar name="Forest Series" color="#022313" />
            <Avatar name="Moss Series" color="#3D5E4C" />
            <Avatar name="Slate Series" color="#656565" size="sm" />
          </div>
        </Card>
      </Section>

      <Section title="Forms">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Business name" placeholder="Harbor Taqueria" hint="As it appears on the storefront." />
            <Input label="Monthly ad budget" error="Must be a number." defaultValue="four grand" />
            <Select
              label="Business type"
              options={[
                { value: "restaurant", label: "Restaurant" },
                { value: "cafe", label: "Cafe" },
                { value: "bar", label: "Bar" },
              ]}
            />
            <Input label="Email" type="email" placeholder="owner@harbortaqueria.example" />
            <div className="sm:col-span-2">
              <Textarea label="Notes" rows={3} placeholder="Two locations; strong brunch trade; no delivery yet." />
            </div>
            <Checkbox
              label="Send the weekly performance email"
              hint="One email, Monday morning, company time."
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
          </div>
        </Card>
      </Section>

      <Section title="Tabs, tooltip, dropdown, pagination">
        <Card>
          <Tabs
            items={[
              { key: "overview", label: "Overview" },
              { key: "activity", label: "Activity", count: 12 },
              { key: "settings", label: "Settings" },
            ]}
            active={tab}
            onChange={setTab}
          />
          <div className="mt-5 flex flex-wrap items-center gap-6">
            <Tooltip content="Explains the thing under it">
              <span className="inline-flex cursor-default items-center gap-1.5 text-sm text-ink-2">
                <Info className="h-4 w-4" /> Hover me
              </span>
            </Tooltip>

            <Dropdown
              trigger={
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink-muted transition-colors hover:bg-surface-2">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              }
              items={[
                { key: "edit", label: "Edit", icon: <Pencil />, onSelect: () => toast.success("Edit chosen.") },
                { key: "delete", label: "Delete", icon: <Trash2 />, danger: true, onSelect: () => toast.error("Delete chosen.") },
              ]}
            />

            <Pagination page={page} pageCount={9} onPageChange={setPage} />
          </div>
        </Card>
      </Section>

      <Section title="Table">
        <TableShell>
          <Table>
            <THead>
              <TR>
                <TH>Client</TH>
                <TH>Service line</TH>
                <TH>Status</TH>
                <TH className="text-right">Monthly budget</TH>
              </TR>
            </THead>
            <TBody>
              {[
                ["Harbor Taqueria", "Growth Sprint", "success", "$3,200"],
                ["Lumen Bakery", "Appetite Audit", "info", "$1,450"],
                ["Northside Diner", "Web & Retention", "warning", "$2,750"],
              ].map(([name, line, tone, budget]) => (
                <TR key={name}>
                  <TD className="font-medium text-ink">{name}</TD>
                  <TD>{line}</TD>
                  <TD>
                    <Badge tone={tone as BadgeTone} size="sm">
                      {tone === "success" ? "Active" : tone === "info" ? "Onboarding" : "Renewal due"}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums">{budget}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      </Section>

      <Section title="Overlays & feedback">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              Open dialog
            </Button>
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
              Open drawer
            </Button>
            <Button variant="secondary" onClick={() => toast.success("Saved. Everything held.")}>
              Success toast
            </Button>
            <Button variant="secondary" onClick={() => toast.error("Couldn't save that.")}>
              Error toast
            </Button>
          </div>
        </Card>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="A dialog" eyebrow="Showcase">
          <p className="text-sm leading-relaxed text-ink-2">
            White surface, hairline border, deep-green scrim. Nothing bounces.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)}>Confirm</Button>
          </div>
        </Modal>

        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="A drawer">
          <p className="text-sm leading-relaxed text-ink-2">
            Side sheet for detail views and long forms.
          </p>
        </Drawer>
      </Section>

      <Section title="States">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="mb-3 text-[13px] font-medium text-ink-muted">Loading</p>
            <div className="space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </Card>
          <Card padded={false}>
            <EmptyState
              title="No campaigns yet"
              description="Connect an ad account and the first sync fills this in."
            />
          </Card>
        </div>
      </Section>

      <Section title="Hero surface">
        <Card surface="dark">
          <p className="eyebrow text-ink-muted">The one glow</p>
          <p className="mt-2 font-display text-[28px] font-bold leading-none tabular-nums text-ink">
            $128,400
          </p>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            surface-dark: green-950 under a faint green glow; tokens re-scope, so text turns white and the accent turns white.
          </p>
        </Card>
      </Section>
    </main>
  );
}

export function Showcase() {
  return (
    <ToastProvider>
      <ShowcaseBody />
    </ToastProvider>
  );
}
