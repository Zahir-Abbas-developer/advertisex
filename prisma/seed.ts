import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { avatarColorFor, FIELD_ENTITIES } from "../lib/constants";
import { serializeSkills } from "../lib/skills";

/**
 * Advertise X seed — the starting shape of the business, not the shape of the system.
 *
 * Everything here is a database record an admin can edit afterwards:
 * departments, their pipeline stages, their field definitions, and who works in
 * which department. Nothing in the app may assume there are four departments
 * or that they are named what they are named today.
 *
 * Deliberately absent: demo clients, demo leads, demo deals, invented numbers.
 * The agency fork seeded five clients and fifty-five milestones so its screens
 * looked populated; every figure the team sees must come from real work, so this
 * seeds structure and people and stops there. The old file is kept as
 * `prisma/seed.agency.archive` for reference, and the BWM-era service lines
 * this file seeded before decision D2 live on in git history.
 *
 * Placeholder passwords are paired with `mustChangePassword: true`, so a
 * seeded credential cannot survive first contact with a real user. Override
 * the default with SEED_PASSWORD.
 *
 * ## It creates, and never overwrites
 *
 * `vercel-build` runs this file on every deploy, against the live database.
 * That makes it a bootstrap, not a sync — and it used to behave like a sync.
 * Every upsert rewrote what it found, so each push to `main` quietly put back
 * the names, roles, job titles and skills of the six team accounts, the labels
 * and order of every department and stage, and the shape of every field. It
 * also resurrected anything an admin had removed: stages, field definitions
 * and department memberships are hard-deleted by the settings screens, and the
 * next deploy recreated all of them. An admin could not make a change that
 * outlived a commit.
 *
 * So each record is created only if it is missing, and its children are
 * created only alongside it:
 *
 * - A department that already exists is left exactly as it is, and its stages
 *   and fields are not touched — they were seeded when it was, and anything
 *   missing now was removed on purpose.
 * - A team account that already exists is left exactly as it is, password
 *   included.
 * - A membership is created only when the account or the department was created
 *   in this same run, because that is the only case in which nobody could have
 *   removed it.
 *
 * The cost is that a stage or field added to an existing department *here*
 * will not reach a database that already has that department. That is the
 * intended direction: once a business line exists, its shape belongs to
 * Settings -> Departments, not to a deploy.
 */

const prisma = new PrismaClient();

const PLACEHOLDER_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";

/**
 * The service lines, per founder decision D2 (docs/DECISIONS.md): departments
 * are Advertise X's services for food & drink brands, derived from the
 * playbook — the Appetite Audit entry offer, the 90-day paid-ads Growth
 * Sprint core, and the studio and retention work around them.
 *
 * The BWM-era departments this replaces are not deleted from databases that
 * already have them (this file creates, never destroys); the founder retires
 * them in Settings → Departments when ready.
 */
const DEPARTMENTS = [
  {
    slug: "appetite-audit",
    name: "Appetite Audit",
    shortLabel: "Appetite Audit",
    colorToken: "success",
    description:
      "The entry offer: a paid teardown of a food business's ads, listings and funnel, delivered as a call — and the doorway to a Growth Sprint.",
    order: 1,
    stages: [
      { key: "NEW_INQUIRY", label: "New Inquiry", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "AUDIT_BOOKED", label: "Audit Booked", sortOrder: 3, kind: "OPEN", colorToken: "info" },
      { key: "AUDIT_DELIVERED", label: "Audit Delivered", sortOrder: 4, kind: "OPEN", colorToken: "warning" },
      { key: "WON", label: "Won — Engagement", sortOrder: 5, kind: "WON", colorToken: "success" },
      { key: "ACTIVE_CLIENT", label: "Active Client", sortOrder: 6, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "LOST", label: "Lost", sortOrder: 7, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      {
        key: "business_type",
        label: "Business type",
        type: "SELECT",
        options: "Restaurant,Cafe,Bar,Bakery,Food Truck,Ghost Kitchen,Other",
        order: 1,
        required: true,
      },
      { key: "cuisine", label: "Cuisine / concept", type: "TEXT", order: 2 },
      { key: "locations", label: "Locations", type: "NUMBER", order: 3 },
      { key: "avg_ticket", label: "Average ticket", type: "CURRENCY", order: 4 },
      { key: "monthly_ad_spend", label: "Current monthly ad spend", type: "CURRENCY", order: 5 },
      {
        key: "channels_in_use",
        label: "Channels in use",
        type: "MULTISELECT",
        options: "Google Ads,Meta Ads,TikTok,Email/SMS,Organic social,None",
        order: 6,
      },
      { key: "audit_focus", label: "What they want looked at", type: "TEXTAREA", order: 7 },
    ],
  },
  {
    slug: "growth-sprint",
    name: "Paid Ads — Growth Sprint",
    shortLabel: "Growth Sprint",
    colorToken: "info",
    description:
      "The core offer: 90 days of managed Google and Meta ads against one stated goal, then rolling retention.",
    order: 2,
    stages: [
      { key: "NEW_LEAD", label: "New Lead", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "STRATEGY_CALL", label: "Strategy Call", sortOrder: 3, kind: "OPEN", colorToken: "info" },
      { key: "PROPOSAL", label: "Proposal", sortOrder: 4, kind: "OPEN", colorToken: "warning" },
      { key: "WON", label: "Won — Sprint Signed", sortOrder: 5, kind: "WON", colorToken: "success" },
      // Two flavours of converted-and-ongoing, so the board says which
      // clients are inside their 90 days and which have rolled over.
      { key: "LIVE_SPRINT", label: "Live Sprint", sortOrder: 6, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "RETAINED", label: "Retained", sortOrder: 7, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "LOST", label: "Lost", sortOrder: 8, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      {
        key: "monthly_ad_budget",
        label: "Monthly ad budget",
        type: "CURRENCY",
        helpText: "Media spend, not our fee.",
        order: 1,
        required: true,
      },
      {
        key: "platforms",
        label: "Platforms",
        type: "MULTISELECT",
        options: "Google Ads,Meta Ads,TikTok Ads",
        order: 2,
      },
      {
        key: "sprint_goal",
        label: "Sprint goal",
        type: "SELECT",
        options: "More bookings,More delivery orders,More footfall,Catering leads,New location launch",
        order: 3,
      },
      {
        key: "current_agency",
        label: "Who runs their ads today",
        type: "SELECT",
        options: "Nobody,In-house,Another agency",
        order: 4,
      },
      { key: "sprint_start", label: "Target start date", type: "DATE", order: 5 },
    ],
  },
  {
    slug: "creative-studio",
    name: "Creative Studio",
    shortLabel: "Creative Studio",
    colorToken: "warning",
    description:
      "Food photography, video, menus and brand work — sold on its own or feeding the ads.",
    order: 3,
    stages: [
      { key: "NEW_REQUEST", label: "New Request", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "SCOPING", label: "Scoping", sortOrder: 3, kind: "OPEN", colorToken: "info" },
      { key: "PROPOSAL", label: "Proposal", sortOrder: 4, kind: "OPEN", colorToken: "warning" },
      { key: "WON", label: "Won — Booked", sortOrder: 5, kind: "WON", colorToken: "success" },
      { key: "IN_PRODUCTION", label: "In Production", sortOrder: 6, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "LOST", label: "Lost", sortOrder: 7, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      {
        key: "deliverables",
        label: "Deliverables",
        type: "MULTISELECT",
        options: "Food photography,Video / Reels,Menu design,Brand identity,UGC package",
        order: 1,
      },
      { key: "shoot_location", label: "Shoot location", type: "TEXT", order: 2 },
      { key: "needed_by", label: "Needed by", type: "DATE", order: 3 },
      { key: "budget", label: "Budget", type: "CURRENCY", order: 4 },
      { key: "creative_brief", label: "Creative brief", type: "TEXTAREA", order: 5 },
    ],
  },
  {
    slug: "web-retention",
    name: "Web & Retention",
    shortLabel: "Web & Retention",
    colorToken: "neutral",
    description:
      "Websites, online ordering and booking funnels, plus the email/SMS and loyalty programs that keep guests coming back.",
    order: 4,
    stages: [
      { key: "NEW_LEAD", label: "New Lead", sortOrder: 1, kind: "OPEN", colorToken: "neutral" },
      { key: "QUALIFIED", label: "Qualified", sortOrder: 2, kind: "OPEN", colorToken: "info" },
      { key: "DISCOVERY", label: "Discovery", sortOrder: 3, kind: "OPEN", colorToken: "info" },
      { key: "PROPOSAL", label: "Proposal", sortOrder: 4, kind: "OPEN", colorToken: "warning" },
      { key: "WON", label: "Won — Signed", sortOrder: 5, kind: "WON", colorToken: "success" },
      { key: "LIVE", label: "Live & Retained", sortOrder: 6, kind: "ACTIVE_CLIENT", colorToken: "info" },
      { key: "LOST", label: "Lost", sortOrder: 7, kind: "LOST", colorToken: "danger" },
    ],
    fields: [
      { key: "current_website", label: "Current website", type: "TEXT", order: 1 },
      {
        key: "pos_system",
        label: "POS system",
        type: "SELECT",
        options: "Toast,Square,Clover,Lightspeed,Other,None",
        order: 2,
      },
      {
        key: "services_needed",
        label: "Services needed",
        type: "MULTISELECT",
        options: "Website,Online ordering,Booking funnel,Email/SMS,Loyalty program",
        order: 3,
      },
      {
        // Only worth asking once retention work is on the table.
        key: "list_size",
        label: "Email/SMS list size",
        type: "NUMBER",
        order: 4,
        showIfKey: "services_needed",
        showIfValues: "Email/SMS,Loyalty program",
      },
      { key: "launch_by", label: "Launch by", type: "DATE", order: 5 },
    ],
  },
] as const;

/**
 * The only users.
 *
 * The same six humans as before D2 — these emails are live credentials, and
 * because this file never rewrites an existing account, renaming one here
 * would create a duplicate person on any database that already has the team.
 * Moving the roster to an @advertisex domain is a founder decision and a
 * deliberate migration, not a seed edit.
 *
 * `departments` carries each person's service lines, with per-line skills.
 * Skills are free-text strings, not an enum: a line can need a speciality
 * nobody anticipated, and an enum would put that behind a deploy. The matrix
 * is a starting point the founder reshapes in Settings — deliberately not
 * everyone-everywhere, because department scoping is the security model and
 * the tests prove isolation using the gaps.
 *
 * `jobTitle` is legacy from the agency fork and is kept only because the
 * column is required. Department membership below is the real mapping.
 */
const TEAM = [
  {
    name: "Coach D",
    email: "coachd@bwm.local",
    role: "ADMIN",
    jobTitle: "Owner",
    departments: [
      { slug: "appetite-audit", roleInDept: "LEAD", skills: ["audits", "closing"] },
      { slug: "growth-sprint", roleInDept: "LEAD", skills: ["strategy", "closing"] },
      { slug: "creative-studio", roleInDept: "LEAD", skills: ["creative direction"] },
      { slug: "web-retention", roleInDept: "LEAD", skills: ["strategy", "retention"] },
    ],
  },
  {
    name: "Tayyaba",
    email: "tayyaba@bwm.local",
    role: "MEMBER",
    jobTitle: "Sales & Insurance",
    departments: [
      { slug: "appetite-audit", roleInDept: "MEMBER", skills: ["qualification", "audits"] },
      { slug: "growth-sprint", roleInDept: "MEMBER", skills: ["media buying", "reporting"] },
    ],
  },
  {
    name: "Claire",
    email: "claire@bwm.local",
    role: "MEMBER",
    jobTitle: "Sales & Insurance",
    departments: [
      { slug: "appetite-audit", roleInDept: "MEMBER", skills: ["audits", "follow-up"] },
      { slug: "growth-sprint", roleInDept: "MEMBER", skills: ["media buying"] },
      { slug: "web-retention", roleInDept: "MEMBER", skills: ["email/sms", "funnels"] },
    ],
  },
  {
    name: "Cam",
    email: "cam@bwm.local",
    role: "MEMBER",
    jobTitle: "Sales & Affiliates",
    departments: [
      { slug: "growth-sprint", roleInDept: "MEMBER", skills: ["creative testing"] },
      { slug: "creative-studio", roleInDept: "LEAD", skills: ["photo", "video", "menus"] },
    ],
  },
  {
    name: "Cheryl",
    email: "cheryl@bwm.local",
    role: "MEMBER",
    jobTitle: "Culture Plus Network",
    departments: [
      { slug: "creative-studio", roleInDept: "MEMBER", skills: ["ugc", "scheduling"] },
      { slug: "web-retention", roleInDept: "MEMBER", skills: ["loyalty", "follow-up"] },
    ],
  },
  {
    name: "Raja Zain",
    email: "rajazain@bwm.local",
    role: "SUPPORT_ADMIN",
    jobTitle: "System Maintainer",
    departments: [
      { slug: "appetite-audit", roleInDept: "MEMBER", skills: ["support"] },
      { slug: "growth-sprint", roleInDept: "MEMBER", skills: ["support"] },
      { slug: "creative-studio", roleInDept: "MEMBER", skills: ["support"] },
      { slug: "web-retention", roleInDept: "MEMBER", skills: ["support"] },
    ],
  },
] as const;

/**
 * The Phase 2 skills taxonomy (the founder extends it in the app). Created if
 * missing, never renamed or re-categorised here — once a skill exists it
 * belongs to Settings, like departments do.
 */
const SKILLS: readonly { name: string; category: string }[] = [
  { name: "Google Ads", category: "Paid media" },
  { name: "Meta Ads", category: "Paid media" },
  { name: "Lead Generation", category: "Paid media" },
  { name: "SEO", category: "Search" },
  { name: "Local SEO", category: "Search" },
  { name: "Google Business Profile", category: "Search" },
  { name: "Social Media Marketing", category: "Social" },
  { name: "UI/UX", category: "Design" },
  { name: "Graphic Design", category: "Design" },
  { name: "Creative Production", category: "Design" },
  { name: "Branding", category: "Design" },
  { name: "Development", category: "Engineering" },
  { name: "Websites", category: "Engineering" },
  { name: "Mobile Apps", category: "Engineering" },
  { name: "Automation", category: "Engineering" },
  { name: "AI Automation", category: "Engineering" },
  { name: "CRM Implementation", category: "Engineering" },
];

async function main() {
  const passwordHash = await bcrypt.hash(PLACEHOLDER_PASSWORD, 10);

  // Organization #1 (ADR-005): Advertise X itself. Rows that predate tenancy
  // get their organizationId backfilled — only null keys are touched, so a
  // row that already belongs somewhere is never moved. That makes this the
  // one deliberate exception to "create, never overwrite": completing a
  // migration is not undoing an admin's edit.
  const org = await prisma.organization.upsert({
    where: { slug: "advertisex" },
    update: {},
    create: { slug: "advertisex", name: "Advertise X" },
  });
  await prisma.user.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });
  await prisma.department.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });
  await prisma.client.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });
  await prisma.auditLog.updateMany({
    where: { organizationId: null },
    data: { organizationId: org.id },
  });

  // Settings singleton. The parked-module flags stay off: Advertise X did not ask for
  // attendance, scoring, retainer cycles or client KPIs, and off means those
  // features are absent rather than empty.
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      timezone: "America/New_York",
      featureAttendance: false,
      featureScoring: false,
      featureRetainerCycles: false,
      featureClientKpis: false,
    },
  });

  for (const skill of SKILLS) {
    await prisma.skill.upsert({
      where: { organizationId_name: { organizationId: org.id, name: skill.name } },
      update: {},
      create: { organizationId: org.id, ...skill },
    });
  }

  const departmentIdBySlug = new Map<string, string>();
  /** Slugs created in this run — the only departments whose children we add. */
  const createdDepartments = new Set<string>();

  for (const dept of DEPARTMENTS) {
    const existing = await prisma.department.findUnique({
      where: { slug: dept.slug },
      select: { id: true },
    });

    // Already there: it belongs to the admin now. Its name, its stages and its
    // fields are whatever they have been made into, including absent.
    if (existing) {
      departmentIdBySlug.set(dept.slug, existing.id);
      continue;
    }

    const department = await prisma.department.create({
      data: {
        organizationId: org.id,
        slug: dept.slug,
        name: dept.name,
        shortLabel: dept.shortLabel,
        colorToken: dept.colorToken,
        description: dept.description,
        order: dept.order,
      },
    });
    departmentIdBySlug.set(dept.slug, department.id);
    createdDepartments.add(dept.slug);

    for (const stage of dept.stages) {
      await prisma.pipelineStage.create({
        data: {
          departmentId: department.id,
          key: stage.key,
          label: stage.label,
          sortOrder: stage.sortOrder,
          kind: stage.kind,
          colorToken: stage.colorToken,
        },
      });
    }

    // Each department's set is seeded for both entities. The facts a business
    // line needs while qualifying a deal are the same ones it needs once that
    // deal converts; an admin can diverge them per entity afterwards, which is
    // exactly what Settings -> Departments -> Fields is for.
    for (const entity of FIELD_ENTITIES) {
      for (const field of dept.fields) {
        const shape = {
          label: field.label,
          type: field.type,
          options: "options" in field ? field.options : "",
          helpText: "helpText" in field ? field.helpText : null,
          required: "required" in field ? field.required : false,
          order: field.order,
          showIfKey: "showIfKey" in field ? field.showIfKey : null,
          showIfValues: "showIfValues" in field ? field.showIfValues : "",
        };

        await prisma.fieldDefinition.create({
          data: { departmentId: department.id, entity, key: field.key, ...shape },
        });
      }
    }
  }

  /** Emails created in this run — the only accounts whose memberships we add. */
  const createdUsers = new Set<string>();

  for (const person of TEAM) {
    let user = await prisma.user.findUnique({
      where: { email: person.email },
      select: { id: true },
    });

    // An existing account is never rewritten: not its name, not its role, and
    // above all not its password.
    if (!user) {
      user = await prisma.user.create({
        data: {
          organizationId: org.id,
          name: person.name,
          email: person.email,
          passwordHash,
          role: person.role,
          jobTitle: person.jobTitle,
          mustChangePassword: true,
          avatarColor: avatarColorFor(person.name),
        },
        select: { id: true },
      });
      createdUsers.add(person.email);
    }

    for (const membership of person.departments) {
      const departmentId = departmentIdBySlug.get(membership.slug);
      if (!departmentId) throw new Error(`Unknown department slug: ${membership.slug}`);

      // A membership between an account and a department that both already
      // existed may have been removed on purpose, so it is not recreated.
      const isNewRelationship =
        createdUsers.has(person.email) || createdDepartments.has(membership.slug);
      if (!isNewRelationship) continue;

      await prisma.departmentMembership.upsert({
        where: { userId_departmentId: { userId: user.id, departmentId } },
        update: {},
        create: {
          userId: user.id,
          departmentId,
          roleInDept: membership.roleInDept,
          skills: serializeSkills(membership.skills),
        },
      });
    }
  }

  const [departments, stages, fields, users] = await Promise.all([
    prisma.department.count(),
    prisma.pipelineStage.count(),
    prisma.fieldDefinition.count(),
    prisma.user.count(),
  ]);
  const memberships = await prisma.departmentMembership.count();

  const keptDepartments = DEPARTMENTS.length - createdDepartments.size;
  const keptUsers = TEAM.length - createdUsers.size;

  console.log("Advertise X seed complete");
  console.log(`  created         ${createdDepartments.size} department(s), ${createdUsers.size} account(s)`);
  console.log(`  left untouched  ${keptDepartments} department(s), ${keptUsers} account(s)`);
  console.log("");
  console.log(`  departments     ${departments}`);
  console.log(`  pipeline stages ${stages}`);
  console.log(`  field defs      ${fields}`);
  console.log(`  users           ${users}`);
  console.log(`  memberships     ${memberships}`);
  if (createdUsers.size > 0) {
    console.log(`\n  New accounts use the placeholder password and must change it on first login.`);
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
