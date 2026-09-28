import "server-only";

import { prisma, transaction } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { companyTimezone } from "@/lib/company-time";
import { storedRoleValues } from "@/config/permissions";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { balanceOf, dayKey, isInvoiceStatus, parseLines, type InvoiceStatus, type RawLine } from "@/modules/billing/domain";
import { isCurrency } from "@/modules/billing/money";

/**
 * Invoices, server side: who may see which, and drafts. Sending, payments,
 * voiding and the overdue job are in `lifecycle.ts`; the founder's figures
 * in `overview.ts`. Every write goes through the audited Prisma client.
 */

export class BillingError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Today on the company calendar, as "YYYY-MM-DD". */
export async function todayKey(now = new Date()): Promise<string> {
  return dayKey(now, await companyTimezone());
}

/** A date-only key as the stored instant (UTC midnight). */
export const keyToDate = (key: string): Date => new Date(`${key}T00:00:00.000Z`);

export async function founderIds(organizationId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { organizationId, isActive: true, role: { in: storedRoleValues("FOUNDER") } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The client account's owners — who a client's billing notices go to. */
export async function clientOwnerIds(clientAccountId: string | null): Promise<string[]> {
  if (!clientAccountId) return [];
  const rows = await prisma.user.findMany({ where: { clientAccountId, role: "CLIENT", clientRole: "OWNER", isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

const INVOICE_INCLUDE = {
  client: { select: { id: true, businessName: true, email: true, location: true, contactName: true, clientAccountId: true, organizationId: true } },
  project: { select: { id: true, title: true } },
  lines: { orderBy: { position: "asc" as const }, include: { service: { select: { id: true, name: true } } } },
  payments: {
    orderBy: { paidAt: "asc" as const },
    include: { recordedBy: { select: { name: true } }, reversedBy: { select: { name: true } } },
  },
  createdBy: { select: { name: true } },
};

export type FullInvoice = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;

async function loadInvoice(id: string) {
  return prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
}

/** An invoice the founder may see (tenancy narrows it to their organization). Anyone else: null. */
export async function invoiceForStaff(principal: Principal, id: string, action: "read" | "update" = "read") {
  const inv = await loadInvoice(id);
  if (!inv) return null;
  const allowed = authorize(principal, action, "invoice", { organizationId: inv.organizationId, clientId: inv.clientId }).allowed;
  return allowed && principal.role !== "CLIENT" ? inv : null;
}

/** An invoice as its client sees it: its own account, owners only, never a draft. */
export async function invoiceForClient(principal: Principal, id: string) {
  if (principal.role !== "CLIENT" || !principal.clientAccountId) return null;
  const owner = await prisma.user.findUnique({ where: { id: principal.id }, select: { clientRole: true } });
  if (owner?.clientRole !== "OWNER") return null;
  const inv = await loadInvoice(id);
  if (!inv || inv.status === "DRAFT") return null;
  if (inv.client.clientAccountId !== principal.clientAccountId || inv.organizationId !== principal.organizationId) return null;
  return authorize(principal, "read", "invoice", { organizationId: inv.organizationId, clientAccountId: inv.client.clientAccountId }).allowed ? inv : null;
}

export type InvoiceRow = {
  id: string;
  numberLabel: string | null;
  status: InvoiceStatus;
  client: { id: string; businessName: string };
  project: { id: string; title: string } | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  issueDate: string | null;
  dueDate: string;
};

export const toRow = (i: {
  id: string;
  numberLabel: string | null;
  status: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  issueDate: Date | null;
  dueDate: Date;
  client: { id: string; businessName: string };
  project: { id: string; title: string } | null;
}): InvoiceRow => ({
  id: i.id,
  numberLabel: i.numberLabel,
  status: isInvoiceStatus(i.status) ? i.status : "SENT",
  client: { id: i.client.id, businessName: i.client.businessName },
  project: i.project ? { id: i.project.id, title: i.project.title } : null,
  currency: i.currency,
  totalMinor: i.totalMinor,
  paidMinor: i.paidMinor,
  balanceMinor: balanceOf(i),
  issueDate: i.issueDate?.toISOString() ?? null,
  dueDate: i.dueDate.toISOString(),
});

export const PAGE_SIZE = 50;

/** The founder's invoice list, filtered and paginated (newest first). */
export async function listInvoices(filter: { status?: string; clientId?: string; q?: string; page?: number }) {
  const page = Math.max(1, filter.page ?? 1);
  const where = {
    ...(filter.status && isInvoiceStatus(filter.status) ? { status: filter.status } : filter.status === "OPEN" ? { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } : {}),
    ...(filter.clientId ? { clientId: filter.clientId } : {}),
    ...(filter.q ? { OR: [{ numberLabel: { contains: filter.q } }, { client: { businessName: { contains: filter.q } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { id: true, businessName: true } }, project: { select: { id: true, title: true } } },
    }),
    prisma.invoice.count({ where }),
  ]);
  return { invoices: rows.map(toRow), page, pageSize: PAGE_SIZE, total };
}

export type DraftInput = {
  clientId: string;
  projectId?: string | null;
  currency: string;
  dueDate: string;
  notes?: string | null;
  lines: RawLine[];
};

/** Creates or replaces a draft. Only a DRAFT is ever edited; lines are replaced whole. */
export async function saveDraft(principal: Principal, input: DraftInput, id?: string) {
  if (!principal.organizationId) throw new BillingError("Your account has no organization", 403);
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, organizationId: true } });
  if (!client || client.organizationId !== principal.organizationId) throw new BillingError("Choose a client", 422, { clientId: "Choose a client" });
  if (input.projectId) {
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { clientId: true } });
    if (!project || project.clientId !== client.id) throw new BillingError("That project isn't this client's", 422, { projectId: "Pick one of this client's projects" });
  }
  if (!isCurrency(input.currency)) throw new BillingError("Pick a currency", 422, { currency: "Pick a currency" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new BillingError("Pick a due date", 422, { dueDate: "Pick a due date" });
  const parsed = parseLines(input.lines);
  if (!parsed.ok) throw new BillingError("Please fix the highlighted lines", 422, parsed.errors);
  const serviceIds = [...new Set(parsed.lines.map((l) => l.serviceId).filter((s): s is string => Boolean(s)))];
  if (serviceIds.length) {
    const found = await prisma.serviceCatalog.count({ where: { id: { in: serviceIds }, organizationId: principal.organizationId } });
    if (found !== serviceIds.length) throw new BillingError("A line names a service that doesn't exist", 422, { lines: "Pick services from the catalog" });
  }
  const totalMinor = parsed.lines.reduce((s, l) => s + l.amountMinor, 0);
  const data = {
    clientId: client.id,
    projectId: input.projectId || null,
    currency: input.currency,
    dueDate: keyToDate(input.dueDate),
    notes: input.notes?.trim() || null,
    subtotalMinor: totalMinor,
    totalMinor,
  };
  const lines = parsed.lines.map(({ serviceId, description, quantityMilli, rateMinor, amountMinor, position }) => ({ serviceId, description, quantityMilli, rateMinor, amountMinor, position }));

  return transaction(async (tx) => {
    if (!id) {
      return tx.invoice.create({ data: { ...data, organizationId: principal.organizationId!, createdById: principal.id, status: "DRAFT", lines: { create: lines } } });
    }
    // Conditional: a draft sent in another tab a second ago is no longer editable.
    const claimed = await tx.invoice.updateMany({ where: { id, status: "DRAFT" }, data });
    if (claimed.count !== 1) throw new BillingError("Only a draft can be edited", 409);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.invoiceLine.createMany({ data: lines.map((l) => ({ ...l, invoiceId: id })) });
    return tx.invoice.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteDraft(id: string) {
  const gone = await prisma.invoice.deleteMany({ where: { id, status: "DRAFT" } });
  if (gone.count !== 1) throw new BillingError("Only a draft can be deleted — void a sent invoice instead", 409);
}

/** The client's active services, as draft lines (rate from the agreed price). */
export async function suggestedLines(clientId: string): Promise<RawLine[]> {
  const services = await prisma.clientService.findMany({ where: { clientId, status: "ACTIVE" }, include: { service: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
  return services.map((s) => ({ serviceId: s.service.id, description: s.service.name, quantity: "1", rate: `${s.price}.00` }));
}

/** The PDF's data, from an invoice the caller has already been allowed to see. */
export async function invoiceDocument(inv: FullInvoice): Promise<import("@/modules/billing/pdf").InvoiceDocument> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: inv.organizationId }, select: { name: true, billingAddress: true, billingEmail: true } });
  return {
    seller: { name: org.name, address: org.billingAddress, email: org.billingEmail },
    numberLabel: inv.numberLabel,
    status: isInvoiceStatus(inv.status) ? inv.status : "SENT",
    issueDate: inv.issueDate?.toISOString() ?? null,
    dueDate: inv.dueDate.toISOString(),
    currency: inv.currency,
    // A draft isn't frozen yet, so it shows the client as it is now.
    billTo: {
      name: inv.billToName ?? inv.client.businessName,
      email: inv.billToEmail ?? inv.client.email,
      address: inv.billToAddress ?? ([inv.client.contactName, inv.client.location].filter(Boolean).join("\n") || null),
    },
    project: inv.project?.title ?? null,
    lines: inv.lines.map((l) => ({ description: l.description, quantityMilli: l.quantityMilli, rateMinor: l.rateMinor, amountMinor: l.amountMinor })),
    subtotalMinor: inv.subtotalMinor,
    totalMinor: inv.totalMinor,
    paidMinor: inv.paidMinor,
    notes: inv.notes,
    payments: inv.payments.filter((p) => !p.reversedAt).map((p) => ({ paidAt: p.paidAt.toISOString(), method: p.method, reference: p.reference, amountMinor: p.amountMinor })),
  };
}

export async function loadFullInvoice(id: string) {
  return loadInvoice(id);
}

/** A BillingError as the API's error envelope; anything else is rethrown. */
export function billingErrorResponse(error: unknown) {
  if (error instanceof BillingError) return apiError(error.message, error.status, error.fields);
  throw error;
}
