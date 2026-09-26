import { FileText, FolderKanban, Receipt } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { prisma } from "@/lib/prisma";
import { requireClientPage } from "@/modules/rbac/server";

export const metadata = { title: "Overview · Advertise X" };

/**
 * The client portal's overview — a placeholder dashboard built from real
 * components and real, scoped data (Phase 1 scope 8). Projects and reports
 * are counted from the records linked to this client's own account; nothing
 * here is invented. The detailed portal screens arrive in a later phase.
 */
export default async function PortalOverview() {
  const principal = await requireClientPage();

  // client-own scope, expressed as the query: only records whose CRM client
  // belongs to this login's account, inside its organization.
  const scope = {
    clientAccountId: principal.clientAccountId ?? "__none__",
    organizationId: principal.organizationId ?? "__none__",
  };

  const [activeProjects, reports] = await Promise.all([
    prisma.project.count({
      where: { client: scope, status: { in: ["PLANNING", "ACTIVE"] } },
    }),
    prisma.report.count({ where: { client: scope } }),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Overview</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">
          Welcome back
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/60">
          Everything your Advertise X team is doing for you will appear here — your projects,
          your results and your invoices, in one place.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active projects" value={String(activeProjects)} icon={FolderKanban} />
        <StatCard label="Reports shared" value={String(reports)} icon={FileText} />
        <StatCard label="Open invoices" value="—" hint="Invoices arrive here soon" icon={Receipt} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <EmptyState
            title="Your projects will appear here"
            description="Once your team starts work, you'll see each project's progress and what's coming next."
          />
        </Card>
        <Card padded={false}>
          <EmptyState
            title="Your results will appear here"
            description="Performance reports from your campaigns will be shared here as soon as they're ready."
          />
        </Card>
      </div>
    </div>
  );
}
