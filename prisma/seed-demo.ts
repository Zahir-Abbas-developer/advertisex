import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

import { avatarColorFor } from "../lib/constants";
import { serializeSkills } from "../lib/skills";

/**
 * The Phase 1 demo tenant (docs/PHASES.md, scope 11): one organization with a
 * founder, a manager, five employees, five AI agents and three restaurant
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
  {
    name: "Atlas",
    email: "atlas.agent@advertisex.example",
    jobTitle: "Lead Research Agent",
    grants: [["lead", "read"], ["lead", "create"]],
  },
  {
    name: "Quill",
    email: "quill.agent@advertisex.example",
    jobTitle: "Copywriting Agent",
    grants: [["task", "read"]],
  },
  {
    name: "Lens",
    email: "lens.agent@advertisex.example",
    jobTitle: "Creative QA Agent",
    grants: [["task", "read"], ["activity", "read"]],
  },
  {
    name: "Pulse",
    email: "pulse.agent@advertisex.example",
    jobTitle: "Campaign Monitor Agent",
    grants: [["client", "read"]],
  },
  {
    name: "Ledger",
    email: "ledger.agent@advertisex.example",
    jobTitle: "Reporting Agent",
    grants: [["client", "read"], ["lead", "read"]],
  },
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
    if (await prisma.user.findUnique({ where: { email: agent.email } })) continue;
    const user = await prisma.user.create({
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
    });
    for (const [resource, action] of agent.grants) {
      await prisma.agentGrant.create({
        data: { organizationId: org.id, agentId: user.id, resource, action, grantedById: founder?.id ?? null },
      });
    }
    created++;
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
  "tayyaba@bwm.local": [["Google Ads", 4], ["Lead Generation", 4], ["Local SEO", 3]],
  "claire@bwm.local": [["Meta Ads", 4], ["Social Media Marketing", 5], ["Automation", 2]],
  "cam@bwm.local": [["Creative Production", 5], ["Graphic Design", 4], ["Branding", 3]],
  "cheryl@bwm.local": [["Websites", 3], ["CRM Implementation", 4], ["Google Business Profile", 4]],
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

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
