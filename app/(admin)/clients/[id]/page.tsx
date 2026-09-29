import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { authorize } from "@/modules/rbac/authorize";
import { requirePage } from "@/modules/rbac/server";
import { clientOverviews } from "@/modules/clients/overview";
import { canOnCredentials } from "@/modules/vault/credentials";
import { monthlyEquivalent } from "@/modules/services/catalog";
import { isOpenProject } from "@/modules/projects/domain";
import { ClientProfile, type ClientProfileData } from "@/components/clients/ClientProfile";
import type { ClientStatus } from "@/lib/constants";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const client = await prisma.client.findUnique({ where: { id: params.id }, select: { businessName: true } });
  return { title: client?.businessName ?? "Client" };
}

/**
 * The client profile (Phase 4 scope 1) — the single place everything about a
 * client lives. The founder sees money; a manager sees their departments'
 * clients without it.
 */
export default async function ClientProfilePage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const principal = await requirePage("read", "client");

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      department: { select: { id: true, shortLabel: true } },
      assignee: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      clientAccount: { select: { id: true, users: { select: { id: true }, take: 1 } } },
    },
  });
  if (!client) notFound();
  const target = { organizationId: client.organizationId, departmentId: client.departmentId, clientId: client.id };
  if (!authorize(principal, "read", "client", target).allowed) notFound();

  const founder = principal.role === "FOUNDER";
  const [overview, projects, pinned, reports, services, contracts] = await Promise.all([
    clientOverviews([client.id]).then((m) => m.get(client.id)!),
    prisma.project.findMany({
      where: { clientId: client.id },
      select: {
        status: true,
        owner: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
        members: { select: { user: { select: { id: true, name: true, avatarColor: true, jobTitle: true } } } },
      },
    }),
    prisma.clientNote.findMany({
      where: { clientId: client.id, pinned: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, body: true, updatedAt: true, author: { select: { name: true } } },
    }),
    prisma.report.findMany({
      where: { clientId: client.id },
      orderBy: { periodStart: "desc" },
      take: 12,
      select: { id: true, type: true, periodStart: true, periodEnd: true, generatedAt: true },
    }),
    founder ? prisma.clientService.findMany({ where: { clientId: client.id }, select: { price: true, billing: true, status: true } }) : Promise.resolve([]),
    founder ? prisma.contract.findMany({ where: { clientId: client.id }, select: { value: true, status: true } }) : Promise.resolve([]),
  ]);

  // The assigned team: the account owner, then everyone on an open project.
  const team = new Map<string, { id: string; name: string; avatarColor: string; jobTitle: string | null; role: string }>();
  if (client.assignee) team.set(client.assignee.id, { ...client.assignee, role: "Account owner" });
  for (const p of projects.filter((x) => isOpenProject(x.status))) {
    if (p.owner && !team.has(p.owner.id)) team.set(p.owner.id, { ...p.owner, role: "Project lead" });
    for (const m of p.members) if (!team.has(m.user.id)) team.set(m.user.id, { ...m.user, role: "Project team" });
  }

  const data: ClientProfileData = {
    client: {
      id: client.id,
      businessName: client.businessName,
      contactName: client.contactName,
      email: client.email,
      // Contact numbers stay the founder's (the standing leak-scan policy).
      phone: founder ? client.phone : null,
      website: client.website,
      location: client.location,
      country: client.country,
      industry: client.industry,
      tags: client.tags ? client.tags.split(",").filter(Boolean) : [],
      status: client.status as ClientStatus,
      notes: client.notes,
      onboardedAt: client.onboardedAt.toISOString(),
      department: client.department,
      hasPortal: Boolean(client.clientAccount?.users.length),
    },
    // Recurring value is the founder's; the rest of the overview is shared.
    overview: founder ? overview : { ...overview, monthlyRecurring: 0 },
    team: [...team.values()],
    pinnedNotes: pinned.map((n) => ({ id: n.id, body: n.body, updatedAt: n.updatedAt.toISOString(), author: n.author?.name ?? null })),
    reports: reports.map((r) => ({ id: r.id, type: r.type, periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString() })),
    editRecord: founder
      ? {
          id: client.id,
          businessName: client.businessName,
          contactName: client.contactName,
          email: client.email,
          phone: client.phone,
          country: client.country,
          industry: client.industry,
          monthlyBudget: client.monthlyBudget,
          status: client.status as ClientStatus,
          notes: client.notes,
          autoRenew: client.autoRenew,
          targetRoas: client.targetRoas,
          onboardedAt: client.onboardedAt.toISOString(),
        }
      : null,
    billing: founder
      ? {
          monthlyRecurring: overview.monthlyRecurring,
          oneTime: services.filter((s) => s.billing === "ONE_TIME" && s.status !== "ENDED").reduce((t, s) => t + s.price, 0),
          activeServices: services.filter((s) => s.status === "ACTIVE").length,
          contractedValue: contracts.filter((c) => ["SIGNED", "ACTIVE"].includes(c.status)).reduce((t, c) => t + c.value, 0),
          annualRunRate: services.filter((s) => s.status === "ACTIVE").reduce((t, s) => t + monthlyEquivalent(s.price, s.billing) * 12, 0),
        }
      : null,
    viewer: {
      id: principal.id,
      isFounder: founder,
      canEdit: authorize(principal, "update", "client", target).allowed,
      canManageContracts: principal.role === "FOUNDER" || principal.role === "MANAGER",
      canCreateProject: authorize(principal, "create", "project", { organizationId: client.organizationId, departmentId: client.departmentId }).allowed,
      canSeeCredentials: canOnCredentials(principal, "read", { ...target, id: client.id, businessName: client.businessName }),
    },
  };

  return <ClientProfile data={data} initialTab={searchParams.tab} />;
}
