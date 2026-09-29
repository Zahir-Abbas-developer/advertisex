import "server-only";

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { storedRoleValues } from "@/config/permissions";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { toView, type FileView } from "@/modules/files/server";

/**
 * Client–team messaging (Phase 6 scope 6).
 *
 * Each client has a TEAM thread (the client and the team working for them)
 * and a private FOUNDER thread (the client and the founders — no one else).
 * Who may see a thread:
 *   - the client's own logins: both of their threads;
 *   - a founder: every thread in the organization;
 *   - a manager or employee: TEAM threads of clients the `message`
 *     permission gives them (their departments' / the clients they work for);
 *     never a FOUNDER thread.
 */

export type ThreadRef = {
  id: string;
  kind: string;
  organizationId: string;
  client: { id: string; organizationId: string | null; departmentId: string; clientAccountId: string | null };
};

export function canSeeThread(principal: Principal, t: ThreadRef): boolean {
  if (principal.organizationId !== t.organizationId) return false;
  if (principal.role === "CLIENT") return principal.clientAccountId != null && t.client.clientAccountId === principal.clientAccountId;
  if (principal.role === "FOUNDER") return true;
  if (t.kind !== "TEAM") return false;
  return authorize(principal, "read", "message", { organizationId: t.client.organizationId, departmentId: t.client.departmentId, clientId: t.client.id }).allowed;
}

const THREAD_SELECT = {
  id: true,
  kind: true,
  subject: true,
  organizationId: true,
  projectId: true,
  lastMessageAt: true,
  client: { select: { id: true, businessName: true, organizationId: true, departmentId: true, clientAccountId: true } },
} as const;

/** Each client has its general TEAM thread and its FOUNDER thread; created on first use. */
export async function ensureThreads(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, organizationId: true } });
  if (!client?.organizationId) return;
  const existing = await prisma.messageThread.findMany({ where: { clientId, projectId: null }, select: { kind: true } });
  const have = new Set(existing.map((e) => e.kind));
  if (!have.has("TEAM")) await prisma.messageThread.create({ data: { organizationId: client.organizationId, clientId, kind: "TEAM", subject: "Your team" } });
  if (!have.has("FOUNDER")) await prisma.messageThread.create({ data: { organizationId: client.organizationId, clientId, kind: "FOUNDER", subject: "Private — founders" } });
}

export async function threadFor(principal: Principal, threadId: string) {
  const t = await prisma.messageThread.findUnique({ where: { id: threadId }, select: THREAD_SELECT });
  if (!t || !canSeeThread(principal, t)) return null;
  return t;
}

/** Threads this principal may see (optionally for one client), with unread counts. */
export async function threadsFor(principal: Principal, filter: { clientId?: string } = {}) {
  let clientIds: string[] | undefined;
  if (principal.role === "CLIENT") {
    const clients = await prisma.client.findMany({ where: { clientAccountId: principal.clientAccountId ?? "__none__" }, select: { id: true } });
    clientIds = clients.map((c) => c.id);
    for (const id of clientIds) await ensureThreads(id);
  } else if (filter.clientId) {
    await ensureThreads(filter.clientId);
  }
  const rows = await prisma.messageThread.findMany({
    where: {
      ...(clientIds ? { clientId: { in: clientIds } } : {}),
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(principal.role === "FOUNDER" || principal.role === "CLIENT" ? {} : { kind: "TEAM" }),
    },
    orderBy: { lastMessageAt: "desc" },
    take: 300,
    select: { ...THREAD_SELECT, _count: { select: { messages: true } } },
  });
  const visible = rows.filter((t) => canSeeThread(principal, t));
  const reads = await prisma.threadRead.findMany({ where: { userId: principal.id, threadId: { in: visible.map((t) => t.id) } }, select: { threadId: true, lastReadAt: true } });
  const unread = await Promise.all(
    visible.map((t) => {
      const since = reads.find((r) => r.threadId === t.id)?.lastReadAt ?? new Date(0);
      return prisma.message.count({ where: { threadId: t.id, createdAt: { gt: since }, authorId: { not: principal.id } } });
    }),
  );
  const last = await Promise.all(
    visible.map((t) => prisma.message.findFirst({ where: { threadId: t.id }, orderBy: { createdAt: "desc" }, select: { body: true, createdAt: true, author: { select: { name: true } } } })),
  );
  return visible.map((t, i) => ({
    id: t.id,
    kind: t.kind,
    subject: t.subject,
    client: { id: t.client.id, businessName: t.client.businessName },
    projectId: t.projectId,
    lastMessageAt: t.lastMessageAt.toISOString(),
    messages: t._count.messages,
    unread: unread[i],
    preview: last[i] ? { body: last[i]!.body.slice(0, 140), author: last[i]!.author?.name ?? null, at: last[i]!.createdAt.toISOString() } : null,
  }));
}

export type MessageView = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string; isClient: boolean } | null;
  mine: boolean;
  files: FileView[];
  /** Read receipts: who on the other side has read this. */
  seenBy: string[];
};

/** A thread's messages, marking it read for the viewer. */
export async function messagesFor(principal: Principal, threadId: string): Promise<MessageView[] | null> {
  const t = await threadFor(principal, threadId);
  if (!t) return null;
  const [messages, reads] = await Promise.all([
    prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: "asc" },
      take: 500,
      include: { author: { select: { id: true, name: true, avatarColor: true, role: true } }, files: { include: { uploader: { select: { id: true, name: true } } } } },
    }),
    prisma.threadRead.findMany({ where: { threadId }, include: { user: { select: { id: true, name: true, role: true } } } }),
  ]);
  await markRead(principal.id, threadId);
  const viewerIsClient = principal.role === "CLIENT";
  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    author: m.author ? { id: m.author.id, name: m.author.name, avatarColor: m.author.avatarColor, isClient: m.author.role === "CLIENT" } : null,
    mine: m.authorId === principal.id,
    files: m.files.map(toView),
    // Receipts show the other side: the team for a client, the client for the team.
    seenBy:
      m.authorId === principal.id
        ? reads
            .filter((r) => r.userId !== principal.id && r.lastReadAt >= m.createdAt && (r.user.role === "CLIENT") !== viewerIsClient)
            .map((r) => (viewerIsClient ? r.user.name.split(" ")[0] : r.user.name))
        : [],
  }));
}

export async function markRead(userId: string, threadId: string) {
  await prisma.threadRead.upsert({
    where: { threadId_userId: { threadId, userId } },
    create: { threadId, userId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

/**
 * Posts a message. Tells the other side: for a client's message, the team
 * on that client (TEAM) or the founders (FOUNDER); for the team's, the
 * client's logins who haven't turned message notifications off.
 */
export async function post(principal: Principal, t: NonNullable<Awaited<ReturnType<typeof threadFor>>>, body: string) {
  const message = await prisma.message.create({ data: { threadId: t.id, authorId: principal.id, body } });
  await prisma.messageThread.update({ where: { id: t.id }, data: { lastMessageAt: message.createdAt } });
  await markRead(principal.id, t.id);

  const author = await prisma.user.findUnique({ where: { id: principal.id }, select: { name: true } });
  const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
  const recipients = new Set<string>();
  let href = "/messages";
  if (principal.role === "CLIENT") {
    href = `/messages?thread=${t.id}`;
    const founders = await prisma.user.findMany({ where: { isActive: true, organizationId: t.organizationId, role: { in: storedRoleValues("FOUNDER") } }, select: { id: true } });
    if (t.kind === "FOUNDER") founders.forEach((f) => recipients.add(f.id));
    else {
      const client = await prisma.client.findUnique({ where: { id: t.client.id }, select: { assigneeId: true } });
      if (client?.assigneeId) recipients.add(client.assigneeId);
      const members = await prisma.projectMember.findMany({
        where: { project: { clientId: t.client.id, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } }, user: { isActive: true } },
        select: { userId: true },
      });
      members.forEach((m) => recipients.add(m.userId));
      if (recipients.size === 0) founders.forEach((f) => recipients.add(f.id));
    }
  } else {
    href = `/portal/messages?thread=${t.id}`;
    const clientUsers = await prisma.user.findMany({
      where: { isActive: true, role: "CLIENT", clientAccountId: t.client.clientAccountId ?? "__none__" },
      select: { id: true },
    });
    // Preferences (muting messages) are applied by notify().
    clientUsers.forEach((u) => recipients.add(u.id));
  }
  recipients.delete(principal.id);
  for (const userId of recipients) {
    await notify({
      userId,
      type: "MESSAGE_RECEIVED",
      title: principal.role === "CLIENT" ? `${t.client.businessName}: new message` : `New message from ${author?.name ?? "your team"}`,
      body: preview,
      href,
    });
  }
  return message;
}
