import Link from "next/link";
import { Compass } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** Inside the portal, a missing page leads back to the portal — never to the team app. */
export default function PortalNotFound() {
  return (
    <div className="rounded-card border border-line bg-surface">
      <EmptyState
        icon={Compass}
        title="We couldn't find that"
        description="It may have been moved or removed. Everything we share with you is on your home page."
        action={
          <Link href="/portal" className={buttonClasses("primary", "md")}>
            Back to your home page
          </Link>
        }
      />
    </div>
  );
}
