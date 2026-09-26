/**
 * The service catalog Advertise X sells (Phase 4 scope 1), with each
 * service's default stage template (scope 3) and the skills it needs (scope 2).
 * Pure data: the seed copies it into each organization, and from then on the
 * founder edits the organization's own rows — this file is only the default.
 */

export const BILLING_CADENCES = ["ONE_TIME", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type Billing = (typeof BILLING_CADENCES)[number];

export const BILLING_LABEL: Record<Billing, string> = {
  ONE_TIME: "One-time",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export const isBilling = (value: unknown): value is Billing =>
  typeof value === "string" && (BILLING_CADENCES as readonly string[]).includes(value);

/** What a price is worth per month, for recurring revenue. One-time → 0. */
export function monthlyEquivalent(price: number, billing: string): number {
  switch (billing) {
    case "MONTHLY":
      return price;
    case "QUARTERLY":
      return Math.round(price / 3);
    case "YEARLY":
      return Math.round(price / 12);
    default:
      return 0;
  }
}

export type CatalogService = {
  slug: string;
  name: string;
  description: string;
  price: number;
  billing: Billing;
  stages: readonly string[];
  /** Names from the organization's skills taxonomy (prisma/seed.ts SKILLS). */
  skills: readonly string[];
};

export const DEFAULT_SERVICES: readonly CatalogService[] = [
  {
    slug: "website-development",
    name: "Website Development",
    description: "A fast, bookable restaurant website.",
    price: 4500,
    billing: "ONE_TIME",
    stages: ["Planning", "Design", "Development", "Testing", "Launch"],
    skills: ["Websites", "UI/UX", "Development"],
  },
  {
    slug: "mobile-application",
    name: "Mobile Application",
    description: "Ordering and loyalty app for iOS and Android.",
    price: 18000,
    billing: "ONE_TIME",
    stages: ["Discovery", "Design", "Development", "Testing", "Store release"],
    skills: ["Mobile Apps", "UI/UX", "Development"],
  },
  {
    slug: "google-ads",
    name: "Google Ads",
    description: "Search and Performance Max campaigns that fill tables.",
    price: 1500,
    billing: "MONTHLY",
    stages: ["Audit", "Setup", "Launch", "Optimize", "Report"],
    skills: ["Google Ads"],
  },
  {
    slug: "meta-ads",
    name: "Meta Ads",
    description: "Facebook and Instagram campaigns.",
    price: 1500,
    billing: "MONTHLY",
    stages: ["Audit", "Creative", "Launch", "Optimize", "Report"],
    skills: ["Meta Ads", "Creative Production"],
  },
  {
    slug: "seo",
    name: "SEO",
    description: "Organic search growth for the brand.",
    price: 1200,
    billing: "MONTHLY",
    stages: ["Audit", "Technical fixes", "Content", "Links", "Report"],
    skills: ["SEO"],
  },
  {
    slug: "local-seo",
    name: "Local SEO",
    description: "Ranking in the map pack for every location.",
    price: 800,
    billing: "MONTHLY",
    stages: ["Audit", "Citations", "Reviews", "Optimize", "Report"],
    skills: ["Local SEO"],
  },
  {
    slug: "google-business-profile",
    name: "Google Business Profile Optimization",
    description: "Profiles that convert searchers into diners.",
    price: 600,
    billing: "ONE_TIME",
    stages: ["Audit", "Optimize", "Photos & posts", "Review"],
    skills: ["Google Business Profile", "Local SEO"],
  },
  {
    slug: "social-media-marketing",
    name: "Social Media Marketing",
    description: "Content calendar, posting and community.",
    price: 1800,
    billing: "MONTHLY",
    stages: ["Strategy", "Content plan", "Production", "Publishing", "Report"],
    skills: ["Social Media Marketing", "Creative Production"],
  },
  {
    slug: "branding",
    name: "Branding",
    description: "Identity, voice and guidelines.",
    price: 6000,
    billing: "ONE_TIME",
    stages: ["Discovery", "Concepts", "Refinement", "Guidelines", "Handover"],
    skills: ["Branding", "Graphic Design"],
  },
  {
    slug: "ai-automation",
    name: "AI Automation",
    description: "Automated bookings, replies and follow-ups.",
    price: 3500,
    billing: "ONE_TIME",
    stages: ["Discovery", "Design", "Build", "Testing", "Rollout"],
    skills: ["AI Automation", "Automation"],
  },
  {
    slug: "crm-implementation",
    name: "CRM Implementation",
    description: "Guest data and marketing CRM, set up and connected.",
    price: 5000,
    billing: "ONE_TIME",
    stages: ["Discovery", "Configuration", "Data migration", "Training", "Go-live"],
    skills: ["CRM Implementation", "Automation"],
  },
];

/** Stages for a service with no template — a project always has a plan. */
export const FALLBACK_STAGES: readonly string[] = ["Planning", "Delivery", "Review"];

export function slugifyService(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
