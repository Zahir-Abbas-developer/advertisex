import type { Schedule } from "@/modules/projects/domain";

/**
 * Client health (Phase 4 scope 1) — a band with its reasons, from delivery
 * facts only. Pure; pinned by tests/client-health.test.ts; rules in
 * docs/METRICS.md.
 *
 * Rules, not a weighted score: every band names the facts that put it there,
 * so the indicator can be acted on rather than argued with.
 */

export type HealthBand = "HEALTHY" | "WATCH" | "AT_RISK";

export const HEALTH_LABEL: Record<HealthBand, string> = {
  HEALTHY: "Healthy",
  WATCH: "Watch",
  AT_RISK: "At risk",
};

export const HEALTH_TONE: Record<HealthBand, "success" | "warning" | "danger"> = {
  HEALTHY: "success",
  WATCH: "warning",
  AT_RISK: "danger",
};

export type HealthInput = {
  /** Open projects with where they stand. */
  projects: readonly { schedule: Schedule; daysOverdue: number }[];
  /** Milestones and tasks completed on or before their due date ÷ those completed with one. */
  onTime: { onTime: number; withDue: number };
  /** Open milestones and tasks past their due date. */
  overdueItems: number;
  contracts: readonly { status: string; endDate: Date | null }[];
  now: Date;
};

export type Health = { band: HealthBand; reasons: string[] };

/** Fewer completions than this and an on-time rate is not evidence. */
export const MIN_ON_TIME_SAMPLE = 5;

const LIVE_CONTRACT = new Set(["SIGNED", "ACTIVE"]);

export function clientHealth(input: HealthInput): Health {
  const risk: string[] = [];
  const watch: string[] = [];

  const overdue = input.projects.filter((p) => p.schedule === "OVERDUE");
  const behind = input.projects.filter((p) => p.schedule === "BEHIND");
  const delayed = overdue.length + behind.length;
  const longOverdue = overdue.filter((p) => p.daysOverdue > 7);

  if (longOverdue.length) risk.push(`${longOverdue.length} project${longOverdue.length > 1 ? "s" : ""} more than a week past deadline`);
  if (delayed >= 2) risk.push(`${delayed} projects delayed`);
  else if (delayed === 1) watch.push(overdue.length ? "A project is past its deadline" : "A project is behind schedule");

  const { onTime, withDue } = input.onTime;
  if (withDue >= MIN_ON_TIME_SAMPLE) {
    const rate = onTime / withDue;
    if (rate < 0.6) risk.push(`Only ${Math.round(rate * 100)}% of work delivered on time`);
    else if (rate < 0.85) watch.push(`${Math.round(rate * 100)}% of work delivered on time`);
  }

  if (input.overdueItems > 0) watch.push(`${input.overdueItems} overdue milestone${input.overdueItems > 1 ? "s or tasks" : " or task"}`);

  const soon = input.now.getTime() + 30 * 86_400_000;
  for (const c of input.contracts) {
    if (!LIVE_CONTRACT.has(c.status) || !c.endDate) continue;
    if (c.endDate.getTime() < input.now.getTime()) watch.push("A contract has passed its end date");
    else if (c.endDate.getTime() <= soon) watch.push("A contract ends within 30 days");
  }

  if (risk.length) return { band: "AT_RISK", reasons: [...risk, ...watch] };
  if (watch.length) return { band: "WATCH", reasons: watch };
  return { band: "HEALTHY", reasons: [] };
}
