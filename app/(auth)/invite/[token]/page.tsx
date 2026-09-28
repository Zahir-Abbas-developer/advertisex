import type { Metadata } from "next";
import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { AcceptInviteForm } from "@/components/portal/AcceptInviteForm";
import { hashToken } from "@/modules/portal/server";

export const metadata: Metadata = { title: "Your invitation" };

/**
 * Where a portal invitation lands (public — the token is the credential).
 * Nothing about the account is shown until the token checks out, and then
 * only the restaurant's name and the invited email.
 */
export default async function InvitePage({ params }: { params: { token: string } }) {
  const invite = await prisma.clientInvite.findUnique({
    where: { tokenHash: hashToken(params.token) },
    select: { email: true, name: true, acceptedAt: true, revokedAt: true, expiresAt: true, clientAccount: { select: { name: true } } },
  });
  const valid = invite && !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > new Date();

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand font-display text-sm font-bold text-canvas">A</span>
          <span className="eyebrow text-ink/50">Advertise X</span>
        </div>
        {valid ? (
          <>
            <h1 className="font-display text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">Welcome, {invite.name.split(" ")[0]}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              You&apos;ve been invited to follow <span className="text-ink">{invite.clientAccount.name}</span>&apos;s projects, reports and messages. Choose a password to finish.
            </p>
            <div className="mt-8">
              <AcceptInviteForm token={params.token} email={invite.email} name={invite.name} />
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">This link can&apos;t be used</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">
              {invite?.acceptedAt ? "It has already been used — sign in with the password you chose." : "It has expired or was withdrawn. Ask your Advertise X contact for a new invitation."}
            </p>
            <Link href="/login" className="mt-6 inline-block text-sm text-brand hover:underline">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
