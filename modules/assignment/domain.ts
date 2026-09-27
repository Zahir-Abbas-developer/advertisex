/**
 * Project assignment (Phase 5) — the deterministic core. Pure: every input is
 * passed in, nothing is fetched. Formulas in docs/METRICS.md; pinned by
 * tests/assignment-domain.test.ts.
 *
 *   score = w1·skillMatch + w2·availability + w3·(1 − workloadRatio)
 *         + w4·performanceHistory + w5·deadlineFit        (+ override signal)
 *
 * with hard constraints — a candidate must hold the role's skill and must
 * have the capacity for it — and a plain-language explanation for every
 * recommendation.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type Weights = {
  skillMatch: number;
  availability: number;
  capacity: number;
  performance: number;
  deadlineFit: number;
};

export const DEFAULT_WEIGHTS: Weights = { skillMatch: 40, availability: 10, capacity: 20, performance: 20, deadlineFit: 10 };

export const WEIGHT_LABEL: Record<keyof Weights, string> = {
  skillMatch: "Skill match",
  availability: "Availability",
  capacity: "Free capacity",
  performance: "On-time history",
  deadlineFit: "Deadline fit",
};

/** Weights as fractions of their total; all-zero or invalid falls back to the defaults. */
export function normalizeWeights(w: Partial<Weights> | null | undefined): Weights {
  const pick = (k: keyof Weights) => {
    const v = Number(w?.[k]);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const raw: Weights = { skillMatch: pick("skillMatch"), availability: pick("availability"), capacity: pick("capacity"), performance: pick("performance"), deadlineFit: pick("deadlineFit") };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  const base = total > 0 ? raw : DEFAULT_WEIGHTS;
  const sum = Object.values(base).reduce((a, b) => a + b, 0);
  return {
    skillMatch: base.skillMatch / sum,
    availability: base.availability / sum,
    capacity: base.capacity / sum,
    performance: base.performance / sum,
    deadlineFit: base.deadlineFit / sum,
  };
}

export function parseWeights(json: string | null | undefined): Weights {
  try {
    return normalizeWeights(json ? (JSON.parse(json) as Partial<Weights>) : null);
  } catch {
    return normalizeWeights(null);
  }
}

export const ASSIGNMENT_MODES = ["RECOMMEND", "AUTO"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

/** A candidate must hold the role's skill at least at this proficiency (1–5). */
export const MIN_PROFICIENCY = 2;
/** Estimated hours per task or milestone with no estimate (as Phase 2's workload). */
export const ITEM_HOURS = 2;
/** Performance when there is no delivery history — neutral, not a penalty. */
export const NO_HISTORY_PERFORMANCE = 0.6;
/** How much one override moves a person's score for that skill, and the cap. */
export const SIGNAL_STEP = 0.04;
export const SIGNAL_CAP = 0.12;
/** A better candidate must beat the current one by this much to suggest a swap. */
export const REBALANCE_MARGIN = 0.15;

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export type RequiredSkill = { skillId: string; name: string; weight: number; sources: ("SERVICE" | "BRIEF" | "MANUAL")[] };

/**
 * The project's required skills with weights (1–5): from each service's
 * skills (their catalog weights), from the brief (AI extraction, weight 2),
 * and from skills added by hand (weight 3). A skill named more than once
 * keeps its highest weight and every source. Heaviest first.
 */
export function deriveRequirements(input: {
  services: readonly { skills: readonly { skillId: string; name: string; weight: number }[] }[];
  brief?: readonly { skillId: string; name: string }[];
  manual?: readonly { skillId: string; name: string; weight?: number }[];
}): RequiredSkill[] {
  const map = new Map<string, RequiredSkill>();
  const add = (skillId: string, name: string, weight: number, source: RequiredSkill["sources"][number]) => {
    const w = Math.min(5, Math.max(1, Math.round(weight)));
    const row = map.get(skillId);
    if (row) {
      row.weight = Math.max(row.weight, w);
      if (!row.sources.includes(source)) row.sources.push(source);
    } else {
      map.set(skillId, { skillId, name, weight: w, sources: [source] });
    }
  };
  for (const s of input.services) for (const k of s.skills) add(k.skillId, k.name, k.weight, "SERVICE");
  for (const k of input.brief ?? []) add(k.skillId, k.name, 2, "BRIEF");
  for (const k of input.manual ?? []) add(k.skillId, k.name, k.weight ?? 3, "MANUAL");
  return [...map.values()].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Candidates and scoring
// ---------------------------------------------------------------------------

export type Candidate = {
  userId: string;
  name: string;
  isAgent: boolean;
  /** "ACTIVE" | "ON_LEAVE" | "INACTIVE" */
  employmentStatus: string;
  /** skillId → proficiency 1–5 */
  skills: ReadonlyMap<string, number>;
  weeklyCapacityHours: number;
  /** Open tasks and open project milestones assigned to them. */
  openItems: number;
  /** Open projects they're on (each carries a weekly role load). */
  openProjectRoles: number;
  /** Open items due on or before this project's deadline. */
  itemsDueBeforeDeadline: number;
  /** Completed items with a due date, and those done by it. */
  delivered: { withDue: number; onTime: number };
  /** Approved leave days in the project's first two weeks. */
  leaveDays: number;
  /** Already on this project (its first role's load is already counted). */
  onProject: boolean;
  /** Roles already given to them earlier in this plan. */
  plannedRoles?: number;
  /** Net founder overrides for this skill: + chosen over the recommendation, − overridden away. */
  signal?: number;
};

export type ScoreContext = {
  weights: Weights;
  /** Weekly hours a project role is expected to take. */
  roleHours: number;
  /** Working weeks between project start and deadline, at least 1. */
  windowWeeks: number;
  requirements: readonly RequiredSkill[];
};

export type Components = { skillMatch: number; availability: number; capacity: number; performance: number; deadlineFit: number };

export type Evaluation = {
  userId: string;
  name: string;
  isAgent: boolean;
  eligible: boolean;
  /** Why not, when not. */
  reasons: string[];
  score: number;
  components: Components;
  /** Committed hours ÷ capacity, before this assignment. */
  workloadRatio: number;
  /** Share of capacity still free after this assignment, 0–1. */
  freeAfter: number;
  coverage: { held: number; of: number };
  proficiency: number;
  onTimeRate: number | null;
  signal: number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Weekly hours already committed: open items, open project roles, and the
 * roles this plan has already given them (every role carries its load; a
 * project member's first role here is the membership already counted).
 */
export function committedHours(c: Candidate, roleHours: number): number {
  const planned = Math.max(0, (c.plannedRoles ?? 0) - (c.onProject ? 1 : 0));
  return c.openItems * ITEM_HOURS + (c.openProjectRoles + planned) * roleHours;
}

/** Hours this role adds: none for a member's first role here, one role load otherwise. */
const roleExtra = (c: Candidate, roleHours: number) => (c.onProject && !(c.plannedRoles ?? 0) ? 0 : roleHours);

/**
 * One candidate for one role (a required skill).
 *
 *   skillMatch    0.7 × proficiency in the role's skill ÷ 5
 *                 + 0.3 × weighted share of all the project's skills they hold
 *   availability  1 − approved leave days in the first two weeks ÷ 10; 0 on leave or inactive
 *   capacity      share of weekly capacity still free after taking the role
 *   performance   on-time rate over completed dated work; 0.6 with no history
 *   deadlineFit   1 − hours already due by the deadline ÷ capacity over the window
 *
 * Hard constraints (ineligible, never ranked): not holding the skill at ≥ 2;
 * inactive or on leave; no capacity; committed + this role's hours above
 * weekly capacity. Each role carries a weekly load, so a person
 * given several roles on one project has less room with each — which is what
 * spreads a project across its specialists rather than onto one generalist.
 */
export function evaluate(c: Candidate, skillId: string, ctx: ScoreContext): Evaluation {
  const reasons: string[] = [];
  const proficiency = c.skills.get(skillId) ?? 0;
  if (proficiency < MIN_PROFICIENCY) reasons.push(proficiency ? `only ${proficiency}/5 in this skill` : "doesn't hold this skill");
  if (c.employmentStatus !== "ACTIVE") reasons.push(c.employmentStatus === "ON_LEAVE" ? "on leave" : "not active");
  if (c.weeklyCapacityHours <= 0) reasons.push("no weekly capacity set");

  const committed = committedHours(c, ctx.roleHours);
  const capacity = Math.max(0, c.weeklyCapacityHours);
  const workloadRatio = capacity > 0 ? committed / capacity : 1;
  const after = committed + roleExtra(c, ctx.roleHours);
  if (capacity > 0 && after > capacity) reasons.push(`at capacity (${Math.round(workloadRatio * 100)}% committed)`);

  const totalWeight = ctx.requirements.reduce((t, r) => t + r.weight, 0) || 1;
  const heldWeight = ctx.requirements.reduce((t, r) => t + ((c.skills.get(r.skillId) ?? 0) >= MIN_PROFICIENCY ? r.weight : 0), 0);
  const held = ctx.requirements.filter((r) => (c.skills.get(r.skillId) ?? 0) >= MIN_PROFICIENCY).length;

  const onTimeRate = c.delivered.withDue > 0 ? c.delivered.onTime / c.delivered.withDue : null;
  const components: Components = {
    skillMatch: clamp01(0.7 * (proficiency / 5) + 0.3 * (heldWeight / totalWeight)),
    availability: c.employmentStatus === "ACTIVE" ? clamp01(1 - c.leaveDays / 10) : 0,
    // Measured after the role, for everyone alike: the current holder's role
    // is already in their load, a newcomer's is added.
    capacity: capacity > 0 ? clamp01(1 - after / capacity) : 0,
    performance: onTimeRate ?? NO_HISTORY_PERFORMANCE,
    deadlineFit: capacity > 0 ? clamp01(1 - (c.itemsDueBeforeDeadline * ITEM_HOURS) / (capacity * Math.max(1, ctx.windowWeeks))) : 0,
  };
  const w = ctx.weights;
  const signal = Math.max(-SIGNAL_CAP, Math.min(SIGNAL_CAP, (c.signal ?? 0) * SIGNAL_STEP));
  const base =
    w.skillMatch * components.skillMatch +
    w.availability * components.availability +
    w.capacity * components.capacity +
    w.performance * components.performance +
    w.deadlineFit * components.deadlineFit;

  return {
    userId: c.userId,
    name: c.name,
    isAgent: c.isAgent,
    eligible: reasons.length === 0,
    reasons,
    score: clamp01(base + signal),
    components,
    workloadRatio,
    freeAfter: capacity > 0 ? clamp01(1 - after / capacity) : 0,
    coverage: { held, of: ctx.requirements.length },
    proficiency,
    onTimeRate,
    signal,
  };
}

/** Eligible candidates for a role, best first; ties go to the lighter workload, then the name. */
export function rank(candidates: readonly Candidate[], skillId: string, ctx: ScoreContext): { eligible: Evaluation[]; ineligible: Evaluation[] } {
  const all = candidates.map((c) => evaluate(c, skillId, ctx));
  const eligible = all
    .filter((e) => e.eligible)
    .sort((a, b) => b.score - a.score || a.workloadRatio - b.workloadRatio || a.name.localeCompare(b.name));
  return { eligible, ineligible: all.filter((e) => !e.eligible) };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * One line a founder can read: e.g. "Best match: covers 3/3 required skills
 * · SEO 4/5 · 40% capacity free · 96% on-time delivery."
 */
export function explain(e: Evaluation, skillName: string, place: "best" | "alternative" = "best", leader?: Evaluation): string {
  const parts = [
    `covers ${e.coverage.held}/${e.coverage.of} required skill${e.coverage.of === 1 ? "" : "s"}`,
    `${skillName} ${e.proficiency}/5`,
    `${pct(e.freeAfter)} capacity free`,
    e.onTimeRate === null ? "no delivery history yet" : `${pct(e.onTimeRate)} on-time delivery`,
  ];
  if (e.components.availability < 1 && e.components.availability > 0) parts.push("some leave in the first two weeks");
  if (e.components.deadlineFit < 0.5) parts.push("other deadlines before this one");
  if (e.signal > 0) parts.push("you've chosen them for this before");
  if (e.signal < 0) parts.push("you've chosen others over them before");
  if (e.isAgent) parts.push("AI agent");
  const head = place === "best" ? "Best match" : leader ? `${Math.round((leader.score - e.score) * 100)} points behind` : "Alternative";
  return `${head}: ${parts.join(" · ")}.`;
}

export function explainGap(skillName: string, ineligible: readonly Evaluation[]): string {
  const holders = ineligible.filter((e) => e.proficiency >= MIN_PROFICIENCY);
  if (holders.length === 0) return `No one on the team holds ${skillName} (at 2/5 or better) — a hiring or training gap.`;
  const why = holders.map((h) => `${h.name} (${h.reasons.join(", ")})`).slice(0, 3).join("; ");
  return `Everyone who holds ${skillName} is unavailable: ${why}.`;
}

// ---------------------------------------------------------------------------
// The team plan
// ---------------------------------------------------------------------------

export type RolePlan = {
  skillId: string;
  skillName: string;
  weight: number;
  recommended: (Evaluation & { explanation: string }) | null;
  alternatives: (Evaluation & { explanation: string })[];
  gap: string | null;
};

/**
 * A recommendation per required skill, heaviest first. Each role given
 * adds its load to that person, so later roles see them busier.
 */
export function planTeam(candidates: readonly Candidate[], ctx: ScoreContext, alternatives = 3): RolePlan[] {
  const planned = new Map<string, number>();
  const plans: RolePlan[] = [];
  for (const req of ctx.requirements) {
    const pool = candidates.map((c) => ({ ...c, plannedRoles: planned.get(c.userId) ?? 0 }));
    const { eligible, ineligible } = rank(pool, req.skillId, ctx);
    const [best, ...rest] = eligible;
    if (best) planned.set(best.userId, (planned.get(best.userId) ?? 0) + 1);
    plans.push({
      skillId: req.skillId,
      skillName: req.name,
      weight: req.weight,
      recommended: best ? { ...best, explanation: explain(best, req.name, "best") } : null,
      alternatives: rest.slice(0, alternatives).map((e) => ({ ...e, explanation: explain(e, req.name, "alternative", best) })),
      gap: best ? null : explainGap(req.name, ineligible),
    });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Rebalancing
// ---------------------------------------------------------------------------

export type Rebalance = { reason: string; toUserId: string | null } | null;

/**
 * Should the person holding a role hand it over? Only ever a suggestion:
 *   - they can no longer do it (lost the skill, on leave, inactive), or
 *   - they're over capacity, or
 *   - the project is delayed and someone scores 15+ points higher.
 * The suggested replacement is the best eligible other candidate, if any.
 */
export function rebalance(current: Evaluation, best: Evaluation | null, projectDelayed: boolean): Rebalance {
  const other = best && best.userId !== current.userId ? best : null;
  const cannot = current.proficiency < MIN_PROFICIENCY || current.components.availability === 0;
  if (cannot) return { reason: `${current.name} can no longer cover this (${current.reasons.join(", ") || "unavailable"})`, toUserId: other?.userId ?? null };
  if (current.workloadRatio > 1) return { reason: `${current.name} is over capacity (${pct(current.workloadRatio)} committed)`, toUserId: other?.userId ?? null };
  if (projectDelayed && other && other.score - current.score >= REBALANCE_MARGIN) {
    return { reason: `The project is delayed and ${other.name} is a clearly better fit (${Math.round((other.score - current.score) * 100)} points)`, toUserId: other.userId };
  }
  return null;
}
