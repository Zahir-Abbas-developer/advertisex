import { NextResponse } from "next/server";

import { prisma, transaction } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors, onboardClientSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { containsInsensitive } from "@/lib/db-features";
import { requireApi } from "@/modules/rbac/server";
import { clientOverviews } from "@/modules/clients/overview";
import { servicesForPlan, writePlan } from "@/modules/projects/server";
import { onProjectCreated } from "@/modules/assignment/server";
import { FIRST_PROJECT_DAYS } from "@/modules/projects/domain";

/**
 * The clients list (Phase 4): the founder sees every client, a manager their
 * departments'. Recurring value is the founder's alone.
 */
export async function GET(request: Request) {
  const gate = await requireApi("read", "client");
  if (gate.response) return gate.response;
  const principal = gate.principal;
  // The book of business is the founder's and the managers'. Employees reach
  // the clients they work for through their projects, not a list.
  if (principal.role !== "FOUNDER" && principal.role !== "MANAGER") return apiError("You don't have access to that", 403);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const query = searchParams.get("q")?.trim();
  const options = searchParams.get("options") === "1";

  const scope = principal.role === "FOUNDER" ? {} : { departmentId: { in: [...principal.departmentIds] } };

  try {
    const clients = await prisma.client.findMany({
      where: {
        ...scope,
        ...(status && status !== "ALL" ? { status } : {}),
        // containsInsensitive supplies Postgres's `mode: "insensitive"`;
        // SQLite ignores it. Without it, search behaves differently in
        // production than it does locally.
        ...(query ? { businessName: containsInsensitive(query) } : {}),
      },
      orderBy: [{ status: "asc" }, { businessName: "asc" }],
      include: {
        department: { select: { id: true, shortLabel: true, colorToken: true } },
        assignee: { select: { id: true, name: true, avatarColor: true } },
      },
    });

    // A picker (new project, filters) needs names only.
    if (options) {
      return NextResponse.json({ clients: clients.map((c) => ({ id: c.id, businessName: c.businessName, departmentId: c.departmentId })) });
    }

    const overviews = await clientOverviews(clients.map((c) => c.id));
    const money = principal.role === "FOUNDER";
    return NextResponse.json({
      clients: clients.map((client) => {
        const o = overviews.get(client.id)!;
        return {
          id: client.id,
          businessName: client.businessName,
          contactName: client.contactName,
          email: client.email,
          country: client.country,
          industry: client.industry,
          status: client.status,
          onboardedAt: client.onboardedAt,
          department: client.department,
          assignee: client.assignee,
          nextFollowUpAt: client.nextFollowUpAt,
          services: o.services,
          monthlyRecurring: money ? o.monthlyRecurring : null,
          openProjects: o.openProjects,
          currentProject: o.currentProject,
          health: o.health,
        };
      }),
      viewer: { canOnboard: money },
    });
  } catch {
    return apiError("Couldn't load your clients", 500);
  }
}

/** The 3-step onboarding wizard: client, services, and the first engagement. */
export async function POST(request: Request) {
  const gate = await requireApi("manage", "admin", "Only the founder onboards clients");
  if (gate.response) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = onboardClientSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const { serviceIds, projectTitle, startDate, ...details } = parsed.data;

  const start = parseDateInput(startDate);
  if (!start) return apiError("Enter a valid start date", 422, { startDate: "Use a valid date" });

  const department = await prisma.department.findFirst({
    where: { id: details.departmentId, isActive: true },
    select: { id: true },
  });
  if (!department) {
    return apiError("Pick a department", 422, { departmentId: "That department no longer exists" });
  }

  const services = await servicesForPlan(serviceIds);
  if (services.length !== new Set(serviceIds).size) {
    return apiError("One of those services no longer exists", 422, {
      serviceIds: "Refresh and pick the services again",
    });
  }
  const prices = await prisma.serviceCatalog.findMany({ where: { id: { in: serviceIds } }, select: { id: true, price: true, billing: true } });

  // One transaction: the client, what they bought (at catalog price, edited on
  // the profile) and their first project planned from the services' stage
  // templates. A failure leaves nothing behind to be duplicated on retry.
  const now = new Date();
  const ownerId = gate.principal.id;
  try {
    const { client, project } = await transaction(async (tx) => {
      const client = await tx.client.create({ data: { ...details, onboardedAt: now } });
      await tx.clientService.createMany({
        data: prices.map((s) => ({
          organizationId: client.organizationId ?? gate.principal.organizationId ?? "",
          clientId: client.id,
          serviceId: s.id,
          price: s.price,
          billing: s.billing,
          startDate: start,
        })),
      });
      const project = await tx.project.create({
        data: {
          organizationId: client.organizationId,
          clientId: client.id,
          title: projectTitle,
          startDate: start,
          endDate: new Date(start.getTime() + FIRST_PROJECT_DAYS * 86_400_000),
          status: start.getTime() <= now.getTime() ? "ACTIVE" : "PLANNING",
          ownerId,
        },
        select: { id: true, title: true },
      });
      await writePlan(tx, project.id, services, now);
      await tx.projectMember.create({ data: { projectId: project.id, userId: ownerId, role: "LEAD" } });
      return { client, project };
    });
    await onProjectCreated(project.id, gate.principal.id);
    return NextResponse.json({ client, project, next: `/clients/${client.id}` }, { status: 201 });
  } catch {
    return apiError("Couldn't onboard this client", 500);
  }
}
