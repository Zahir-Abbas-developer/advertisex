import type { Capability } from "@/modules/ai/agents/capability";
import clientCheckIn from "@/modules/ai/agents/capabilities/client-check-in";
import followUp from "@/modules/ai/agents/capabilities/follow-up";
import internalNotifier from "@/modules/ai/agents/capabilities/internal-notifier";
import leadQualification from "@/modules/ai/agents/capabilities/lead-qualification";
import leadResearch from "@/modules/ai/agents/capabilities/lead-research";
import reportDrafting from "@/modules/ai/agents/capabilities/report-drafting";
import taskCreator from "@/modules/ai/agents/capabilities/task-creator";

/**
 * Every capability an AI employee can have. Adding an agent is adding its
 * definition here — nothing else changes (tests/agents.test.ts checks every
 * entry is well-formed: known tools, grants the matrix offers agents).
 */
export const CAPABILITIES: readonly Capability[] = [leadResearch, leadQualification, followUp, reportDrafting, internalNotifier, taskCreator, clientCheckIn];

export const capability = (key: string) => CAPABILITIES.find((c) => c.key === key) ?? null;
