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

  const roles = await prisma.user.groupBy({ by: ["role"], _count: true });
  console.log("Advertise X demo tenant");
  console.log(`  created   ${created} new record group(s)`);
  for (const row of roles.sort((a, b) => a.role.localeCompare(b.role))) {
    console.log(`  ${row.role.padEnd(14)} ${row._count}`);
  }
  console.log(`  client accounts ${await prisma.clientAccount.count()}`);
  console.log(`  agent grants    ${await prisma.agentGrant.count()}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
