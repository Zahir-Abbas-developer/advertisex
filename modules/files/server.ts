import "server-only";
import { createHmac } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { taskAccess } from "@/modules/tasks/server";
import { canOnProject } from "@/modules/projects/server";
import { canPreview, SIGNED_URL_TTL_SECONDS, signFile, type Disposition } from "@/modules/files/signing";

/**
 * Files on the server (Phase 4 scope 5). A file belongs to exactly one thing
 * — a task, a client, a project or a contract — and whoever may see that
 * thing may see the file. A CLIENT login sees a file only when it is marked
 * for the client ("CLIENT" visibility) and belongs to its own account.
 *
 * Bytes are never served by id alone: the app issues short-lived signed URLs
 * (modules/files/signing.ts) after this check, and /f/[id] honours only those.
 */

export const FILE_VISIBILITIES = ["INTERNAL", "CLIENT"] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];

/** The HMAC key for file URLs: FILE_URL_SECRET, or derived from NEXTAUTH_SECRET. */
export function fileUrlSecret(): Buffer {
  const own = process.env.FILE_URL_SECRET;
  const base = own ?? process.env.NEXTAUTH_SECRET;
  if (!base) {
    if (process.env.NODE_ENV === "production") throw new Error("FILE_URL_SECRET or NEXTAUTH_SECRET must be set");
    return createHmac("sha256", "advertisex-dev").update("file-urls").digest();
  }
  return createHmac("sha256", base).update("advertisex:file-urls").digest();
}

export function signedUrl(fileId: string, disposition: Disposition, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS;
  const s = signFile(fileId, expires, disposition, fileUrlSecret());
  return `/f/${fileId}?e=${expires}&d=${disposition}&s=${s}`;
}

const CLIENT_REF = { select: { id: true, organizationId: true, departmentId: true, clientAccountId: true } } as const;

const FILE_INCLUDE = {
  client: CLIENT_REF,
  project: { select: { id: true, organizationId: true, client: CLIENT_REF } },
  contract: { select: { id: true, client: CLIENT_REF } },
  uploader: { select: { id: true, name: true } },
} as const;

export type FileOwner =
  | { kind: "task"; id: string }
  | { kind: "client"; id: string }
  | { kind: "project"; id: string }
  | { kind: "contract"; id: string };

export function ownerFromQuery(params: URLSearchParams | FormData): FileOwner | null {
  const get = (k: string) => {
    const v = params.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const owners: FileOwner[] = [];
  for (const kind of ["client", "project", "contract"] as const) {
    const id = get(`${kind}Id`);
    if (id) owners.push({ kind, id });
  }
  return owners.length === 1 ? owners[0] : null;
}

type ClientRef = { id: string; organizationId: string | null; departmentId: string; clientAccountId: string | null };

function clientAllows(principal: Principal, mode: "read" | "write", c: ClientRef): boolean {
  if (principal.role === "CLIENT") return mode === "read" && c.clientAccountId != null && c.clientAccountId === principal.clientAccountId;
  return authorize(principal, mode === "read" ? "read" : "update", "client", {
    organizationId: c.organizationId,
    departmentId: c.departmentId,
    clientId: c.id,
  }).allowed;
}

/**
 * May the principal see (read) or add to / change (write) the files of this
 * owner? Unknown owners and owners outside scope are both "not found".
 */
export async function ownerAccess(principal: Principal, owner: FileOwner, mode: "read" | "write"): Promise<{ ok: boolean; status: number; clientId: string | null }> {
  if (owner.kind === "task") {
    if (principal.role === "CLIENT") return { ok: false, status: 404, clientId: null };
    const a = await taskAccess(principal, owner.id, mode);
    return { ok: a.ok, status: a.ok ? 200 : a.status, clientId: null };
  }
  if (owner.kind === "project") {
    const p = await prisma.project.findUnique({ where: { id: owner.id }, select: { id: true, organizationId: true, client: CLIENT_REF } });
    if (!p) return { ok: false, status: 404, clientId: null };
    if (principal.role === "CLIENT") {
      return { ok: clientAllows(principal, mode, p.client), status: 404, clientId: p.client.id };
    }
    const ok = canOnProject(principal, mode === "read" ? "read" : "update", p);
    return { ok, status: ok ? 200 : 404, clientId: p.client.id };
  }
  const c =
    owner.kind === "client"
      ? await prisma.client.findUnique({ where: { id: owner.id }, ...CLIENT_REF })
      : (await prisma.contract.findUnique({ where: { id: owner.id }, select: { client: CLIENT_REF } }))?.client ?? null;
  if (!c) return { ok: false, status: 404, clientId: null };
  const ok = clientAllows(principal, mode, c);
  return { ok, status: ok ? 200 : 404, clientId: c.id };
}

export function ownerOf(file: { taskId: string | null; clientId: string | null; projectId: string | null; contractId: string | null }): FileOwner | null {
  if (file.taskId) return { kind: "task", id: file.taskId };
  if (file.projectId) return { kind: "project", id: file.projectId };
  if (file.contractId) return { kind: "contract", id: file.contractId };
  if (file.clientId) return { kind: "client", id: file.clientId };
  return null;
}

/** Loads a file the principal may access, or null (never reveals why). */
export async function fileFor(principal: Principal, fileId: string, mode: "read" | "write") {
  const file = await prisma.file.findUnique({ where: { id: fileId }, include: FILE_INCLUDE });
  if (!file) return null;
  const owner = ownerOf(file);
  if (!owner) return null;
  if (principal.role === "CLIENT" && (mode !== "read" || file.visibility !== "CLIENT")) return null;
  const access = await ownerAccess(principal, owner, mode);
  return access.ok ? file : null;
}

export type FileView = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  visibility: string;
  createdAt: string;
  uploader: { id: string; name: string } | null;
  previewUrl: string | null;
  downloadUrl: string;
};

export function toView(file: {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  visibility: string;
  createdAt: Date;
  uploader?: { id: string; name: string } | null;
}): FileView {
  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    visibility: file.visibility,
    createdAt: file.createdAt.toISOString(),
    uploader: file.uploader ?? null,
    previewUrl: canPreview(file.mimeType) ? signedUrl(file.id, "inline") : null,
    downloadUrl: signedUrl(file.id, "attachment"),
  };
}

export const ownerWhere = (owner: FileOwner) =>
  owner.kind === "task"
    ? { taskId: owner.id }
    : owner.kind === "client"
      ? { clientId: owner.id }
      : owner.kind === "project"
        ? { projectId: owner.id }
        : { contractId: owner.id };
