"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Layers, Plus, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { ClientCard } from "@/components/clients/ClientCard";
import { ClientWizard } from "@/components/clients/ClientWizard";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, type ClientStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ClientSummary, ServiceSummary } from "@/lib/types";

type Filter = ClientStatus | "ALL";
type Status = "loading" | "ready" | "error";

const FILTERS: Filter[] = ["ALL", ...CLIENT_STATUSES];

export function ClientsBrowser({
  services,
  canOnboard,
}: {
  /** Active services, for the onboarding wizard. */
  services: ServiceSummary[];
  /** The founder onboards clients and runs the catalog; managers browse theirs. */
  canOnboard: boolean;
}) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [department, setDepartment] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/clients", { cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = (await response.json()) as { clients: ClientSummary[] };
      setClients(body.clients);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtering client-side: the whole book of business is a few dozen rows, and
  // a round trip per keystroke would be slower than the filter itself.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clients.filter((client) => {
      if (filter !== "ALL" && client.status !== filter) return false;
      if (department !== "ALL" && client.department?.id !== department) return false;
      if (!needle) return true;
      return (
        client.businessName.toLowerCase().includes(needle) ||
        client.contactName.toLowerCase().includes(needle) ||
        (client.industry ?? "").toLowerCase().includes(needle)
      );
    });
  }, [clients, filter, department, query]);

  /**
   * The chips are derived from the departments present in the response, not
   * from a constant. An admin sees every business line; when this list is
   * scoped to a member, they see theirs — and the chips cannot offer a filter
   * that would return nothing because the rows were never sent.
   */
  const departments = useMemo(() => {
    const seen = new Map<string, { id: string; shortLabel: string }>();
    for (const client of clients) {
      if (client.department && !seen.has(client.department.id)) {
        seen.set(client.department.id, {
          id: client.department.id,
          shortLabel: client.department.shortLabel,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.shortLabel.localeCompare(b.shortLabel));
  }, [clients]);

  const counts = useMemo(() => {
    const map = new Map<Filter, number>([["ALL", clients.length]]);
    for (const value of CLIENT_STATUSES) {
      map.set(value, clients.filter((client) => client.status === value).length);
    }
    return map;
  }, [clients]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Book of business"
        title="Clients"
        description="Every client, what they've bought, how their projects are tracking and how healthy the relationship is."
        actions={
          canOnboard ? (
            <>
              <Link href="/settings/services" className={buttonClasses("secondary", "md", "gap-2")}>
                <Layers className="h-4 w-4" />
                Services
              </Link>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
                Onboard client
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Business line first: which book of business am I looking at? The
          status chips below then narrow within it. Only rendered when there is
          a choice to make. */}
      {departments.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {[{ id: "ALL", shortLabel: "All departments" }, ...departments].map((option) => {
            const active = department === option.id;
            const count =
              option.id === "ALL"
                ? clients.length
                : clients.filter((client) => client.department?.id === option.id).length;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setDepartment(option.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                  active
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line bg-surface text-ink-muted hover:border-ink/25 hover:text-ink",
                )}
              >
                {option.shortLabel}
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    active ? "text-ink-muted" : "text-ink-muted",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((value) => {
            const active = filter === value;
            const count = counts.get(value) ?? 0;

            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                  active
                    ? "border-brand/50 bg-brand-tint text-brand"
                    : "border-line bg-surface text-ink-muted hover:border-ink/25 hover:text-ink",
                )}
              >
                {value === "ALL" ? "All" : CLIENT_STATUS_LABEL[value]}
                <span className={cn("text-[11px] tabular-nums", active ? "text-ink-muted" : "text-ink-muted")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="w-full sm:w-64">
          <Input
            placeholder="Search clients"
            icon={<Search className="h-4 w-4" />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search clients"
          />
        </div>
      </div>

      {status === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[248px] rounded-card" />
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-card border border-line bg-surface">
          <ErrorState
            title="Couldn't load your clients"
            description="The client list didn't come back. This is usually temporary."
            onRetry={() => void load()}
          />
        </div>
      )}

      {status === "ready" && clients.length === 0 && (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={Building2}
            eyebrow="No clients yet"
            title={canOnboard ? "Onboard your first client" : "No clients in your departments yet"}
            description={
              canOnboard
                ? "Capture their details, pick the services they've bought, and Advertise X plans the first project for you."
                : "Clients appear here once a deal in your departments is won."
            }
            action={
              canOnboard ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
                  Onboard a client
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      {status === "ready" && clients.length > 0 && visible.length === 0 && (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={SlidersHorizontal}
            eyebrow="No matches"
            title="Nothing fits those filters"
            description="Try a different status, or clear the search to see the whole book again."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setFilter("ALL");
                  setDepartment("ALL");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      )}

      {status === "ready" && visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
        </div>
      )}

      {canOnboard && (
        <ClientWizard
          open={wizardOpen}
          services={services}
          onClose={() => {
            setWizardOpen(false);
          }}
        />
      )}
    </div>
  );
}
