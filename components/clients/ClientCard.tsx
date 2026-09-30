import Link from "next/link";
import { ArrowUpRight, Globe2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from "@/lib/constants";
import { formatDate } from "@/lib/date";
import type { ClientSummary } from "@/lib/types";
import { HEALTH_LABEL } from "@/modules/clients/health";
import { SCHEDULE_LABEL } from "@/modules/projects/domain";

const HEALTH_COLOR = { HEALTHY: "#279D61", WATCH: "#D97706", AT_RISK: "#DC2626" } as const;

/** Compact money — a retainer book reads better as $4.5k than $4,500. */
function formatBudget(amount: number): string {
  if (amount >= 1000) {
    const thousands = amount / 1000;
    return `$${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return `$${amount}`;
}

export function ClientCard({ client }: { client: ClientSummary }) {
  const project = client.currentProject;

  return (
    /* `min-w-0` because the card is a grid item, and a grid item's automatic
       minimum width is its content's — here, the full un-truncated business
       name beside a column of labels that never wrap. On a phone that made the
       single column 48px wider than the screen, the whole Clients page scrolled
       sideways, and the `truncate` below never got the chance to truncate. */
    <Link
      href={`/clients/${client.id}`}
      className="group flex min-w-0 flex-col rounded-card border border-line bg-surface p-5 transition-colors hover:border-ink/20 focus-visible:border-ink/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate font-display text-[17px] font-bold tracking-tight text-ink">
            {/* Computed health, never entered. A dot rather than a number:
                the card is a glance, and the number is on the client page. */}
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: HEALTH_COLOR[client.health.band] }}
              title={`${HEALTH_LABEL[client.health.band]}${client.health.reasons[0] ? ` — ${client.health.reasons[0]}` : ""}`}
            />
            <span className="truncate">{client.businessName}</span>
          </h2>
          <p className="mt-1 truncate text-[13px] text-ink-muted">
            {client.industry ?? "Industry not set"}
          </p>
          {/* Which business line owns this account — the first thing that
              distinguishes two otherwise similar cards. */}
          {client.department && (
            <div className="mt-2">
              <Badge size="sm" tone="neutral">
                {client.department.shortLabel}
              </Badge>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge dot tone={CLIENT_STATUS_TONE[client.status]}>
            {CLIENT_STATUS_LABEL[client.status]}
          </Badge>

          {client.assignee && (
            <span className="text-[11px] text-ink-muted">{client.assignee.name}</span>
          )}

        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 text-[13px] text-ink-muted">
        {client.monthlyRecurring !== null && (
          <span className="font-display text-base font-bold tabular-nums text-ink">
            {formatBudget(client.monthlyRecurring)}
            <span className="ml-1 text-[11px] font-medium text-ink-muted">/mo</span>
          </span>
        )}
        <span className="tabular-nums">
          {client.openProjects} open project{client.openProjects === 1 ? "" : "s"}
        </span>
        {client.country && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Globe2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            <span className="truncate">{client.country}</span>
          </span>
        )}
      </div>

      {client.services.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {client.services.slice(0, 3).map((service) => (
            <Badge key={service.id} size="sm" tone="neutral">
              {shortServiceName(service.name)}
            </Badge>
          ))}
          {client.services.length > 3 && (
            <Badge size="sm" tone="neutral">
              +{client.services.length - 3}
            </Badge>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-ink-muted">No services purchased yet</p>
      )}

      <div className="mt-auto pt-5">
        {project ? (
          <>
            <ProgressBar
              value={project.progress}
              label={project.title}
              showValue
              size="sm"
              tone={project.schedule === "OVERDUE" ? "danger" : project.schedule === "BEHIND" ? "warn" : "brand"}
            />
            <p className="mt-2 text-[12px] text-ink-muted">
              {SCHEDULE_LABEL[project.schedule]} · due {formatDate(project.deadline)}
            </p>
          </>
        ) : (
          <div className="flex items-center justify-between rounded-[10px] border border-dashed border-line px-3 py-2.5">
            <span className="text-[13px] text-ink-muted">No open project</span>
            <ArrowUpRight
              aria-hidden
              className="h-3.5 w-3.5 text-ink-muted transition-colors group-hover:text-brand"
            />
          </div>
        )}
      </div>
    </Link>
  );
}

/** "Shopify Design & Development" -> "Shopify" for the card's badge row. */
function shortServiceName(name: string): string {
  return name.split(/[&(]/)[0].replace(/design|management|research/i, "").trim() || name;
}
