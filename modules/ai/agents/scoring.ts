/**
 * Lead qualification, the deterministic part (pure). The score is computed
 * here from recorded facts so it is repeatable and explainable; AI, when on,
 * only writes the prose rationale around it. docs/METRICS.md → "Lead
 * qualification".
 */

export type QualificationFacts = {
  /** Monthly value we estimate, whole units. */
  estimatedMonthlyValue: number;
  dealValue: number;
  source: string;
  industry: string | null;
  interestedServices: string[];
  /** Activity counts in the last 30 days. */
  replies: number;
  meetings: number;
  touches: number;
  daysSinceCreated: number;
  daysSinceLastActivity: number | null;
  hasWebsite: boolean;
};

export type Qualification = { score: number; band: "HOT" | "WARM" | "COLD"; factors: { label: string; points: number; max: number }[] };

const SOURCE_POINTS: Record<string, number> = { REFERRAL: 20, INBOUND: 18, WEBSITE: 16, EVENT: 12, SOCIAL: 10, PAID_ADS: 10, OUTREACH: 6, OTHER: 6 };
const FOOD = /restaurant|café|cafe|coffee|bar|bistro|pizz|bakery|grill|kitchen|dining|food|burger|sushi|taco|brunch|dumpling|trattoria|osteria/i;

/** 0–100 from five factors (budget 30 · source 20 · engagement 25 · fit 15 · momentum 10). */
export function qualify(f: QualificationFacts): Qualification {
  const value = Math.max(f.estimatedMonthlyValue, f.dealValue / 12);
  const budget = value >= 3000 ? 30 : value >= 1500 ? 24 : value >= 800 ? 16 : value > 0 ? 8 : 0;
  const source = SOURCE_POINTS[f.source] ?? 8;
  const engagement = Math.min(25, f.meetings * 10 + f.replies * 6 + Math.min(f.touches, 5));
  const fit = Math.min(15, (f.industry && FOOD.test(f.industry) ? 8 : 3) + Math.min(f.interestedServices.length, 3) * 2 + (f.hasWebsite ? 1 : 0));
  const momentum = f.daysSinceLastActivity === null ? (f.daysSinceCreated <= 7 ? 6 : 2) : f.daysSinceLastActivity <= 7 ? 10 : f.daysSinceLastActivity <= 21 ? 6 : 2;
  const factors = [
    { label: "Budget", points: budget, max: 30 },
    { label: "Source", points: source, max: 20 },
    { label: "Engagement", points: engagement, max: 25 },
    { label: "Fit", points: fit, max: 15 },
    { label: "Momentum", points: momentum, max: 10 },
  ];
  const score = factors.reduce((s, x) => s + x.points, 0);
  return { score, band: score >= 70 ? "HOT" : score >= 45 ? "WARM" : "COLD", factors };
}

/** The rationale without AI: the strongest and weakest factors, in words. */
export function ruleRationale(q: Qualification, facts: QualificationFacts): string {
  const share = (x: { points: number; max: number }) => x.points / x.max;
  const sorted = [...q.factors].sort((a, b) => share(b) - share(a));
  const strong = sorted.slice(0, 2).map((x) => x.label.toLowerCase());
  const weak = sorted[sorted.length - 1].label.toLowerCase();
  const engagement = facts.meetings || facts.replies ? ` They've had ${facts.meetings} meeting${facts.meetings === 1 ? "" : "s"} and ${facts.replies} repl${facts.replies === 1 ? "y" : "ies"} in the last month.` : " No replies or meetings yet.";
  return `Strongest on ${strong.join(" and ")}; weakest on ${weak}.${engagement}`;
}

export const nextStepFor = (band: Qualification["band"]) =>
  band === "HOT" ? "Call this week and book an Appetite Audit." : band === "WARM" ? "Send a tailored follow-up with one concrete idea." : "Add to nurture; check back in a month.";
