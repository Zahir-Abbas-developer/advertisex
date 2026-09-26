"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { ErrorState } from "@/components/ui/EmptyState";
import { reportClientError } from "@/lib/report-error";

/**
 * The portal's error boundary. Reported to the Advertise X team the same way
 * as the staff pages' — but worded for a client: no internal names, no logs.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error(error);
    void reportClientError(pathname, error);
  }, [error, pathname]);

  return (
    <div className="rounded-card border border-line bg-surface">
      <ErrorState
        title="Something went wrong on our side"
        description="This page didn't load. Our team has been notified automatically — please try again in a moment."
        onRetry={reset}
      />
    </div>
  );
}
