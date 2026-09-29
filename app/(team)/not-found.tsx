import Link from "next/link";
import { Compass } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** A record that doesn't exist (or isn't yours to see) — inside the app, with the way back. */
export default function NotFound() {
  return (
    <div className="rounded-card border border-line bg-surface">
      <EmptyState
        icon={Compass}
        title="This isn't here"
        description="It may have been removed, or it isn't one you have access to."
        action={
          <Link href="/dashboard" className={buttonClasses("primary", "md")}>
            Back to the dashboard
          </Link>
        }
      />
    </div>
  );
}
