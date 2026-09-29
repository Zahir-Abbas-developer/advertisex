/**
 * What an agent is (Phase 9 scope 1): an AI_AGENT user whose AgentProfile
 * names one capability. A capability declares what it works on, the tools it
 * may call, the permissions those need, its default limits, and `run` — plain
 * code that calls tools and (optionally) asks a model for text.
 *
 * Adding an agent = adding one capability file and one line to the registry.
 * No schema, no new tables, no new routes: the runner, the tools, approvals,
 * automations and the UI all work off this definition.
 */

import type { ToolName, Tools } from "@/modules/ai/agents/tools";

export type SubjectType = "lead" | "client" | "project" | "organization";

export type AiAsk = {
  /** A stable task marker — goes into the system prompt as [task:…]. */
  task: string;
  system: string;
  prompt: string;
  maxTokens?: number;
};

export type RunContext = {
  run: { id: string; organizationId: string; subjectType: SubjectType; subjectId: string | null; input: Record<string, unknown> };
  agent: { id: string; name: string };
  /** Only the tools the capability declares; each checks the agent's grants. */
  tools: Tools;
  /**
   * Ask a model for text. Null when AI is off, the budget is spent, or the
   * call fails — every capability has a path without it. Usage and cost are
   * recorded on the run.
   */
  ask(request: AiAsk): Promise<string | null>;
  /** A line in the run's log. */
  note(message: string): Promise<void>;
};

export type RunResult = {
  /** One line for the run list and the agent's work feed. */
  summary: string;
  /** Anything worth keeping (scores, draft ids…), shown on the run page. */
  data?: Record<string, unknown>;
};

export type Capability = {
  key: string;
  name: string;
  /** What it does, in a sentence — shown where agents are hired and runs started. */
  description: string;
  subjectType: SubjectType;
  tools: readonly ToolName[];
  /** Grants the agent needs (resource:action) — derived from the tools; checked at hire time. */
  defaults: { maxRunsPerHour: number; monthlyBudgetMicros: number };
  run(ctx: RunContext): Promise<RunResult>;
};

export const defineCapability = (c: Capability): Capability => c;
