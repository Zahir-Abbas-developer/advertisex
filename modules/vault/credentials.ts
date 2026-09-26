import "server-only";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import type { Action } from "@/config/permissions";
import { MASK } from "@/modules/vault/cipher";
import { openSecret, sealSecret } from "@/modules/vault/server";

/**
 * The client credentials vault (Phase 4 scope 1).
 *
 * - At rest: the secret is sealed (AES-256-GCM, bound to the row id).
 * - In lists and every other response: `MASK`, never the secret.
 * - Revealed only through `reveal()`, which checks the `credential:reveal`
 *   permission for this client and writes a CREDENTIAL_REVEALED audit entry
 *   every time — the entry names who, which login and which client, never
 *   the secret.
 * - Server-only: `import "server-only"` makes a client-component import a
 *   build error, so neither the key nor this code can reach a browser bundle.
 */

export const CREDENTIAL_KINDS = ["WEBSITE", "HOSTING", "DOMAIN", "GOOGLE", "META", "SOCIAL", "EMAIL", "OTHER"] as const;

type ClientRef = { id: string; organizationId: string | null; departmentId: string; businessName: string };

export function canOnCredentials(principal: Principal, action: Action, client: ClientRef): boolean {
  return authorize(principal, action, "credential", {
    organizationId: client.organizationId,
    departmentId: client.departmentId,
    clientId: client.id,
  }).allowed;
}

export async function clientRef(clientId: string): Promise<ClientRef | null> {
  return prisma.client.findUnique({ where: { id: clientId }, select: { id: true, organizationId: true, departmentId: true, businessName: true } });
}

const PUBLIC_SELECT = {
  id: true,
  clientId: true,
  label: true,
  kind: true,
  url: true,
  username: true,
  notes: true,
  lastRevealedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

export type MaskedCredential = {
  id: string;
  clientId: string;
  label: string;
  kind: string;
  url: string | null;
  username: string | null;
  notes: string | null;
  secret: typeof MASK;
  lastRevealedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
};

function masked(row: {
  id: string;
  clientId: string;
  label: string;
  kind: string;
  url: string | null;
  username: string | null;
  notes: string | null;
  lastRevealedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; name: string } | null;
}): MaskedCredential {
  return {
    ...row,
    secret: MASK,
    lastRevealedAt: row.lastRevealedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCredentials(clientId: string): Promise<MaskedCredential[]> {
  const rows = await prisma.clientCredential.findMany({ where: { clientId }, select: PUBLIC_SELECT, orderBy: { label: "asc" } });
  return rows.map(masked);
}

export type CredentialInput = {
  label: string;
  kind: (typeof CREDENTIAL_KINDS)[number];
  url?: string | null;
  username?: string | null;
  notes?: string | null;
  secret: string;
};

export async function createCredential(principal: Principal, client: ClientRef, input: CredentialInput): Promise<MaskedCredential> {
  const id = randomUUID();
  const row = await prisma.clientCredential.create({
    data: {
      id,
      organizationId: client.organizationId ?? principal.organizationId ?? "",
      clientId: client.id,
      label: input.label,
      kind: input.kind,
      url: input.url ?? null,
      username: input.username ?? null,
      notes: input.notes ?? null,
      secret: sealSecret(input.secret, id),
      createdById: principal.id,
    },
    select: PUBLIC_SELECT,
  });
  return masked(row);
}

export async function updateCredential(
  id: string,
  input: Partial<Omit<CredentialInput, "secret">> & { secret?: string },
): Promise<MaskedCredential> {
  const { secret, ...rest } = input;
  const row = await prisma.clientCredential.update({
    where: { id },
    data: { ...rest, ...(secret !== undefined ? { secret: sealSecret(secret, id) } : {}) },
    select: PUBLIC_SELECT,
  });
  return masked(row);
}

/**
 * Opens one secret for one person, and records that they did. The audit
 * entry is written *before* the secret is returned, and unlike ordinary audit
 * writes a failure here is not swallowed: no record, no reveal.
 */
export async function reveal(principal: Principal, id: string, client: ClientRef, label: string): Promise<string> {
  const row = await prisma.clientCredential.findUnique({ where: { id }, select: { secret: true } });
  if (!row) throw new Error("credential vanished");
  const secret = openSecret(row.secret, id);
  const at = new Date();
  await prisma.auditLog.create({
    data: {
      organizationId: client.organizationId,
      actorId: principal.id,
      actorType: principal.role === "AI_AGENT" ? "AI" : "HUMAN",
      action: "CREDENTIAL_REVEALED",
      entityType: "ClientCredential",
      entityId: id,
      summary: `Revealed "${label}" for ${client.businessName}`,
      afterJson: JSON.stringify({ clientId: client.id, label, at: at.toISOString() }),
    },
  });
  await prisma.clientCredential.update({ where: { id }, data: { lastRevealedAt: at }, select: { id: true } });
  return secret;
}
