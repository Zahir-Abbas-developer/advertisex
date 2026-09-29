import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { avatarColorFor } from "../lib/constants";
import { serializeSkills } from "../lib/skills";
import { seal } from "../modules/vault/cipher";
import { vaultKeys } from "../modules/vault/keys";
import { dayKey, deriveStatus, numberLabel } from "../modules/billing/domain";
import { channelsForServices, CHANNEL, previousMonth } from "../modules/client-analytics/metrics";
import { mockMonth } from "../modules/integrations/analytics/mock";
import { COMPANY_TIMEZONE } from "../lib/date";
import { capability } from "../modules/ai/agents/registry";
import { grantsFor } from "../modules/ai/agents/grants";

/**
 * The Phase 1 demo tenant (docs/PHASES.md, scope 11): one organization with a
 * founder, a manager, five employees, six AI agents and three restaurant
 * clients with one login each — enough to walk every shell and every
 * isolation rule end to end.
 *
 * **Not run by `vercel-build`.** `prisma/seed.ts` runs on every deploy and
 * stays free of CLIENT and AI_AGENT accounts (ADR-008: while an older
 * deployment might still be serving, it must never meet a role it cannot
 * read). This file runs locally through `db:seed` / `db:reset`, or against a
 * demo environment on purpose. Run it against production only as a
 * deliberate decision, after the role backfill.
 *
 * Builds on `prisma/seed.ts`, which it expects to have run: the organization,
 * the four service lines and the existing six-person roster. Of the scope-11
 * roster that already covers the founder (Coach D), the manager (Raja Zain,
 * whose legacy SUPPORT_ADMIN reads as MANAGER) and four employees; this adds
 * the fifth employee, the agents and the clients.
 *
 * Creates, never overwrites — the same contract as seed.ts. Addresses use the
 * reserved `.example` domain, so no demo account can ever collide with, or
 * email, a real person.
 */

const prisma = new PrismaClient();
const PLACEHOLDER_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";

const EMPLOYEE = {
  name: "Maya Chen",
  email: "maya@advertisex.example",
  jobTitle: "Paid Social Specialist",
  departments: [
    { slug: "growth-sprint", roleInDept: "MEMBER", skills: ["meta ads", "tiktok ads", "creative testing"] },
    { slug: "creative-studio", roleInDept: "MEMBER", skills: ["ugc", "reels"] },
  ],
} as const;

/**
 * AI agents are users of type AI_AGENT with explicit permissions (CLAUDE.md
 * §5). Each grant is a cell the matrix offers agents; the role alone holds
 * nothing. They never sign in: their password is random and discarded.
 */
const AGENTS = [
  { name: "Atlas", email: "atlas.agent@advertisex.example", jobTitle: "Lead Research Agent", capability: "lead-research" },
  { name: "Sage", email: "sage.agent@advertisex.example", jobTitle: "Lead Qualification Agent", capability: "lead-qualification" },
  { name: "Quill", email: "quill.agent@advertisex.example", jobTitle: "Follow-up Agent", capability: "follow-up-prep" },
  { name: "Lens", email: "lens.agent@advertisex.example", jobTitle: "Project Kick-off Agent", capability: "task-creator" },
  { name: "Pulse", email: "pulse.agent@advertisex.example", jobTitle: "Internal Notifier Agent", capability: "internal-notifier" },
  { name: "Ledger", email: "ledger.agent@advertisex.example", jobTitle: "Reporting Agent", capability: "report-drafting" },
] as const;

const RESTAURANTS = [
  {
    account: "Osteria Nonna",
    department: "growth-sprint",
    assigneeEmail: "tayyaba@bwm.local",
    crm: {
      contactName: "Marco Bellini",
      email: "marco@osterianonna.example",
      phone: "+1 718 555 0142",
      country: "United States",
      industry: "Italian restaurant · 2 locations, Brooklyn",
      monthlyBudget: 4000,
      status: "ACTIVE",
    },
    login: { name: "Marco Bellini", email: "marco@osterianonna.example" },
  },
  {
    account: "Bao Society",
    department: "appetite-audit",
    assigneeEmail: "claire@bwm.local",
    crm: {
      contactName: "Jenny Liu",
      email: "jenny@baosociety.example",
      phone: "+1 512 555 0187",
      country: "United States",
      industry: "Dumpling bar · Austin",
      monthlyBudget: 1200,
      status: "ACTIVE",
    },
    login: { name: "Jenny Liu", email: "jenny@baosociety.example" },
  },
  {
    account: "Grind Coffee Co.",
    department: "web-retention",
    assigneeEmail: "cheryl@bwm.local",
    crm: {
      contactName: "Sam Okafor",
      email: "sam@grindcoffee.example",
      phone: "+1 503 555 0163",
      country: "United States",
      industry: "Café group · 3 sites, Portland",
      monthlyBudget: 850,
      status: "ACTIVE",
    },
    login: { name: "Sam Okafor", email: "sam@grindcoffee.example" },
  },
] as const;

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: "advertisex" } });
  if (!org) throw new Error("Run prisma/seed.ts first — the organization does not exist yet.");

  const deptBySlug = new Map(
    (await prisma.department.findMany({ select: { id: true, slug: true } })).map((d) => [d.slug, d.id]),
  );
  const need = (slug: string) => {
    const id = deptBySlug.get(slug);
    if (!id) throw new Error(`Run prisma/seed.ts first — department ${slug} is missing.`);
    return id;
  };

  const placeholderHash = await bcrypt.hash(PLACEHOLDER_PASSWORD, 10);
  const founder = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { in: ["FOUNDER", "ADMIN"] } },
    select: { id: true },
  });

  let created = 0;

  // --- the fifth employee --------------------------------------------------
  if (!(await prisma.user.findUnique({ where: { email: EMPLOYEE.email } }))) {
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: EMPLOYEE.name,
        email: EMPLOYEE.email,
        passwordHash: placeholderHash,
        role: "EMPLOYEE",
        jobTitle: EMPLOYEE.jobTitle,
        mustChangePassword: true,
        avatarColor: avatarColorFor(EMPLOYEE.name),
      },
    });
    for (const m of EMPLOYEE.departments) {
      await prisma.departmentMembership.create({
        data: {
          userId: user.id,
          departmentId: need(m.slug),
          roleInDept: m.roleInDept,
          skills: serializeSkills(m.skills),
        },
      });
    }
    created++;
  }

  // --- AI agents and their grants -------------------------------------------
  for (const agent of AGENTS) {
    let user = await prisma.user.findUnique({ where: { email: agent.email }, select: { id: true } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          organizationId: org.id,
          name: agent.name,
          email: agent.email,
          // Unusable by design: agents authenticate as services, never by password.
          passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
          role: "AI_AGENT",
          jobTitle: agent.jobTitle,
          avatarColor: avatarColorFor(agent.name),
        },
        select: { id: true },
      });
      created++;
    }
    // Phase 9: each agent's capability, its default limits, and exactly the
    // grants its tools need. Added to existing agents too; never overwritten.
    const cap = capability(agent.capability)!;
    if (!(await prisma.agentProfile.findUnique({ where: { userId: user.id } }))) {
      await prisma.agentProfile.create({ data: { userId: user.id, capability: cap.key, maxRunsPerHour: cap.defaults.maxRunsPerHour, monthlyBudgetMicros: cap.defaults.monthlyBudgetMicros } });
    }
    for (const [resource, action] of grantsFor(cap)) {
      if (await prisma.agentGrant.findFirst({ where: { agentId: user.id, resource, action } })) continue;
      await prisma.agentGrant.create({ data: { organizationId: org.id, agentId: user.id, resource, action, grantedById: founder?.id ?? null } });
    }
  }

  // --- Phase 9: default automations (created once, by name) ------------------
  const agentId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const RULES = [
    { name: "Qualify every new lead", trigger: "LEAD_CREATED", conditions: {}, action: "RUN_AGENT", actionConfig: { agentId: await agentId("sage.agent@advertisex.example") } },
    { name: "Draft each client's monthly report", trigger: "REPORT_DUE", conditions: {}, action: "RUN_AGENT", actionConfig: { agentId: await agentId("ledger.agent@advertisex.example") } },
    { name: "Tell the owner when a deal is won", trigger: "LEAD_STAGE_CHANGED", conditions: { toStageKind: ["WON"] }, action: "NOTIFY", actionConfig: { to: "owner", message: "A deal you own was won — time to plan the kick-off" } },
  ];
  for (const rule of RULES) {
    if (await prisma.automationRule.findFirst({ where: { organizationId: org.id, name: rule.name } })) continue;
    await prisma.automationRule.create({ data: { organizationId: org.id, name: rule.name, trigger: rule.trigger, conditions: JSON.stringify(rule.conditions), action: rule.action, actionConfig: JSON.stringify(rule.actionConfig), createdById: founder?.id ?? null } });
  }

  // --- restaurant clients: portal account, CRM record, one login ------------
  for (const r of RESTAURANTS) {
    if (await prisma.user.findUnique({ where: { email: r.login.email } })) continue;

    const account = await prisma.clientAccount.create({
      data: { organizationId: org.id, name: r.account },
    });
    const assignee = await prisma.user.findUnique({
      where: { email: r.assigneeEmail },
      select: { id: true },
    });
    await prisma.client.create({
      data: {
        organizationId: org.id,
        clientAccountId: account.id,
        departmentId: need(r.department),
        businessName: r.account,
        assigneeId: assignee?.id ?? null,
        ...r.crm,
      },
    });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        clientAccountId: account.id,
        name: r.login.name,
        email: r.login.email,
        passwordHash: placeholderHash,
        role: "CLIENT",
        clientRole: "OWNER",
        jobTitle: "Owner",
        mustChangePassword: true,
        avatarColor: avatarColorFor(r.login.name),
      },
    });
    created++;
  }

  // --- Phase 2: skills, schedules, tasks, attendance history ---------------
  await seedTeamOperatingSystem(org.id);

  // --- Phase 3: a living pipeline with its history and outreach ------------
  await seedPipeline(org.id);

  // --- Phase 4: what clients bought, their projects, contracts, vault -------
  await seedClientProjects(org.id);

  // --- Phase 6: what a client sees in the portal ----------------------------
  // Demo logins made before Phase 6 are their accounts' owners.
  await prisma.user.updateMany({ where: { organizationId: org.id, role: "CLIENT", clientRole: null }, data: { clientRole: "OWNER" } });
  await seedPortal(org.id);

  // --- Phase 7: invoices and payments ----------------------------------------
  await seedBilling(org.id);

  // --- Phase 8: client results (demo data, labelled as such) ------------------
  await seedResults(org.id);

  const roles = await prisma.user.groupBy({ by: ["role"], _count: true });
  console.log("Advertise X demo tenant");
  console.log(`  created   ${created} new record group(s)`);
  for (const row of roles.sort((a, b) => a.role.localeCompare(b.role))) {
    console.log(`  ${row.role.padEnd(14)} ${row._count}`);
  }
  console.log(`  client accounts ${await prisma.clientAccount.count()}`);
  console.log(`  agent grants    ${await prisma.agentGrant.count()}`);
}

/** Who knows what, at what proficiency (1–5). Agents hold skills too. */
const SKILL_MATRIX: Record<string, [string, number][]> = {
  "tayyaba@bwm.local": [["Google Ads", 4], ["Lead Generation", 4], ["Local SEO", 3], ["SEO", 2]],
  "claire@bwm.local": [["Meta Ads", 4], ["Social Media Marketing", 5], ["Automation", 2]],
  "cam@bwm.local": [["Creative Production", 5], ["Graphic Design", 4], ["Branding", 3], ["UI/UX", 4]],
  // Phase 5: the web lead also owns organic search, so "Website + Google Ads +
  // SEO" has real specialists to find.
  "cheryl@bwm.local": [["Websites", 4], ["UI/UX", 3], ["SEO", 4], ["CRM Implementation", 4], ["Google Business Profile", 4]],
  "maya@advertisex.example": [["Meta Ads", 5], ["Creative Production", 3], ["Social Media Marketing", 4]],
  "rajazain@bwm.local": [["Development", 5], ["Automation", 5], ["AI Automation", 4]],
  "atlas.agent@advertisex.example": [["Lead Generation", 4]],
  "quill.agent@advertisex.example": [["Creative Production", 3]],
  "pulse.agent@advertisex.example": [["Google Ads", 3], ["Meta Ads", 3]],
};

/** Everyone is on the default schedule except Maya, who works remotely from London. */
const SCHEDULES: Record<string, { timezone: string; workDays: string; startMinute: number; endMinute: number }> = {
  "maya@advertisex.example": { timezone: "Europe/London", workDays: "1,2,3,4,5", startMinute: 8 * 60, endMinute: 16 * 60 },
};

const DEMO_TASK = "·"; // marker suffix on demo task titles, so a re-run can tell they exist

async function seedTeamOperatingSystem(organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, email: true, role: true, departments: { select: { departmentId: true } } },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const skills = new Map(
    (await prisma.skill.findMany({ where: { organizationId } })).map((sk) => [sk.name, sk.id]),
  );

  for (const [email, held] of Object.entries(SKILL_MATRIX)) {
    const user = byEmail.get(email);
    if (!user) continue;
    for (const [name, proficiency] of held) {
      const skillId = skills.get(name);
      if (!skillId) continue;
      await prisma.userSkill.upsert({
        where: { userId_skillId: { userId: user.id, skillId } },
        update: {},
        create: { userId: user.id, skillId, proficiency },
      });
    }
  }

  const tz = "America/New_York";
  for (const user of users) {
    if (user.role === "AI_AGENT" || user.role === "CLIENT") continue;
    const custom = SCHEDULES[user.email];
    await prisma.workSchedule.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, timezone: custom?.timezone ?? tz, workDays: custom?.workDays ?? "1,2,3,4,5", startMinute: custom?.startMinute ?? 540, endMinute: custom?.endMinute ?? 1020 },
    });
  }

  // Tasks across every status, with real deadlines — only on a first run.
  const already = await prisma.task.count({ where: { title: { endsWith: DEMO_TASK }, department: { organizationId } } });
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
    return d;
  };
  if (already === 0) {
    const plan: [string, string, string, number, string, number | null][] = [
      // email, title, status, due offset (days), priority, completed offset
      ["tayyaba@bwm.local", "Rebuild Osteria Nonna's brunch campaign", "IN_PROGRESS", 2, "HIGH", null],
      ["tayyaba@bwm.local", "Negative keyword sweep — Bao Society", "NOT_STARTED", 5, "MEDIUM", null],
      ["tayyaba@bwm.local", "Weekly ROAS check-in notes", "COMPLETED", -3, "LOW", -4],
      ["claire@bwm.local", "Draft the Appetite Audit deck for Grind Coffee", "REVIEW", 1, "HIGH", null],
      ["claire@bwm.local", "Instagram Reels calendar — October", "IN_PROGRESS", -1, "MEDIUM", null],
      ["cam@bwm.local", "Shoot list for the autumn menu", "NOT_STARTED", 6, "MEDIUM", null],
      ["cam@bwm.local", "Retouch hero dishes for Osteria Nonna", "COMPLETED", -2, "HIGH", -1],
      ["cheryl@bwm.local", "Set up SMS win-back flow", "IN_PROGRESS", 3, "HIGH", null],
      ["cheryl@bwm.local", "Claim and verify Google Business listing", "COMPLETED", -5, "MEDIUM", -6],
      ["maya@advertisex.example", "Launch Meta test: 3 creatives × 2 audiences", "IN_PROGRESS", 0, "HIGH", null],
      ["maya@advertisex.example", "UGC brief for Bao Society", "NOT_STARTED", 4, "LOW", null],
      ["atlas.agent@advertisex.example", "Compile 40 Brooklyn restaurant leads", "IN_PROGRESS", 2, "MEDIUM", null],
      ["pulse.agent@advertisex.example", "Flag campaigns with ROAS below 2.0", "COMPLETED", -1, "MEDIUM", -1],
    ];
    const founder = users.find((u) => u.role === "ADMIN" || u.role === "FOUNDER");
    for (const [email, title, status, due, priority, done] of plan) {
      const user = byEmail.get(email);
      const departmentId = user?.departments[0]?.departmentId ?? (await prisma.department.findFirst({ where: { organizationId } }))?.id;
      if (!user || !departmentId) continue;
      const task = await prisma.task.create({
        data: {
          departmentId,
          title: `${title} ${DEMO_TASK}`,
          assigneeId: user.id,
          createdById: founder?.id ?? user.id,
          status,
          priority,
          dueAt: day(due),
          completedAt: done === null ? null : new Date(day(done).getTime() + 15 * 3600_000),
        },
      });
      if (status !== "NOT_STARTED") {
        await prisma.taskChecklistItem.createMany({
          data: [
            { taskId: task.id, label: "Confirm the brief", done: true, order: 0 },
            { taskId: task.id, label: "Do the work", done: status === "COMPLETED" || status === "REVIEW", order: 1 },
            { taskId: task.id, label: "Hand over for review", done: status === "COMPLETED", order: 2 },
          ],
        });
      }
    }
  }

  // Four weeks of attendance for the humans, with the ordinary mess of
  // real life — a late morning, an early finish, an absence — on a first run.
  const humans = users.filter((u) => u.role !== "AI_AGENT" && u.role !== "CLIENT");
  for (const [index, user] of humans.entries()) {
    if ((await prisma.attendanceDay.count({ where: { userId: user.id } })) > 0) continue;
    const schedule = await prisma.workSchedule.findUnique({ where: { userId: user.id } });
    const offsetHours = schedule?.timezone === "Europe/London" ? 1 : -4; // BST / EDT in September
    const start = (schedule?.startMinute ?? 540) / 60;
    let worked = 0;
    // Every working day of the last four weeks, so the month's summary
    // reflects a realistic record rather than a gap that reads as absence.
    for (let back = 1; back <= 28; back++) {
      const d = day(-back);
      const weekday = d.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      worked++;
      const variant = (index + worked) % 7;
      if (variant === 6) continue; // absent
      const lateBy = variant === 2 ? 25 : variant === 4 ? 4 : 0; // 4 = within grace
      const earlyBy = variant === 5 ? 50 : 0;
      const at = (hour: number, minute = 0) => new Date(d.getTime() + ((hour - offsetHours) * 60 + minute) * 60_000);
      const date = d;
      const dayRow = await prisma.attendanceDay.create({
        data: { userId: user.id, date, clockInAt: at(start, lateBy), clockOutAt: at(start + 8, -earlyBy) },
      });
      await prisma.breakSession.create({
        data: { userId: user.id, date: dayRow.date, reason: "Lunch", startedAt: at(start + 3, 30), endedAt: at(start + 4, 5), minutes: 35 },
      });
    }
  }
}

/**
 * Forty-eight restaurant leads with ten weeks of history: each walks the
 * standard pipeline some way, with the outreach its owner logged along the
 * way, so the board, the funnel, stage velocity and outreach rollups all have
 * real movement to show. Deterministic (a seeded generator), so every reset
 * produces the same pipeline. Only on an organization with no leads yet.
 */
const RESTAURANT_NAMES = [
  "Trattoria Sole", "Pho Real", "The Salted Pig", "Nonna's Kitchen", "Blue Plate Diner", "Taqueria El Sol",
  "Sakura House", "Brick Oven Co.", "The Green Fork", "Masala Street", "Harbor Fish Bar", "Le Petit Café",
  "Smoke & Barrel BBQ", "Golden Wok", "Olive & Vine", "Crumb Bakery", "The Daily Grind", "Seoul Food",
  "Mezze Mediterranean", "Burger Lab", "Ramen Ya", "Casa Luna", "The Local Tap", "Sweet Crumbs",
  "Pizzeria Napoli", "Curry Leaf", "The Hungry Fox", "Bistro 21", "Dough Bros", "Tandoor Nights",
  "The Poke Stop", "Farmhouse Table", "Café Colette", "Wok This Way", "El Fuego Grill", "Bagel Society",
  "The Dumpling Den", "Soul Kitchen", "Verde Taqueria", "The Oyster Room", "Kebab Palace", "Honey & Rye",
  "Noodle Theory", "The Brunch Club", "Pasta Fresca", "Spice Route", "Waffle House Co.", "The Corner Deli",
];
const CITIES = ["Brooklyn, NY", "Austin, TX", "Portland, OR", "Chicago, IL", "Miami, FL", "Denver, CO", "Queens, NY", "Seattle, WA"];
const SEGMENTS = ["Restaurant", "Fast casual", "Café", "Bar & pub", "Bakery", "Quick service", "Fine dining", "Ghost kitchen"];
const SOURCES = ["OUTREACH", "OUTREACH", "REFERRAL", "INBOUND", "SOCIAL", "WEBSITE", "PAID_ADS", "EVENT"];
const TAGS = ["brunch", "multi-site", "delivery", "catering", "new-opening", "franchise"];
const FLOW = ["NEW_LEAD", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "NEGOTIATION", "WON"];
const OUTREACH_FOR: Record<string, string[]> = {
  NEW_LEAD: ["COLD_CALL"],
  CONTACTED: ["EMAIL_SENT", "EMAIL_REPLY"],
  QUALIFIED: ["FOLLOW_UP", "MEETING_BOOKED"],
  MEETING: ["MEETING_HELD"],
  PROPOSAL: ["PROPOSAL_SENT"],
  NEGOTIATION: ["FOLLOW_UP"],
};

function prng(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

async function seedPipeline(organizationId: string) {
  if ((await prisma.lead.count({ where: { department: { organizationId } } })) > 0) return;

  const rand = prng(20260926);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const departments = await prisma.department.findMany({
    where: { organizationId, stages: { some: { key: "NEW_LEAD" } } },
    select: { id: true, memberships: { select: { userId: true, user: { select: { role: true } } } } },
  });
  if (departments.length === 0) return;

  const now = Date.now();
  const DAY = 86_400_000;

  for (const [i, name] of RESTAURANT_NAMES.entries()) {
    const dept = departments[i % departments.length];
    const owners = dept.memberships.filter((m) => m.user.role !== "AI_AGENT").map((m) => m.userId);
    const ownerId = owners.length ? pick(owners) : null;
    if (!ownerId) continue;

    const createdAt = new Date(now - Math.floor(5 + rand() * 65) * DAY);
    // How far this lead gets: most stay early, some win, some are lost.
    const reach = Math.min(FLOW.length - 1, Math.floor(rand() * rand() * FLOW.length * 1.6));
    const lost = reach < FLOW.length - 1 && rand() < 0.18;
    const path = FLOW.slice(0, reach + 1);
    const stage = lost ? "LOST" : path[path.length - 1];
    const span = now - createdAt.getTime();
    const stepAt = (n: number, of: number) => new Date(createdAt.getTime() + Math.floor((span * 0.85 * n) / Math.max(1, of)));
    const moves = lost ? path.length : path.length - 1;
    const lastMove = moves === 0 ? createdAt : stepAt(moves, moves);
    const won = stage === "WON";
    const email = `hello@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`;

    const lead = await prisma.lead.create({
      data: {
        departmentId: dept.id,
        businessName: name,
        contactName: pick(["Alex Rivera", "Priya Shah", "Marco Rossi", "Kim Nguyen", "Dana Brooks", "Luis Ortega", "Hannah Lee", "Sam Patel"]),
        email,
        phone: `+1 555 01${String(10 + i).padStart(2, "0")}`,
        website: `${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
        location: pick(CITIES),
        country: "United States",
        industry: pick(SEGMENTS),
        source: pick(SOURCES),
        tags: [pick(TAGS), ...(rand() < 0.4 ? [pick(TAGS)] : [])].join(","),
        dealValue: Math.round((1 + rand() * 11) * 500),
        // Distinct, non-round figures: the leak scan looks for these exact numbers,
        // and a round or three-digit value collides with ordinary page text.
        estimatedMonthlyValue: 1_117 + i * 41,
        ownerId,
        createdById: ownerId,
        stage,
        stageChangedAt: lastMove,
        createdAt,
        convertedAt: won ? lastMove : null,
        lostReason: lost ? pick(["PRICE", "TIMING", "WENT_ELSEWHERE", "NO_RESPONSE"]) : null,
        nextFollowUpAt: !won && !lost && rand() < 0.5 ? new Date(now + Math.floor(rand() * 10 - 4) * DAY) : null,
      },
    });

    // The stage history, and the outreach logged in each stage.
    await prisma.leadStageEvent.create({ data: { leadId: lead.id, departmentId: dept.id, fromStage: null, toStage: "NEW_LEAD", userId: ownerId, at: createdAt } });
    for (let n = 1; n <= moves; n++) {
      const to = lost && n === moves ? "LOST" : path[n];
      await prisma.leadStageEvent.create({ data: { leadId: lead.id, departmentId: dept.id, fromStage: path[n - 1], toStage: to, userId: ownerId, at: stepAt(n, moves) } });
    }
    for (let n = 0; n < path.length; n++) {
      for (const type of OUTREACH_FOR[path[n]] ?? []) {
        const at = new Date(Math.min(now - 3_600_000, stepAt(n, Math.max(1, moves)).getTime() + Math.floor(rand() * DAY)));
        await prisma.salesActivity.create({
          data: { departmentId: dept.id, leadId: lead.id, userId: ownerId, type, note: `${type.replace(/_/g, " ").toLowerCase()} — ${name}`, occurredAt: at },
        });
      }
    }
    if (won) {
      await prisma.salesActivity.create({
        data: { departmentId: dept.id, leadId: lead.id, userId: ownerId, type: "DEAL_CLOSED", isSystem: true, note: `Won ${name}`, occurredAt: lastMove },
      });
    }
  }
}

const DAY_MS = 86_400_000;
/** UTC midnight, `n` days from today — date-only values are stored that way. */
const dayFromToday = (n: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + n * DAY_MS);
};

type DemoProject = {
  title: string;
  services: string[];
  start: number;
  deadline: number;
  status: "PLANNING" | "ACTIVE" | "COMPLETED";
  priority?: string;
  /** Stages done per service line, in order. */
  stagesDone: number[];
  milestones: { title: string; weight: number; due: number; done: boolean; stage?: number; line?: number }[];
  tasks: { title: string; due: number; done: boolean }[];
  team: string[];
};

type DemoClient = {
  account: string;
  owner: string;
  services: [slug: string, price: number][];
  projects: DemoProject[];
  contract: { title: string; status: string; start: number; end: number; value: number };
  credentials: { label: string; kind: string; url: string; username: string; secret: string }[];
  note: string;
};

const CLIENT_PROJECTS: DemoClient[] = [
  {
    account: "Osteria Nonna",
    owner: "tayyaba@bwm.local",
    services: [["website-development", 4500], ["google-ads", 1500], ["local-seo", 800]],
    projects: [
      {
        title: "Website relaunch",
        services: ["website-development"],
        start: -40,
        deadline: 20,
        status: "ACTIVE",
        priority: "HIGH",
        stagesDone: [2],
        milestones: [
          { title: "Sitemap and content plan", weight: 2, due: -30, done: true, stage: 0 },
          { title: "Homepage design approved", weight: 3, due: -12, done: true, stage: 1 },
          { title: "Menu and booking pages built", weight: 3, due: 5, done: false, stage: 2 },
          { title: "Launch checklist signed off", weight: 2, due: 18, done: false, stage: 4 },
        ],
        tasks: [
          { title: "Collect new menu photos", due: -20, done: true },
          { title: "Connect OpenTable widget", due: 4, done: false },
          { title: "Write allergen page copy", due: 8, done: false },
        ],
        team: ["tayyaba@bwm.local", "cheryl@bwm.local", "rajazain@bwm.local"],
      },
      {
        title: "Always-on search",
        services: ["google-ads", "local-seo"],
        start: -60,
        deadline: 120,
        status: "ACTIVE",
        stagesDone: [3, 2],
        milestones: [
          { title: "Search campaigns live", weight: 3, due: -45, done: true, line: 0, stage: 2 },
          { title: "Map pack in top 3 for 'italian near me'", weight: 4, due: 60, done: false, line: 1, stage: 3 },
        ],
        tasks: [{ title: "Monthly search terms review", due: 10, done: false }],
        team: ["tayyaba@bwm.local", "pulse.agent@advertisex.example"],
      },
    ],
    contract: { title: "Website and search retainer", status: "ACTIVE", start: -60, end: 305, value: 31800 },
    credentials: [
      { label: "WordPress admin", kind: "WEBSITE", url: "https://osterianonna.example/wp-admin", username: "owner@osterianonna.example", secret: "Nonna-Demo-2026!" },
      { label: "Google Ads", kind: "GOOGLE", url: "https://ads.google.com", username: "ads@osterianonna.example", secret: "demo-google-7731" },
    ],
    note: "Chef Marco approves every photo of the food himself — send drafts to him, not the front of house.",
  },
  {
    account: "Bao Society",
    owner: "claire@bwm.local",
    services: [["social-media-marketing", 1800], ["meta-ads", 1500]],
    projects: [
      {
        title: "Instagram launch",
        services: ["social-media-marketing"],
        start: -50,
        deadline: -5,
        status: "ACTIVE",
        priority: "URGENT",
        stagesDone: [1],
        milestones: [
          { title: "Brand voice guide", weight: 2, due: -40, done: true, stage: 0 },
          { title: "30-day content calendar", weight: 3, due: -20, done: false, stage: 1 },
          { title: "First 12 posts produced", weight: 4, due: -8, done: false, stage: 2 },
        ],
        tasks: [
          { title: "Book the dumpling shoot", due: -15, done: false },
          { title: "Draft launch captions", due: -10, done: true },
        ],
        team: ["claire@bwm.local", "maya@advertisex.example", "quill.agent@advertisex.example"],
      },
    ],
    contract: { title: "Social retainer", status: "ACTIVE", start: -70, end: 20, value: 9900 },
    credentials: [{ label: "Instagram", kind: "SOCIAL", url: "https://instagram.com/baosociety", username: "baosociety", secret: "bao-demo-5582" }],
    note: "Never post before 11am — the owners run the morning shift and want to see comments as they come in.",
  },
  {
    account: "Grind Coffee Co.",
    owner: "cheryl@bwm.local",
    services: [["branding", 6000], ["google-business-profile", 600], ["ai-automation", 3500]],
    projects: [
      {
        title: "Brand refresh",
        services: ["branding"],
        start: -120,
        deadline: -30,
        status: "COMPLETED",
        stagesDone: [5],
        milestones: [
          { title: "Logo concepts", weight: 3, due: -95, done: true, stage: 1 },
          { title: "Brand guidelines delivered", weight: 4, due: -32, done: true, stage: 3 },
        ],
        tasks: [],
        team: ["cam@bwm.local", "cheryl@bwm.local"],
      },
      {
        title: "Booking and reply automation",
        services: ["ai-automation"],
        start: 7,
        deadline: 60,
        status: "PLANNING",
        stagesDone: [0],
        milestones: [{ title: "Automation map agreed", weight: 2, due: 14, done: false, stage: 0 }],
        tasks: [],
        team: ["rajazain@bwm.local", "cheryl@bwm.local"],
      },
    ],
    contract: { title: "Brand and automation", status: "SIGNED", start: -125, end: 240, value: 10100 },
    credentials: [{ label: "Google Business Profile", kind: "GOOGLE", url: "https://business.google.com", username: "hello@grindcoffee.example", secret: "grind-demo-9914" }],
    note: "Three locations — every change to hours must go on all three profiles the same day.",
  },
];

/**
 * Phase 4 demo data: services bought (with prices), projects planned from the
 * catalog's stage templates at different points in their life (on track,
 * delayed, completed, not started), contracts, sealed credentials and pinned
 * notes. Converges: a client that already has purchases is left alone.
 */
async function seedClientProjects(organizationId: string) {
  const services = await prisma.serviceCatalog.findMany({
    where: { organizationId },
    select: { id: true, slug: true, billing: true, stageTemplates: { select: { name: true, order: true }, orderBy: { order: "asc" } }, skills: { select: { skillId: true } } },
  });
  const bySlug = new Map(services.map((x) => [x.slug, x]));
  const userId = async (email: string) => (await prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? null;
  const { keys } = vaultKeys();

  for (const demo of CLIENT_PROJECTS) {
    const client = await prisma.client.findFirst({ where: { organizationId, businessName: demo.account }, select: { id: true, departmentId: true } });
    if (!client || (await prisma.clientService.count({ where: { clientId: client.id } }))) continue;
    const owner = await userId(demo.owner);

    for (const [slug, price] of demo.services) {
      const svc = bySlug.get(slug);
      if (!svc) continue;
      await prisma.clientService.create({ data: { organizationId, clientId: client.id, serviceId: svc.id, price, billing: svc.billing, startDate: dayFromToday(-60) } });
    }

    for (const p of demo.projects) {
      const lines = p.services.map((slug) => bySlug.get(slug)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      const project = await prisma.project.create({
        data: {
          organizationId,
          clientId: client.id,
          title: p.title,
          startDate: dayFromToday(p.start),
          endDate: dayFromToday(p.deadline),
          status: p.status,
          priority: p.priority ?? "MEDIUM",
          ownerId: owner,
          completedAt: p.status === "COMPLETED" ? dayFromToday(p.deadline - 2) : null,
          services: { create: lines.map((l) => ({ serviceId: l.id })) },
        },
      });
      const stageIds: string[][] = [];
      for (const [li, line] of lines.entries()) {
        const done = p.stagesDone[li] ?? 0;
        const ids: string[] = [];
        for (const t of line.stageTemplates) {
          const status = t.order < done ? "DONE" : t.order === done ? "ACTIVE" : "PENDING";
          const stage = await prisma.projectStage.create({
            data: {
              projectId: project.id,
              serviceId: line.id,
              name: t.name,
              order: t.order,
              status,
              startedAt: status === "PENDING" ? null : dayFromToday(p.start + t.order * 7),
              completedAt: status === "DONE" ? dayFromToday(p.start + (t.order + 1) * 7) : null,
            },
          });
          ids.push(stage.id);
        }
        stageIds.push(ids);
      }
      const skillIds = [...new Set(lines.flatMap((l) => l.skills.map((k) => k.skillId)))];
      if (skillIds.length) await prisma.projectSkill.createMany({ data: skillIds.map((skillId) => ({ projectId: project.id, skillId, source: "DERIVED" })) });

      const team = (await Promise.all(p.team.map(userId))).filter((x): x is string => Boolean(x));
      for (const member of new Set([...(owner ? [owner] : []), ...team])) {
        await prisma.projectMember.create({ data: { projectId: project.id, userId: member, role: member === owner ? "LEAD" : "MEMBER" } });
      }
      for (const [i, m] of p.milestones.entries()) {
        await prisma.projectMilestone.create({
          data: {
            projectId: project.id,
            stageId: m.stage !== undefined ? stageIds[m.line ?? 0]?.[m.stage] ?? null : null,
            title: m.title,
            weight: m.weight,
            dueDate: dayFromToday(m.due),
            status: m.done ? "DONE" : "OPEN",
            completedAt: m.done ? dayFromToday(m.due - 1) : null,
            assigneeId: team[i % Math.max(1, team.length)] ?? owner,
            order: i,
          },
        });
      }
      for (const [i, t] of p.tasks.entries()) {
        await prisma.task.create({
          data: {
            departmentId: client.departmentId,
            clientId: client.id,
            projectId: project.id,
            title: t.title,
            dueAt: dayFromToday(t.due),
            status: t.done ? "COMPLETED" : i % 2 ? "IN_PROGRESS" : "NOT_STARTED",
            completedAt: t.done ? dayFromToday(t.due - 1) : null,
            assigneeId: team[i % Math.max(1, team.length)] ?? owner,
            createdById: owner,
          },
        });
      }
    }

    await prisma.contract.create({
      data: {
        organizationId,
        clientId: client.id,
        title: demo.contract.title,
        status: demo.contract.status,
        startDate: dayFromToday(demo.contract.start),
        endDate: dayFromToday(demo.contract.end),
        signedAt: dayFromToday(demo.contract.start - 3),
        value: demo.contract.value,
      },
    });
    for (const c of demo.credentials) {
      const id = randomBytes(12).toString("hex");
      await prisma.clientCredential.create({
        data: { id, organizationId, clientId: client.id, label: c.label, kind: c.kind, url: c.url, username: c.username, secret: seal(c.secret, keys[0], id), createdById: owner },
      });
    }
    await prisma.clientNote.create({ data: { organizationId, clientId: client.id, authorId: owner, body: demo.note, pinned: true } });
  }
}

/** A one-page PDF, so the demo report opens in a browser. */
function demoPdf(title: string): Buffer {
  const text = title.replace(/[()\\]/g, "");
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/**
 * Phase 6 demo: for Osteria Nonna — a conversation with the team, a private
 * note to the founders, a shared update and an internal one on the website
 * project, and a published monthly report. Converges: skipped once the
 * client has any message.
 */
async function seedPortal(organizationId: string) {
  const client = await prisma.client.findFirst({ where: { organizationId, businessName: "Osteria Nonna" }, select: { id: true, clientAccountId: true } });
  if (!client?.clientAccountId) return;
  if (await prisma.message.count({ where: { thread: { clientId: client.id } } })) return;

  const [owner, tayyaba, founder] = await Promise.all([
    prisma.user.findFirst({ where: { clientAccountId: client.clientAccountId, role: "CLIENT" }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: "tayyaba@bwm.local" }, select: { id: true } }),
    prisma.user.findFirst({ where: { organizationId, role: { in: ["FOUNDER", "ADMIN"] } }, select: { id: true } }),
  ]);
  if (!owner || !tayyaba || !founder) return;

  const team = await prisma.messageThread.create({ data: { organizationId, clientId: client.id, kind: "TEAM", subject: "Your team" } });
  const privateThread = await prisma.messageThread.create({ data: { organizationId, clientId: client.id, kind: "FOUNDER", subject: "Private — founders" } });
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000);
  const talk: [string, string, string, number][] = [
    [team.id, owner.id, "Hi team — can we make sure the new site has our Sunday brunch menu? It's our busiest service.", 50],
    [team.id, tayyaba.id, "Absolutely, Marco. We'll add a brunch page and put it in the main menu. I'll share the design this week.", 48],
    [team.id, owner.id, "Perfect, thank you!", 47],
    [privateThread.id, owner.id, "Quick one for the founders: we're thinking about a second location next spring. Worth a chat about the plan?", 30],
    [privateThread.id, founder.id, "Congratulations — yes, let's talk. I'll send some times for next week.", 26],
  ];
  for (const [threadId, authorId, body, hours] of talk) {
    await prisma.message.create({ data: { threadId, authorId, body, createdAt: at(hours) } });
    await prisma.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: at(hours) } });
  }
  await prisma.threadRead.createMany({
    data: [
      { threadId: team.id, userId: owner.id, lastReadAt: at(46) },
      { threadId: team.id, userId: tayyaba.id, lastReadAt: at(46) },
      { threadId: privateThread.id, userId: founder.id, lastReadAt: at(26) },
      { threadId: privateThread.id, userId: owner.id, lastReadAt: at(25) },
    ],
  });

  const project = await prisma.project.findFirst({ where: { clientId: client.id, title: "Website relaunch" }, select: { id: true } });
  if (project) {
    await prisma.projectUpdate.create({
      data: { projectId: project.id, authorId: tayyaba.id, visibility: "CLIENT", title: "Your homepage design is approved", body: "Thanks for the quick feedback. We're now building the menu and booking pages — you'll see them next week.", createdAt: at(72) },
    });
    await prisma.projectUpdate.create({
      data: { projectId: project.id, authorId: tayyaba.id, visibility: "INTERNAL", title: "Internal: booking widget risk", body: "OpenTable API keys still pending from the client's old agency — chase before Friday.", createdAt: at(20) },
    });
  }

  // A published report, stored the way uploads are (a generated name under uploads/).
  const { mkdir, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "uploads");
  await mkdir(dir, { recursive: true });
  const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15));
  const periodMonth = month.toISOString().slice(0, 7);
  const label = month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const pdf = demoPdf(`Osteria Nonna - Monthly Report - ${label}`);
  const storedName = `${randomBytes(16).toString("hex")}.pdf`;
  await writeFile(path.join(dir, storedName), pdf);
  const file = await prisma.file.create({
    data: { organizationId, uploaderId: tayyaba.id, clientId: client.id, filename: `Monthly report ${label}.pdf`, storedName, mimeType: "application/pdf", size: pdf.length, visibility: "CLIENT" },
  });
  await prisma.clientReport.create({
    data: { organizationId, clientId: client.id, title: `Monthly Report — ${label}`, kind: "MONTHLY", periodMonth, fileId: file.id, status: "PUBLISHED", publishedAt: at(10), createdById: tayyaba.id },
  });
}

/**
 * Phase 7 demo: six months of invoices for the three restaurants, built the
 * way the product builds them (integer cents, sequential numbers, paid
 * totals equal to the payments, statuses from the same rule). One is part
 * paid, one overdue, one void, one a draft. Converges: skipped once the
 * organization has any invoice.
 */
async function seedBilling(organizationId: string) {
  if (await prisma.invoice.count({ where: { organizationId } })) return;
  const founder = await prisma.user.findFirst({ where: { organizationId, role: { in: ["FOUNDER", "ADMIN"] } }, select: { id: true } });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!org.billingAddress) {
    await prisma.organization.update({ where: { id: organizationId }, data: { billingAddress: "221 Madison Avenue, Suite 4\nNew York, NY 10016", billingEmail: "billing@advertisex.example" } });
  }
  const today = dayKey(new Date(), COMPANY_TIMEZONE);
  const date = (monthsAgo: number, day: number) => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - monthsAgo);
    d.setUTCDate(day);
    return d;
  };
  const key = (d: Date) => d.toISOString().slice(0, 10);
  // Osteria: paid up, this month's half paid (not yet due). Bao: last month's
  // unpaid (overdue), and one voided. Grind: paid up, this month's a draft.
  const plan: Record<string, { last: "PAID" | "UNPAID"; current: { status: "SENT" | "DRAFT"; pay: "PARTIAL" | "UNPAID" } | null; voidMonth?: number }> = {
    "Osteria Nonna": { last: "PAID", current: { status: "SENT", pay: "PARTIAL" } },
    "Bao Society": { last: "UNPAID", current: null, voidMonth: 3 },
    "Grind Coffee Co.": { last: "PAID", current: { status: "DRAFT", pay: "UNPAID" } },
  };
  const recent = new Date(`${today}T00:00:00Z`);
  recent.setUTCDate(recent.getUTCDate() - 3);

  type Draft = { clientId: string; projectId: string | null; issue: Date | null; lines: { serviceId: string; description: string; rateMinor: number }[]; pay: "PAID" | "PARTIAL" | "UNPAID"; status: "SENT" | "DRAFT" | "VOID" };
  const drafts: Draft[] = [];
  for (const [name, p] of Object.entries(plan)) {
    const client = await prisma.client.findFirst({ where: { organizationId, businessName: name }, select: { id: true } });
    if (!client) continue;
    const services = await prisma.clientService.findMany({ where: { clientId: client.id, status: "ACTIVE" }, include: { service: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
    if (services.length === 0) continue;
    const project = await prisma.project.findFirst({ where: { clientId: client.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    for (let ago = 5; ago >= 0; ago--) {
      const month = date(ago, 1);
      const label = month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      const lines = services.flatMap((s) => {
        const rateMinor = s.price * 100;
        if (s.billing === "MONTHLY") return [{ serviceId: s.service.id, description: `${s.service.name} — ${label}`, rateMinor }];
        if (s.billing === "QUARTERLY" && ago % 3 === 2) return [{ serviceId: s.service.id, description: `${s.service.name} — quarter from ${label}`, rateMinor }];
        if ((s.billing === "ONE_TIME" || s.billing === "YEARLY") && ago === 5) return [{ serviceId: s.service.id, description: s.service.name, rateMinor }];
        return [];
      });
      if (lines.length === 0) continue;
      if (ago === 0) {
        if (!p.current) continue;
        drafts.push({ clientId: client.id, projectId: project?.id ?? null, issue: p.current.status === "DRAFT" ? null : recent, lines, pay: p.current.pay, status: p.current.status });
      } else {
        drafts.push({ clientId: client.id, projectId: project?.id ?? null, issue: month, lines, pay: ago === 1 ? p.last : "PAID", status: p.voidMonth === ago ? "VOID" : "SENT" });
      }
    }
  }

  drafts.sort((a, b) => (a.issue?.getTime() ?? Infinity) - (b.issue?.getTime() ?? Infinity));
  let number = org.nextInvoiceNumber;
  for (const d of drafts) {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: d.clientId }, select: { businessName: true, email: true, contactName: true, location: true } });
    const totalMinor = d.lines.reduce((sum, l) => sum + l.rateMinor, 0);
    const issued = d.status !== "DRAFT" && d.issue;
    const due = new Date((d.issue ?? recent).getTime() + org.paymentTermsDays * 86_400_000);
    const paidMinor = d.status === "VOID" ? 0 : d.pay === "PAID" ? totalMinor : d.pay === "PARTIAL" ? Math.floor(totalMinor / 2) : 0;
    const status = d.status === "SENT" ? deriveStatus({ status: "SENT", totalMinor, paidMinor, dueKey: key(due) }, today) : d.status;
    // Paid a few days before it was due — and never in the future.
    const paidAt = new Date(Math.min(due.getTime() - 4 * 86_400_000, Date.now() - 86_400_000));
    const inv = await prisma.invoice.create({
      data: {
        organizationId,
        clientId: d.clientId,
        projectId: d.projectId,
        currency: org.currency,
        status,
        ...(issued
          ? { number, numberLabel: numberLabel(org.invoicePrefix, number), issueDate: d.issue, sentAt: d.issue, billToName: client.businessName, billToEmail: client.email, billToAddress: [client.contactName, client.location].filter(Boolean).join("\n") || null }
          : {}),
        dueDate: due,
        notes: "Bank transfer to Advertise X LLC. Please quote the invoice number.",
        subtotalMinor: totalMinor,
        totalMinor,
        paidMinor,
        paidAt: status === "PAID" ? paidAt : null,
        voidedAt: status === "VOID" ? d.issue : null,
        voidReason: status === "VOID" ? "Issued twice by mistake — replaced by the next invoice" : null,
        overdueNotifiedAt: status === "OVERDUE" ? new Date() : null,
        createdById: founder?.id ?? null,
        lines: { create: d.lines.map((l, position) => ({ ...l, quantityMilli: 1000, amountMinor: l.rateMinor, position })) },
      },
    });
    if (issued) number += 1;
    if (paidMinor > 0) {
      await prisma.payment.create({
        data: { organizationId, invoiceId: inv.id, amountMinor: paidMinor, currency: org.currency, method: "BANK_TRANSFER", paidAt, reference: `WIRE-${inv.numberLabel?.slice(-4) ?? "0000"}`, idempotencyKey: `seed:${inv.id}`, recordedById: founder?.id ?? null },
      });
    }
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { nextInvoiceNumber: number } });
}

/**
 * Phase 8 demo: six months of results for each restaurant's channels, from
 * the deterministic mock adapter. Stored with source MOCK, so every screen and
 * report says "demo data". Converges: skipped once any result exists.
 */
async function seedResults(organizationId: string) {
  if (await prisma.metricValue.count({ where: { organizationId } })) return;
  const today = dayKey(new Date(), COMPANY_TIMEZONE);
  const months: string[] = [previousMonth(today.slice(0, 7))];
  while (months.length < 6) months.unshift(previousMonth(months[0]));
  const clients = await prisma.client.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { id: true, services: { where: { status: { not: "ENDED" } }, select: { service: { select: { slug: true } } } } },
  });
  for (const c of clients) {
    const channels = channelsForServices(c.services.map((s) => s.service.slug));
    if (channels.length === 0) continue;
    for (const month of months) {
      for (const channel of channels) {
        for (const v of mockMonth(c.id, channel, month)) {
          await prisma.metricValue.create({ data: { organizationId, clientId: c.id, source: "MOCK", metricKey: v.metricKey, granularity: "MONTH", periodStart: new Date(`${month}-01T00:00:00.000Z`), value: v.value, syncedAt: new Date() } });
        }
      }
    }
    const providers = [...new Set(channels.map((ch) => CHANNEL[ch].provider).filter((p): p is NonNullable<typeof p> => Boolean(p)))];
    for (const provider of providers) {
      await prisma.integrationConnection.create({ data: { organizationId, clientId: c.id, provider, status: "MOCK", lastSyncedAt: new Date() } });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
