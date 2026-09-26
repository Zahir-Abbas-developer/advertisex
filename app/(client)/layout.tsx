import type { ReactNode } from "react";

import { notFound, redirect } from "next/navigation";

import { ClientShell } from "@/components/layout/ClientShell";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { authorize } from "@/modules/rbac/authorize";
import { requireClientPage } from "@/modules/rbac/server";

/**
 * The client portal. `requireClientPage` admits CLIENT logins only — staff
 * are sent to their own shell — and the account shown is resolved through
 * `authorize`, so a CLIENT only ever loads the one account they belong to.
 */
export default async function ClientLayout({ children }: { children: ReactNode }) {
  const principal = await requireClientPage();
  const user = await requireUser();

  const account = await prisma.user.findUnique({
    where: { id: principal.id },
    select: { mustChangePassword: true, avatarColor: true, name: true },
  });
  if (account?.mustChangePassword) redirect("/change-password");

  const clientAccount = principal.clientAccountId
    ? await prisma.clientAccount.findUnique({
        where: { id: principal.clientAccountId },
        select: { id: true, name: true, organizationId: true, status: true },
      })
    : null;

  if (
    !clientAccount ||
    clientAccount.status !== "ACTIVE" ||
    !authorize(principal, "read", "clientAccount", {
      organizationId: clientAccount.organizationId,
      clientAccountId: clientAccount.id,
    }).allowed
  ) {
    notFound();
  }

  return (
    <ClientShell
      accountName={clientAccount.name}
      user={{ name: account?.name ?? user.name ?? "You", avatarColor: account?.avatarColor ?? "#D4AF37" }}
    >
      {children}
    </ClientShell>
  );
}
