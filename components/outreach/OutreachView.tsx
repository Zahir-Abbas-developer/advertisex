"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { OUTREACH_KINDS, OUTREACH_LABEL, sumCounts, type OutreachCounts, type Period } from "@/modules/outreach/domain";

type Payload = {
  scope: "company" | "departments" | "self";
  buckets: { key: string; total: OutreachCounts; byUser: Record<string, OutreachCounts> }[];
  total: OutreachCounts;
  byUser: Record<string, OutreachCounts>;
  people: { id: string; name: string; avatarColor: string }[];
  counted: number;
  current: string;
  spanDays: number;
};

const PERIOD_LABEL: Record<Period, string> = { day: "Daily", week: "Weekly", month: "Monthly" };
const CURRENT_LABEL: Record<Period, string> = { day: "Today", week: "This week", month: "This month" };
const BY_LABEL: Record<Period, string> = { day: "Day by day", week: "Week by week", month: "Month by month" };
const spanLabel = (days: number) => (days >= 360 ? "the last 12 months" : days >= 28 && days % 7 === 0 ? `the last ${days / 7} weeks` : `the last ${days} days`);
const bucketLabel = (period: Period, key: string) =>
  period === "month"
    ? new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : period === "week"
      ? `Week of ${new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Outreach — every figure a count of logged activities (modules/outreach).
 * An employee sees their own; the founder sees each person and the company.
 */
export function OutreachView() {
  const [period, setPeriod] = useState<Period>("week");
  const [person, setPerson] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    const query = new URLSearchParams({ period, ...(person ? { userId: person } : {}) });
    const res = await fetch(`/api/outreach?${query}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [period, person]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <ErrorState title="Outreach didn't load" description="Try again in a moment." onRetry={() => void load()} />;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Tabs
          items={(["day", "week", "month"] as const).map((p) => ({ key: p, label: PERIOD_LABEL[p] }))}
          active={period}
          onChange={setPeriod}
        />
        {data && data.scope !== "self" && (
          <div className="w-56">
            <Select
              aria-label="Person"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              options={[{ value: "", label: data.scope === "company" ? "Whole company" : "My departments" }, ...data.people.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </div>
        )}
      </div>

      {!data ? (
        <div className="space-y-4">
          <Skeleton className="h-[140px] rounded-card" />
          <Skeleton className="h-[320px] rounded-card" />
        </div>
      ) : data.counted === 0 ? (
        <Card padded={false}>
          <EmptyState
            title="No outreach logged in this period"
            description="Calls, emails, meetings and proposals logged on a lead's timeline are counted here."
            action={<Link href="/pipeline" className="text-[13px] text-brand hover:underline">Go to the pipeline</Link>}
          />
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-ink">{CURRENT_LABEL[period]}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {OUTREACH_KINDS.map((k) => (
                <StatCard
                  key={k}
                  label={OUTREACH_LABEL[k]}
                  value={(data.buckets.find((b) => b.key === data.current)?.total[k] ?? 0).toLocaleString()}
                  hint={`${data.total[k].toLocaleString()} over ${spanLabel(data.spanDays)}`}
                />
              ))}
            </div>
          </section>

          {data.scope !== "self" && !person && data.people.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold text-ink">
                By person <span className="text-[13px] font-normal text-ink/50">· {spanLabel(data.spanDays)}</span>
              </h2>
              <TableShell>
                <Table>
                  <THead>
                    <TR>
                      <TH>Person</TH>
                      {OUTREACH_KINDS.map((k) => <TH key={k} className="text-right">{OUTREACH_LABEL[k]}</TH>)}
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.people
                      .map((p) => ({ p, c: data.byUser[p.id] }))
                      .sort((a, b) => sumCounts(b.c) - sumCounts(a.c))
                      .map(({ p, c }) => (
                        <TR key={p.id}>
                          <TD>
                            <button type="button" onClick={() => setPerson(p.id)} className="flex items-center gap-2 hover:text-brand">
                              <Avatar name={p.name} color={p.avatarColor} size="sm" />
                              <span className="whitespace-nowrap text-[13px] text-ink">{p.name}</span>
                            </button>
                          </TD>
                          {OUTREACH_KINDS.map((k) => <TD key={k} className="text-right tabular-nums">{c[k]}</TD>)}
                          <TD className="text-right font-medium tabular-nums">{sumCounts(c)}</TD>
                        </TR>
                      ))}
                  </TBody>
                </Table>
              </TableShell>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-ink">{BY_LABEL[period]}</h2>
            <TableShell>
              <Table>
                <THead>
                  <TR>
                    <TH>{period === "day" ? "Day" : period === "week" ? "Week" : "Month"}</TH>
                    {OUTREACH_KINDS.map((k) => <TH key={k} className="text-right">{OUTREACH_LABEL[k]}</TH>)}
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.buckets.map((b) => (
                    <TR key={b.key}>
                      <TD className="text-[13px] text-ink/80">{bucketLabel(period, b.key)}</TD>
                      {OUTREACH_KINDS.map((k) => <TD key={k} className="text-right tabular-nums text-ink/80">{b.total[k] || "—"}</TD>)}
                      <TD className="text-right font-medium tabular-nums">{sumCounts(b.total)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableShell>
          </section>
        </>
      )}
    </div>
  );
}
