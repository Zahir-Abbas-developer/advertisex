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
const COLOR_TOKENS = [
  { name: "canvas", cls: "bg-canvas", note: "#0B0B0D · page" },
  { name: "surface", cls: "bg-surface", note: "#121215 · cards" },
  { name: "surface-2", cls: "bg-surface-2", note: "#18181C · elevated" },
  { name: "ink", cls: "bg-ink", note: "#F5F3EE · text" },
  { name: "brand", cls: "bg-brand", note: "#D4AF37 · identity only" },
  { name: "data-1", cls: "bg-data-1", note: "#2DD4BF · series 1" },
  { name: "data-2", cls: "bg-data-2", note: "#818CF8 · series 2" },
  { name: "data-3", cls: "bg-data-3", note: "#F472B6 · series 3" },
  { name: "success", cls: "bg-success", note: "#22C55E" },
  { name: "warn", cls: "bg-warn", note: "#F59E0B" },
  { name: "danger", cls: "bg-danger", note: "#EF4444" },
  { name: "info", cls: "bg-info", note: "#38BDF8" },
] as const;

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
        <p className="eyebrow text-brand">Obsidian &amp; Gold</p>
        <h1 className="mt-2 font-display text-[34px] font-bold leading-none tracking-[-0.03em] text-ink">
          Design system
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/60">
          Every token and primitive, rendered live. The written law is{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">docs/DESIGN_SYSTEM.md</code>;
          if this page and that file disagree, one of them has a bug. Development only.
        </p>
      </header>

      <Section title="Color tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COLOR_TOKENS.map((token) => (
            <div key={token.name} className="rounded-card border border-line bg-surface p-3">
              <div className={`h-10 rounded-[8px] border border-line ${token.cls}`} />
              <p className="mt-2 text-[13px] font-medium text-ink">{token.name}</p>
              <p className="text-[12px] tabular-nums text-ink/45">{token.note}</p>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-ink/50">
          Gold is identity and emphasis only — never a chart series. Hairlines are{" "}
          <code className="text-ink/70">line</code> (white 8%) and{" "}
          <code className="text-ink/70">line-strong</code> (14%); depth comes from surface
          steps, not shadows.
        </p>
      </Section>

      <Section title="Typography">
        <Card>
          <div className="space-y-3">
            {TYPE_SCALE.map((size) => (
              <div key={size} className="flex items-baseline gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
                <span className="w-10 shrink-0 text-[12px] tabular-nums text-ink/40">{size}</span>
                <span
                  className={size >= 20 ? "font-display font-semibold tracking-[-0.02em] text-ink" : "text-ink/85"}
                  style={{ fontSize: size, lineHeight: size >= 20 ? 1.15 : 1.5 }}
                >
                  Restaurants win on repeat guests
                </span>
              </div>
            ))}
            <p className="pt-1 text-sm text-ink/60">
              Display: Inter Tight 500–700. Body: Inter 400–600. Numbers are always
              tabular: <span className="font-display text-lg font-bold tabular-nums text-ink">$48,250</span>{" "}
              <span className="tabular-nums text-success">+12.4%</span>
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
          <StatCard label="MRR" value="$48,250" hint="+12.4% vs last month" tone="success" icon={DollarSign} />
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
            <Avatar name="Dara Okoye" color="#D4AF37" />
            <Avatar name="Teal Series" color="#2DD4BF" />
            <Avatar name="Indigo Series" color="#818CF8" />
            <Avatar name="Rose Series" color="#F472B6" size="sm" />
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
              <span className="inline-flex cursor-default items-center gap-1.5 text-sm text-ink/70">
                <Info className="h-4 w-4" /> Hover me
              </span>
            </Tooltip>

            <Dropdown
              trigger={
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink/60 transition-colors hover:bg-surface-2">
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
          <p className="text-sm leading-relaxed text-ink/70">
            Obsidian surface, hairline border, black scrim. Nothing bounces.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)}>Confirm</Button>
          </div>
        </Modal>

        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="A drawer">
          <p className="text-sm leading-relaxed text-ink/70">
            Side sheet for detail views and long forms.
          </p>
        </Drawer>
      </Section>

      <Section title="States">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="mb-3 text-[13px] font-medium text-ink/60">Loading</p>
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
          <p className="eyebrow text-brand">The one glow</p>
          <p className="mt-2 font-display text-[28px] font-bold leading-none tabular-nums text-ink">
            $128,400
          </p>
          <p className="mt-1.5 text-[13px] text-ink/55">
            surface-dark: a step below the page, gold radial at 10% alpha, hairlines in ink-alpha.
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
