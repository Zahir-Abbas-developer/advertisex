"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { ErrorState } from "@/components/ui/EmptyState";
import { reportClientError } from "@/lib/report-error";

/** Sign-in, invitations and the password change: a failure here still gets a way forward. */
export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    console.error(error);
    void reportClientError(pathname, error);
  }, [error, pathname]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-card border border-line bg-surface">
        <ErrorState title="This page didn't load" description="Something interrupted it. Try again — if it keeps happening, sign in from the start." onRetry={reset} />
      </div>
    </main>
  );
}
