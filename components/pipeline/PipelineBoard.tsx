"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BarChart3, Download, Plus, Trophy, Upload, Wallet } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { LeadCard } from "@/components/pipeline/LeadCard";
import { LeadDrawer } from "@/components/pipeline/LeadDrawer";
import { LeadFormModal } from "@/components/pipeline/LeadFormModal";
import { LostDialog } from "@/components/pipeline/LostDialog";
import { DropColumn } from "@/components/pipeline/DropColumn";
import { LeadFilterBar } from "@/components/pipeline/LeadFilterBar";
import { LeadTable } from "@/components/pipeline/LeadTable";
import { ImportLeadsModal } from "@/components/pipeline/ImportLeadsModal";
import { Tabs } from "@/components/ui/Tabs";
import { buttonClasses } from "@/components/ui/Button";
import type { LeadFilters } from "@/modules/leads/domain";
import { formatMoney } from "@/lib/pipeline-types";
import type { StageKind } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type PipelineLead = {
  id: string;
  businessName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  source: string;
  country: string | null;
  interestedServices: string[];
  /** Absent for viewers the money rule strips it from. */
  estimatedMonthlyValue?: number;
  dealValue?: number;
  stage: string;
  stageChangedAt: string;
  lostReason: string | null;
  lostNote: string | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  activityCount: number;
  convertedClientId: string | null;
  createdAt: string;
};

type Stage = {
  id: string;
  key: string;
  label: string;
  kind: StageKind;
  colorToken: string | null;
  sortOrder: number;
};

type Commission = {
  leadId: string;
  businessName: string;
  stageLabel: string;
  dealValue: number;
  ratePercent: number;
  amount: number;
  ownerName: string | null;
};

type Payload = {
  departments: { id: string; shortLabel: string; name: string; colorToken: string | null }[];
  department: { id: string; name: string; shortLabel: string } | null;
  stages: Stage[];
  leads: PipelineLead[];
  /**
   * Money is optional because the server strips it. For viewers who may not see
   * deal values these keys are absent — not zero, not null — so the type has to
   * say so, or the first `.toLocaleString()` throws for every one of them.
   */
  totals: { stage: string; count: number; hasMore?: boolean; value?: number }[];
  commissions: Commission[];
  services: { id?: string; slug: string; name: string }[];
  owners: { id: string; name: string }[];
  viewer: { id: string; isAdmin: boolean; canSeeDealValues?: boolean; canManage?: boolean };
};

/**
 * The pipeline, one department at a time.
 *
 * Same kanban idiom as before — the columns are just no longer a constant. They
 * are the chosen department's `PipelineStage` rows, in its order, with its
 * colours, so Pilot Cars can run New Inquiry → Dispatched → Completed while
 * Affiliates runs New Partner → Active → Commission, and neither is expressed
 * anywhere in this file.
 */
export function PipelineBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>({});
  const [view, setView] = useState<"board" | "table">("board");
  const [importing, setImporting] = useState(false);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [dragging, setDragging] = useState<PipelineLead | null>(null);
  const [creating, setCreating] = useState(false);
  /* Bumped to force a refetch when nothing else changed.

     Without it, saving a lead into the department already on screen sets no
     state React considers different, the effect below never re-runs, and the
     board keeps showing the list it fetched before the lead existed — which
     reads exactly like the lead was never saved. */
  const [reloadToken, setReloadToken] = useState(0);
  const [losing, setLosing] = useState<{ lead: PipelineLead; stage: Stage } | null>(null);

  const openId = searchParams.get("lead");

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (departmentId) query.set("departmentId", departmentId);
      query.set("f", JSON.stringify(filters));

      const response = await fetch(`/api/pipeline?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("failed");

      const body = (await response.json()) as Payload;
      setData(body);
      // Adopt whichever department the server settled on, so the switcher and
      // the board can never disagree about what is being shown.
      if (!departmentId && body.department) setDepartmentId(body.department.id);
      setState("ready");
    } catch {
      setState("error");
    }
    /* `reloadToken` is read by nothing in the body, and that is the point: it
       exists purely so a caller can ask for a refetch when no filter changed.
       The lint rule is right that it is an unusual dependency and wrong that it
       is unnecessary — dropping it is what let a freshly saved lead go missing. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, filters, reloadToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pointer for mouse and touch; keyboard so a card can be picked up with
  // Space, moved with the arrow keys and dropped with Space (Phase 3 scope 2).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** The next page of one column — columns load 50 at a time. */
  async function loadMore(stageKey: string) {
    if (!data?.department) return;
    setLoadingMore(stageKey);
    try {
      const loaded = data.leads.filter((l) => l.stage === stageKey).length;
      const query = new URLSearchParams({ departmentId: data.department.id, stage: stageKey, skip: String(loaded), f: JSON.stringify(filters) });
      const res = await fetch(`/api/pipeline?${query}`, { cache: "no-store" });
      if (!res.ok) return toast.error("Couldn't load more.");
      const body = (await res.json()) as { leads: PipelineLead[]; hasMore: boolean };
      setData((current) =>
        current
          ? {
              ...current,
              leads: [...current.leads, ...body.leads.filter((l) => !current.leads.some((c) => c.id === l.id))],
              totals: current.totals.map((t) => (t.stage === stageKey ? { ...t, hasMore: body.hasMore } : t)),
            }
          : current,
      );
    } finally {
      setLoadingMore(null);
    }
  }

  const byStage = useMemo(() => {
    const map = new Map<string, PipelineLead[]>();
    for (const stage of data?.stages ?? []) map.set(stage.key, []);
    for (const lead of data?.leads ?? []) {
      // A lead whose stage is no longer in the pipeline still exists; it just
      // has no column. Dropping it silently is how records go missing, so the
      // orphan lane below catches it.
      if (!map.has(lead.stage)) continue;
      map.get(lead.stage)!.push(lead);
    }
    return map;
  }, [data]);

  const orphans = useMemo(() => {
    const known = new Set((data?.stages ?? []).map((stage) => stage.key));
    return (data?.leads ?? []).filter((lead) => !known.has(lead.stage));
  }, [data]);

  async function commitStage(
    lead: PipelineLead,
    stage: Stage,
    extra?: Record<string, unknown>,
  ) {
    const previous = data;

    // Optimistic: the card moves now and snaps back if the server disagrees.
    setData((current) =>
      current
        ? {
            ...current,
            leads: current.leads.map((row) =>
              row.id === lead.id ? { ...row, stage: stage.key } : row,
            ),
          }
        : current,
    );

    try {
      const response = await fetch(`/api/leads/${lead.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: stage.key, ...extra }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setData(previous);
        toast.error(body?.error ?? "Couldn't move that.");
        return false;
      }

      if (stage.kind === "WON" || stage.kind === "ACTIVE_CLIENT") {
        toast.success(
          `${lead.businessName} reached ${stage.label}. Convert them from the card when you're ready.`,
        );
      }
      await load();
      return true;
    } catch {
      setData(previous);
      toast.error("We couldn't reach the server.");
      return false;
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over || !data) return;

    const lead = data.leads.find((row) => row.id === active.id);
    if (!lead) return;

    const overId = String(over.id);
    const targetKey = data.stages.some((stage) => stage.key === overId)
      ? overId
      : data.leads.find((row) => row.id === over.id)?.stage;

    const target = data.stages.find((stage) => stage.key === targetKey);
    if (!target || target.key === lead.stage) return;

    if (!data.viewer.isAdmin && lead.owner?.id !== data.viewer.id) {
      toast.error("You can only move leads you own.");
      return;
    }

    // A loss needs its reason before anything moves — the reason is the point,
    // and asking for it afterwards is how it ends up blank.
    if (target.kind === "LOST") {
      setLosing({ lead, stage: target });
      return;
    }

    void commitStage(lead, target);
  }

  const totalsByStage = useMemo(
    () => new Map((data?.totals ?? []).map((row) => [row.stage, row])),
    [data],
  );

  const money = data?.viewer.canSeeDealValues ?? false;

  const openValue = useMemo(() => {
    if (!data || !money) return null;
    return data.stages
      .filter((stage) => stage.kind === "OPEN")
      .reduce((sum, stage) => sum + (totalsByStage.get(stage.key)?.value ?? 0), 0);
  }, [data, money, totalsByStage]);

  const wonValue = useMemo(() => {
    if (!data || !money) return null;
    return data.stages
      .filter((stage) => stage.kind === "WON" || stage.kind === "ACTIVE_CLIENT")
      .reduce((sum, stage) => sum + (totalsByStage.get(stage.key)?.value ?? 0), 0);
  }, [data, money, totalsByStage]);


  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="New business"
        title="Pipeline"
        description="Every live deal, what it's worth, and what's been done about it."
        actions={
          <div className="flex flex-wrap gap-2">
            {data?.viewer.canManage && (
              <Link href="/pipeline/analytics" className={buttonClasses("ghost", "md", "gap-2")}>
                <BarChart3 className="h-4 w-4" /> Analytics
              </Link>
            )}
            <a href={`/api/leads/export?${new URLSearchParams({ f: JSON.stringify({ ...filters, departmentId: data?.department?.id }) })}`} download className={buttonClasses("ghost", "md", "gap-2")}>
              <Download className="h-4 w-4" /> Export
            </a>
            {data?.viewer.canManage && data.department && (
              <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>
                Import
              </Button>
            )}
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Add lead
            </Button>
          </div>
        }
      />

      {/* Which business line's board. Only shown when there is a choice — a
          member with one department has nothing to switch between. */}
      {(data?.departments.length ?? 0) > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {data!.departments.map((option) => {
            const active = data!.department?.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setDepartmentId(option.id);
                  // Stages and owners are per department: keep only the
                  // filters that still mean something.
                  setFilters((f) => ({ ...f, stages: undefined, ownerId: undefined }));
                }}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                  active
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line bg-surface text-ink-muted hover:border-ink/25 hover:text-ink",
                )}
              >
                {option.shortLabel}
              </button>
            );
          })}
        </div>
      )}

      {state === "loading" && (
        <div className="grid gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[320px] rounded-card" />
          ))}
        </div>
      )}

      {state === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load the pipeline"
            description="This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {state === "ready" && data && !data.department && (
        <Card padded={false}>
          <EmptyState
            icon={Wallet}
            eyebrow="No department"
            title="You're not in a department yet"
            description="Deals belong to a department, so an admin needs to add you to one before a board can be shown."
          />
        </Card>
      )}

      {state === "ready" && data && data.department && (
        <>
          {/* Money row, owner only. Absent rather than zeroed: a board reading
              "0 open" is a statement about the business that happens to be
              false. The columns and counts below render for everyone. */}
          {money && openValue !== null && wonValue !== null && (
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Open pipeline"
                value={formatMoney(openValue, true)}
                icon={Wallet}
                tone="info"
                hint={`${data.department.shortLabel} — deals still in play`}
              />
              <StatCard
                label="Won"
                value={formatMoney(wonValue, true)}
                icon={Trophy}
                tone={wonValue > 0 ? "success" : "neutral"}
                hint="Reached a winning stage"
              />
            </div>
          )}

          <LeadFilterBar
            filters={filters}
            onChange={setFilters}
            stages={data.stages.map((s) => ({ key: s.key, label: s.label }))}
            owners={data.owners ?? []}
            canSeeValues={money}
          />

          <Tabs
            items={[
              { key: "board", label: "Board" },
              { key: "table", label: "Table" },
            ]}
            active={view}
            onChange={setView}
          />

          {view === "table" ? (
            <LeadTable filters={filters} onOpen={(id) => router.push(`/pipeline?lead=${id}`)} />
          ) : data.stages.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={Wallet}
                eyebrow="No pipeline"
                title={`${data.department.shortLabel} has no stages yet`}
                description="An admin can add them in Settings → Departments → Pipeline. Without stages there is no board to draw."
              />
            </Card>
          ) : (
            <DndContext
              sensors={sensors}
              onDragStart={(event: DragStartEvent) =>
                setDragging(data.leads.find((row) => row.id === event.active.id) ?? null)
              }
              onDragEnd={onDragEnd}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {data.stages.map((stage) => {
                  const leads = byStage.get(stage.key) ?? [];
                  const totals = totalsByStage.get(stage.key);

                  return (
                    <DropColumn
                      key={stage.key}
                      id={stage.key}
                      title={stage.label}
                      count={totals?.count ?? leads.length}
                      value={totals?.value ?? 0}
                      tone={
                        stage.kind === "WON"
                          ? "success"
                          : stage.kind === "LOST"
                            ? "danger"
                            : undefined
                      }
                    >
                      <SortableContext
                        items={leads.map((lead) => lead.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {leads.map((lead) => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            draggable={
                              data.viewer.isAdmin || lead.owner?.id === data.viewer.id
                            }
                            onOpen={() => router.push(`/pipeline?lead=${lead.id}`)}
                          />
                        ))}
                      </SortableContext>
                      {totals?.hasMore && (
                        <button
                          type="button"
                          onClick={() => void loadMore(stage.key)}
                          disabled={loadingMore === stage.key}
                          className="w-full rounded-[10px] border border-dashed border-line py-2 text-[12px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                        >
                          {loadingMore === stage.key ? "Loading…" : `Show more (${(totals.count - leads.length).toLocaleString()} left)`}
                        </button>
                      )}
                    </DropColumn>
                  );
                })}
              </div>

              <DragOverlay>
                {dragging && <LeadCard lead={dragging} draggable onOpen={() => {}} overlay />}
              </DragOverlay>
            </DndContext>
          )}

          {/* A lead sitting on a stage the department no longer has. Shown
              rather than hidden: an admin removed or renamed a stage and these
              records need somewhere to go. */}
          {orphans.length > 0 && (
            <Card>
              <CardHeader
                title="Not on the board"
                description="These sit on a stage this pipeline no longer has. Open each one and move it."
              />
              <ul className="mt-4 space-y-1.5">
                {orphans.map((lead) => (
                  <li key={lead.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/pipeline?lead=${lead.id}`)}
                      className="text-sm text-ink underline-offset-2 hover:underline"
                    >
                      {lead.businessName}
                      <span className="ml-2 text-ink-muted">{lead.stage}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Commission is derived from the deal value and the department's own
              commission_rate field, so this table appears for whichever
              department defines one — today, Affiliates. */}
          {data.commissions.length > 0 && (
            <Card padded={false}>
              <div className="p-5 sm:p-6">
                <CardHeader
                  title="Commissions"
                  description="Computed from each won deal's value and its commission rate."
                />
              </div>
              <TableShell>
                <Table>
                  <THead>
                    <TR>
                      <TH>Partner</TH>
                      <TH>Stage</TH>
                      <TH>Owner</TH>
                      <TH className="text-right">Deal value</TH>
                      <TH className="text-right">Rate</TH>
                      <TH className="text-right">Commission</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.commissions.map((row) => (
                      <TR key={row.leadId}>
                        <TD>{row.businessName}</TD>
                        <TD className="text-ink-muted">{row.stageLabel}</TD>
                        <TD className="text-ink-muted">{row.ownerName ?? "—"}</TD>
                        <TD className="text-right tabular-nums">
                          {formatMoney(row.dealValue, true)}
                        </TD>
                        <TD className="text-right tabular-nums">{row.ratePercent}%</TD>
                        <TD className="text-right font-medium tabular-nums">
                          {formatMoney(row.amount, true)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableShell>
            </Card>
          )}

          {view === "board" && data.leads.length === 0 && data.stages.length > 0 && (
            <Card padded={false}>
              <EmptyState
                icon={Wallet}
                eyebrow="Nothing in play"
                title={`No deals in ${data.department.shortLabel}`}
                description="Add a lead and it appears on this board."
                action={<Button onClick={() => setCreating(true)}>Add the first lead</Button>}
              />
            </Card>
          )}
        </>
      )}

      <LeadFormModal
        open={creating}
        services={data?.services ?? []}
        canAssign={data?.viewer.isAdmin ?? false}
        onClose={() => setCreating(false)}
        onSaved={(created) => {
          setCreating(false);

          /* Follow the lead to wherever it was actually filed.

             The wizard asks for the department first and offers every one the
             viewer belongs to, so a lead added from the Pilot Cars board can
             perfectly well be a Culture Plus lead. Reloading the board that
             happened to be on screen then shows a list the new record is not
             in. The owner filter is cleared for the same reason: a board
             narrowed to one person hides a lead that was routed to another. */
          const landed = created?.departmentId;
          if (landed && landed !== departmentId) {
            const name =
              data?.departments.find((row) => row.id === landed)?.shortLabel ?? null;
            setDepartmentId(landed);
            if (name) toast.toast(`Showing ${name} — that's where this lead was filed.`, "info");
          }
          setFilters((f) => ({ ...f, ownerId: undefined }));
          setReloadToken((token) => token + 1);
        }}
      />

      {data?.department && (
        <ImportLeadsModal
          open={importing}
          departmentId={data.department.id}
          departmentName={data.department.shortLabel}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            setReloadToken((token) => token + 1);
          }}
        />
      )}

      <LostDialog
        lead={losing?.lead ?? null}
        onClose={() => setLosing(null)}
        onConfirm={async (reason, note) => {
          if (!losing) return;
          const ok = await commitStage(losing.lead, losing.stage, {
            lostReason: reason,
            lostNote: note,
          });
          if (ok) setLosing(null);
        }}
      />

      <LeadDrawer
        leadId={openId}
        services={data?.services ?? []}
        onClose={() => router.push("/pipeline")}
        onChanged={() => void load()}
      />
    </div>
  );
}
