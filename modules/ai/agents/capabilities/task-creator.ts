import { z } from "zod";

import { defineCapability } from "@/modules/ai/agents/capability";
import { parseJson } from "@/modules/ai/agents/capabilities/json";

const Answer = z.object({ tasks: z.array(z.object({ title: z.string().min(4).max(120), days: z.number().int().min(0).max(60) })).min(1).max(8) });

/** Sentences or bullet lines of a brief that read like work ("Build…", "Set up…"). */
export function tasksFromBrief(brief: string): { title: string; days: number }[] {
  const verbs = /^(add|build|collect|create|design|draft|fix|install|launch|migrate|plan|prepare|publish|redesign|review|set up|setup|shoot|update|write|connect|configure|audit|optimi[sz]e|research)\b/i;
  const parts = brief.split(/\n+|(?<=[.!?])\s+/).map((p) => p.replace(/^[-*•\d.)\s]+/, "").trim()).filter((p) => p.length >= 6);
  return parts.filter((p) => verbs.test(p)).slice(0, 8).map((p, i) => ({ title: p.replace(/[.!?]+$/, "").slice(0, 120), days: 3 + i * 3 }));
}

/**
 * Task Creator: turns a project's brief into its first tasks, assigned to the
 * project's owner. Without AI, the brief's action sentences become tasks;
 * with no brief, each stage gets a kick-off task.
 */
export default defineCapability({
  key: "task-creator",
  name: "Task Creator",
  description: "Turns a project's brief into its first tasks, assigned to the project owner.",
  subjectType: "project",
  tools: ["projects.read", "tasks.create"],
  defaults: { maxRunsPerHour: 20, monthlyBudgetMicros: 2_000_000 },
  async run(ctx) {
    const p = await ctx.tools["projects.read"]({ projectId: ctx.run.subjectId! });
    const ai = p.brief
      ? parseJson(
          await ctx.ask({
            task: "task-creator",
            system: 'You turn a restaurant-marketing project brief into its first 3–8 concrete tasks. Only tasks the brief supports. Reply with JSON only: {"tasks": [{"title": string, "days": number (days from today)}]}.',
            prompt: JSON.stringify({ project: p.title, client: p.client, services: p.services, stages: p.stages.map((s) => s.name), brief: p.brief }),
            maxTokens: 500,
          }),
          Answer,
        )
      : null;
    const plan = ai?.tasks ?? (p.brief ? tasksFromBrief(p.brief) : []);
    const tasks = plan.length ? plan : p.stages.slice(0, 5).map((s, i) => ({ title: `Kick off: ${s.name}`, days: 2 + i * 5 }));
    const created: string[] = [];
    for (const t of tasks) {
      const out = await ctx.tools["tasks.create"]({ projectId: p.id, assigneeId: p.ownerId, title: t.title, note: `Created by ${ctx.agent.name} from the project brief.`, dueInDays: t.days });
      created.push(out.taskId);
    }
    return { summary: `${p.title}: ${created.length} task${created.length === 1 ? "" : "s"} created`, data: { taskIds: created, plannedBy: ai ? "AI" : p.brief ? "BRIEF" : "STAGES" } };
  },
});
