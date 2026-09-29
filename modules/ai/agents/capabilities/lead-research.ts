import { z } from "zod";

import { defineCapability } from "@/modules/ai/agents/capability";
import { UNTRUSTED_NOTICE, wrapUntrusted } from "@/modules/ai/agents/safety";
import { parseJson } from "@/modules/ai/agents/capabilities/json";

const Answer = z.object({
  summary: z.string().min(10).max(400),
  cuisine: z.string().max(60).nullable().optional(),
  services: z.array(z.string().max(60)).max(8).default([]),
  signals: z.array(z.string().max(80)).max(8).default([]),
  gaps: z.array(z.string().max(80)).max(8).default([]),
});

const has = (text: string, re: RegExp) => re.test(text);

/**
 * Lead Research: reads the lead's public website (as untrusted content) and
 * writes structured notes — what they are, what they offer, marketing
 * signals, and gaps we could fill. Without AI, the notes come from what the
 * page plainly shows.
 */
export default defineCapability({
  key: "lead-research",
  name: "Lead Research",
  description: "Reads a lead's website and public details into structured notes: offer, signals and marketing gaps.",
  subjectType: "lead",
  tools: ["leads.read", "web.fetch", "leads.addNote", "leads.tag"],
  defaults: { maxRunsPerHour: 30, monthlyBudgetMicros: 3_000_000 },
  async run(ctx) {
    const lead = await ctx.tools["leads.read"]({ leadId: ctx.run.subjectId! });
    const website = lead.website ? (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`) : null;
    let page: Awaited<ReturnType<(typeof ctx.tools)["web.fetch"]>> | null = null;
    let fetchError: string | null = null;
    if (website) {
      try {
        page = await ctx.tools["web.fetch"]({ url: website });
      } catch (error) {
        fetchError = error instanceof Error ? error.message : "The site couldn't be read";
      }
    }
    const text = page ? `${page.title} ${page.description} ${page.text}` : "";
    const links = page?.links.join(" ") ?? "";
    // What the page plainly shows (the rules path, and a check on the model).
    const signals = [
      has(`${text} ${links}`, /opentable|resy|sevenrooms|book a table|reserve|reservations/i) && "Online booking",
      has(`${text} ${links}`, /order online|doordash|ubereats|uber eats|grubhub|toasttab|chownow/i) && "Online ordering",
      has(links, /instagram\.com/i) && "Instagram",
      has(links, /facebook\.com/i) && "Facebook",
      has(links, /tiktok\.com/i) && "TikTok",
      has(`${text}`, /brunch/i) && "Brunch",
      has(`${text}`, /private (dining|events?)|catering/i) && "Events or catering",
    ].filter((x): x is string => Boolean(x));
    const gaps = [
      page && !signals.includes("Online booking") && "No online booking seen",
      page && !signals.some((s) => ["Instagram", "Facebook", "TikTok"].includes(s)) && "No social profiles linked",
      page && /\.pdf/i.test(links) && "Menu is a PDF",
      !website && "No website on file",
    ].filter((x): x is string => Boolean(x));
    if (page?.injection.length) await ctx.note(`The site contains text aimed at AI systems (${page.injection.length} pattern${page.injection.length === 1 ? "" : "s"}); it was treated as data and ignored.`);

    const ai = page
      ? parseJson(
          await ctx.ask({
            task: "lead-research",
            system: `You summarise a restaurant's website for a marketing agency. ${UNTRUSTED_NOTICE} Reply with JSON only: {"summary": string, "cuisine": string|null, "services": string[], "signals": string[], "gaps": string[]}.`,
            prompt: `Business: ${lead.businessName} (${lead.industry ?? "restaurant"}, ${lead.location ?? lead.country ?? "location unknown"}).\nObserved on the page: ${signals.join(", ") || "nothing notable"}.\n${wrapUntrusted(website!, text)}`,
            maxTokens: 400,
          }),
          Answer,
        )
      : null;

    const lines = [
      `Research (${website ?? "no website"}${ai ? ", summarised by AI" : ""}):`,
      ai ? ai.summary : page ? `${page.title || lead.businessName}${page.description ? ` — ${page.description}` : ""}` : fetchError ? `The website couldn't be read: ${fetchError}.` : "No website to read.",
      ai?.cuisine ? `Cuisine: ${ai.cuisine}` : null,
      ai?.services.length ? `Offers: ${ai.services.join(", ")}` : null,
      `Signals: ${[...new Set([...signals, ...(ai?.signals ?? [])])].join(", ") || "none seen"}`,
      `Gaps we could fill: ${[...new Set([...gaps, ...(ai?.gaps ?? [])])].join(", ") || "none seen"}`,
    ].filter(Boolean);
    await ctx.tools["leads.addNote"]({ leadId: lead.id, note: lines.join("\n") });
    await ctx.tools["leads.tag"]({ leadId: lead.id, tags: ["researched"] });
    return { summary: `${lead.businessName}: researched${page ? "" : " (no site read)"}`, data: { website, signals, gaps, injectionSignals: page?.injection ?? [], summaryBy: ai ? "AI" : "RULES" } };
  },
});
