import type { AiProvider } from "@/modules/ai/provider";

/**
 * Reading a project brief for the skills it needs (Phase 5 design 1).
 *
 * The model may only choose from the organization's own taxonomy: its
 * answer is parsed, matched by name (case-insensitively) against that list,
 * and anything else is dropped — a hallucinated skill can't reach scoring.
 * Any failure (no provider, timeout, bad JSON) yields no skills, never an
 * error: the services' skills are the plan either way.
 */
export const BRIEF_SYSTEM =
  "You read a marketing agency's project brief and pick which skills from a fixed list the work needs. " +
  'Answer with only a JSON array of skill names copied exactly from the list, e.g. ["SEO","Branding"]. ' +
  "Pick at most 5. If none clearly apply, answer [].";

export async function extractBriefSkills<T extends { id: string; name: string }>(
  provider: AiProvider | null,
  brief: string | null | undefined,
  taxonomy: readonly T[],
): Promise<{ skills: T[]; used: boolean; error: string | null }> {
  const text = brief?.trim();
  if (!provider || !text || taxonomy.length === 0) return { skills: [], used: false, error: null };
  try {
    const answer = await provider.complete({
      system: BRIEF_SYSTEM,
      prompt: `Skills list:\n${taxonomy.map((t) => `- ${t.name}`).join("\n")}\n\nBrief:\n${text.slice(0, 4000)}`,
      maxTokens: 200,
      timeoutMs: 8000,
    });
    const match = answer.match(/\[[\s\S]*\]/);
    const names = match ? (JSON.parse(match[0]) as unknown[]) : [];
    const byName = new Map(taxonomy.map((t) => [t.name.toLowerCase(), t]));
    const picked = new Map<string, T>();
    for (const n of names) {
      const t = typeof n === "string" ? byName.get(n.trim().toLowerCase()) : undefined;
      if (t) picked.set(t.id, t);
    }
    return { skills: [...picked.values()].slice(0, 5), used: true, error: null };
  } catch (error) {
    return { skills: [], used: true, error: error instanceof Error ? error.message : "AI failed" };
  }
}
