"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Globe, Mail, MapPin, Pencil, Phone, Pin, Plus } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
import { FilesPanel } from "@/components/files/FilesPanel";
import { CredentialsPanel } from "@/components/clients/CredentialsPanel";
import { ClientProjectsPanel } from "@/components/clients/ClientProjectsPanel";
import { ClientServicesPanel } from "@/components/clients/ClientServicesPanel";
import { ClientInvoicesPanel } from "@/components/billing/ClientInvoicesPanel";
import dynamic from "next/dynamic";

/** The Results tab's charts load when the tab is opened, not with the page (Phase 10). */
const ClientResultsPanel = dynamic(() => import("@/components/clients/ClientResultsPanel").then((m) => m.ClientResultsPanel), {
  loading: () => <div className="h-64 animate-pulse rounded-card bg-surface-2" aria-busy="true" aria-label="Loading results" />,
});
import { ContractsPanel } from "@/components/clients/ContractsPanel";
import { NotesPanel } from "@/components/clients/NotesPanel";
import { ClientReportsPanel } from "@/components/clients/ClientReportsPanel";
import { PortalUsersPanel } from "@/components/clients/PortalUsersPanel";
import { MessagesView } from "@/components/messages/MessagesView";
import { NewProjectModal } from "@/components/projects/shared/NewProjectModal";
import { ClientEditModal, type ClientRecord } from "@/components/clients/ClientEditModal";
import { progressTone, ScheduleBadge } from "@/components/projects/shared/badges";
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE, type ClientStatus } from "@/lib/constants";
import { formatDate } from "@/lib/date";
import { HEALTH_LABEL, HEALTH_TONE } from "@/modules/clients/health";
import type { ClientOverview } from "@/modules/clients/overview";

export type ClientProfileData = {
  client: {
    id: string;
    businessName: string;
    contactName: string;
    email: string;
    phone: string | null;
    website: string | null;
    location: string | null;
    country: string | null;
    industry: string | null;
    tags: string[];
    status: ClientStatus;
    notes: string | null;
    onboardedAt: string;
    department: { id: string; shortLabel: string };
    hasPortal: boolean;
  };
  overview: ClientOverview;
  team: { id: string; name: string; avatarColor: string; jobTitle: string | null; role: string }[];
  pinnedNotes: { id: string; body: string; updatedAt: string; author: string | null }[];
  reports: { id: string; type: string; periodStart: string; periodEnd: string }[];
  billing: { monthlyRecurring: number; oneTime: number; activeServices: number; contractedValue: number; annualRunRate: number } | null;
  /** The founder's edit form; null for everyone else. */
  editRecord: ClientRecord | null;
  viewer: { id: string; isFounder: boolean; canEdit: boolean; canManageContracts: boolean; canCreateProject: boolean; canSeeCredentials: boolean };
};

type Tab = "overview" | "projects" | "services" | "results" | "contracts" | "files" | "logins" | "notes" | "communication" | "reports" | "portal";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * The client profile — the single source of truth for a client (Phase 4
 * scope 1). Billing, reports and messaging wire into later phases; each
 * section says what it shows today rather than pretending.
 */
const TABS: readonly Tab[] = ["overview", "projects", "services", "results", "contracts", "files", "logins", "notes", "communication", "reports", "portal"];

export function ClientProfile({ data, initialTab }: { data: ClientProfileData; initialTab?: string }) {
  const { client, overview, viewer } = data;
  // A notification can open a tab directly ("…?tab=reports" for a report
  // awaiting review). Read on the server and passed in, so the server and the
  // browser render the same tab.
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t === initialTab) ?? "overview");
  const [newProject, setNewProject] = useState(false);
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "projects", label: "Projects", count: overview.openProjects },
    { key: "services", label: viewer.isFounder ? "Services & billing" : "Services" },
    { key: "results", label: "Results" },
    { key: "contracts", label: "Contracts" },
    { key: "files", label: "Files" },
    ...(viewer.canSeeCredentials ? [{ key: "logins" as const, label: "Logins" }] : []),
    { key: "notes", label: "Notes" },
    { key: "communication", label: "Messages" },
    { key: "reports", label: "Reports" },
    ...(viewer.canManageContracts ? [{ key: "portal" as const, label: "Portal access" }] : []),
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={client.department.shortLabel}
        title={client.businessName}
        description={[client.industry, client.location ?? client.country].filter(Boolean).join(" · ") || undefined}
        actions={
          viewer.canCreateProject || data.editRecord ? (
            <>
              {data.editRecord && (
                <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  Edit client
                </Button>
              )}
              {viewer.canCreateProject && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewProject(true)}>
                  New project
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge dot tone={CLIENT_STATUS_TONE[client.status]}>
            {CLIENT_STATUS_LABEL[client.status]}
          </Badge>
          <Badge dot tone={HEALTH_TONE[overview.health.band]}>
            {HEALTH_LABEL[overview.health.band]}
          </Badge>
          {client.tags.map((t) => (
            <Badge key={t} size="sm">
              {t}
            </Badge>
          ))}
          <span className="text-[12px] text-ink-muted">Client since {formatDate(client.onboardedAt)}</span>
        </div>
      </PageHeader>

      <Tabs items={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && <Overview data={data} onOpen={setTab} />}
      {tab === "projects" && <ClientProjectsPanel clientId={client.id} canCreate={viewer.canCreateProject} onNew={() => setNewProject(true)} />}
      {tab === "services" && (
        <div className="space-y-6">
          <ClientServicesPanel clientId={client.id} billing={data.billing} />
          {viewer.isFounder && <ClientInvoicesPanel clientId={client.id} />}
        </div>
      )}
      {tab === "results" && <ClientResultsPanel clientId={client.id} />}
      {tab === "contracts" && <ContractsPanel clientId={client.id} />}
      {tab === "files" && (
        <Card padded={false}>
          <CardBody>
            <FilesPanel owner={{ clientId: client.id }} canUpload={viewer.canEdit} canChangeVisibility={viewer.canManageContracts} viewerId={viewer.id} />
          </CardBody>
        </Card>
      )}
      {tab === "logins" && viewer.canSeeCredentials && (
        <Card padded={false}>
          <CardBody>
            <CredentialsPanel clientId={client.id} />
          </CardBody>
        </Card>
      )}
      {tab === "notes" && <NotesPanel clientId={client.id} canEdit={viewer.canEdit} viewerId={viewer.id} isManager={viewer.canManageContracts} />}
      {tab === "communication" && (
        <div className="space-y-6">
          <MessagesView audience="team" clientId={client.id} />
          <Card padded={false}>
            <CardHeader title="Contact history" description="Calls, emails, meetings and notes with this client, including everything from before they signed." />
            <CardBody>
              <ActivityTimeline clientId={client.id} viewerId={viewer.id} isAdmin={viewer.isFounder} />
            </CardBody>
          </Card>
        </div>
      )}
      {tab === "reports" && <ClientReportsPanel clientId={client.id} />}
      {tab === "portal" && viewer.canManageContracts && <PortalUsersPanel clientId={client.id} />}

      {viewer.canCreateProject && <NewProjectModal open={newProject} onClose={() => setNewProject(false)} clientId={client.id} />}
      {data.editRecord && (
        <ClientEditModal
          open={editing}
          client={data.editRecord}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Overview({ data, onOpen }: { data: ClientProfileData; onOpen: (t: Tab) => void }) {
  const { client, overview } = data;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        {data.billing && (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Monthly recurring" value={money(data.billing.monthlyRecurring)} hint={`${data.billing.activeServices} active service${data.billing.activeServices === 1 ? "" : "s"}`} />
            <StatCard label="One-time work" value={money(data.billing.oneTime)} hint="Not yet ended" />
            <StatCard label="Contracted" value={money(data.billing.contractedValue)} hint="Signed and active contracts" />
          </div>
        )}

        <Card padded={false}>
          <CardHeader
            title="Project progress"
            action={
              <button type="button" onClick={() => onOpen("projects")} className="text-[13px] text-brand hover:underline">
                All projects
              </button>
            }
          />
          <CardBody>
            {overview.currentProject ? (
              <Link href={`/projects/${overview.currentProject.id}`} className="group block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="truncate text-[14px] font-medium text-ink group-hover:text-brand">{overview.currentProject.title}</span>
                  <ScheduleBadge schedule={overview.currentProject.schedule} />
                </div>
                <ProgressBar value={overview.currentProject.progress} showValue tone={progressTone(overview.currentProject.schedule)} />
                <p className="mt-2 text-[12px] text-ink-muted">
                  Due {formatDate(overview.currentProject.deadline)}
                  {overview.openProjects > 1 ? ` · ${overview.openProjects - 1} more open project${overview.openProjects > 2 ? "s" : ""}` : ""}
                </p>
              </Link>
            ) : (
              <EmptyState title="No open project" description="Start one to plan the work, its stages and its team." className="py-6" />
            )}
          </CardBody>
        </Card>

        <Card padded={false}>
          <CardHeader title="Health" description="Computed from delivery, schedules and contracts — never typed in." />
          <CardBody>
            <div className="flex items-start gap-3">
              <Badge dot tone={HEALTH_TONE[overview.health.band]}>
                {HEALTH_LABEL[overview.health.band]}
              </Badge>
              {overview.health.reasons.length ? (
                <ul className="space-y-1 text-[13px] text-ink-2">
                  {overview.health.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-muted">Nothing late, nothing overdue, no contract about to lapse.</p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card padded={false}>
          <CardHeader
            title="Important notes"
            action={
              <button type="button" onClick={() => onOpen("notes")} className="text-[13px] text-brand hover:underline">
                All notes
              </button>
            }
          />
          <CardBody>
            {data.pinnedNotes.length || client.notes ? (
              <ul className="space-y-3">
                {client.notes && <li className="text-[13px] leading-relaxed text-ink/80">{client.notes}</li>}
                {data.pinnedNotes.map((n) => (
                  <li key={n.id} className="flex gap-2 text-[13px] leading-relaxed text-ink/80">
                    <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-brand" />
                    <span>
                      {n.body}
                      <span className="block text-[11px] text-ink-muted">
                        {n.author ?? "Someone"} · {formatDate(n.updatedAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-muted">Pin a note to keep it here — allergies, the owner&apos;s preferences, what not to do.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="min-w-0 space-y-6">
        <Card padded={false}>
          <CardHeader title="Contact" />
          <CardBody className="space-y-2.5 text-[13px]">
            <p className="font-medium text-ink">{client.contactName}</p>
            <a href={`mailto:${client.email}`} className="flex items-center gap-2 text-ink-2 hover:text-ink">
              <Mail className="h-3.5 w-3.5 text-ink-muted" /> {client.email}
            </a>
            {client.phone && (
              <a href={`tel:${client.phone}`} className="flex items-center gap-2 text-ink-2 hover:text-ink">
                <Phone className="h-3.5 w-3.5 text-ink-muted" /> {client.phone}
              </a>
            )}
            {client.website && (
              <a href={client.website.startsWith("http") ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 text-ink-2 hover:text-ink">
                <Globe className="h-3.5 w-3.5 text-ink-muted" /> {client.website} <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
            {(client.location || client.country) && (
              <p className="flex items-center gap-2 text-ink-2">
                <MapPin className="h-3.5 w-3.5 text-ink-muted" /> {[client.location, client.country].filter(Boolean).join(", ")}
              </p>
            )}
            <p className="pt-1 text-[12px] text-ink-muted">{client.hasPortal ? "Has a client portal login" : "No portal login yet"}</p>
          </CardBody>
        </Card>

        <Card padded={false}>
          <CardHeader title="Assigned team" />
          <CardBody>
            {data.team.length ? (
              <ul className="space-y-3">
                {data.team.map((m) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <Avatar name={m.name} color={m.avatarColor} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{m.name}</span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {m.role}
                        {m.jobTitle ? ` · ${m.jobTitle}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-muted">No one is assigned yet.</p>
            )}
          </CardBody>
        </Card>

        <Card padded={false}>
          <CardHeader title="Services" />
          <CardBody>
            {overview.services.length ? (
              <div className="flex flex-wrap gap-1.5">
                {overview.services.map((s) => (
                  <Badge key={s.id} size="sm">
                    {s.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-muted">No active services.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
