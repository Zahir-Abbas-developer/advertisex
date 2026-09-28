"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ROLE_LABEL, type Role } from "@/config/permissions";
import { cn } from "@/lib/utils";

type Member = {
  id: string;
  name: string;
  role: Role;
  isAgent: boolean;
  jobTitle: string;
  avatarColor: string;
  employmentStatus: string;
  departments: { id: string; shortLabel: string }[];
  skills: { name: string; proficiency: number }[];
};

const STATUS_TONE = { ACTIVE: "success", ON_LEAVE: "warning", INACTIVE: "neutral" } as const;
const STATUS_LABEL = { ACTIVE: "Active", ON_LEAVE: "On leave", INACTIVE: "Inactive" } as const;

/** Proficiency 1–5 as five dots — precise without a number to parse. */
export function Proficiency({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`Proficiency ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cn("h-1.5 w-1.5 rounded-full", n <= value ? "bg-ink/70" : "bg-ink/15")} />
      ))}
    </span>
  );
}

function MemberCard({ member }: { member: Member }) {
  return (
    <Link
      href={`/team/${member.id}`}
      className={cn(
        "group block min-w-0 rounded-card border bg-surface p-5 transition-colors hover:bg-surface-2",
        member.isAgent ? "border-data-2/25 hover:border-data-2/45" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-start gap-3">
        {member.isAgent ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-info/30 bg-info-tint text-ink-2">
            <Bot className="h-5 w-5" />
          </span>
        ) : (
          <Avatar name={member.name} color={member.avatarColor} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-display text-[15px] font-semibold text-ink">{member.name}</p>
            {member.isAgent ? (
              <span className="rounded-pill border border-info/30 bg-info-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-2">
                AI agent
              </span>
            ) : (
              member.employmentStatus !== "ACTIVE" && (
                <Badge tone={STATUS_TONE[member.employmentStatus as keyof typeof STATUS_TONE] ?? "neutral"} size="sm">
                  {STATUS_LABEL[member.employmentStatus as keyof typeof STATUS_LABEL] ?? member.employmentStatus}
                </Badge>
              )
            )}
          </div>
          <p className="truncate text-[13px] text-ink-muted">
            {member.jobTitle}
            {!member.isAgent && ` · ${ROLE_LABEL[member.role]}`}
          </p>
        </div>
      </div>

      {member.departments.length > 0 && (
        <p className="mt-3 truncate text-[12px] text-ink-muted">{member.departments.map((d) => d.shortLabel).join(" · ")}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {member.skills.slice(0, 3).map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
            {s.name} <Proficiency value={s.proficiency} />
          </span>
        ))}
        {member.skills.length === 0 && <span className="text-[12px] text-ink/35">No skills recorded yet</span>}
      </div>
    </Link>
  );
}

export function TeamDirectory() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/employees", { cache: "no-store" });
      if (!res.ok) return setFailed(true);
      setMembers((await res.json()).members);
    })();
  }, []);

  if (failed) return <ErrorState title="The team didn't load" description="Try again in a moment." onRetry={() => location.reload()} />;
  if (!members) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[148px] rounded-card" />
        ))}
      </div>
    );
  }

  const people = members.filter((m) => !m.isAgent);
  const agents = members.filter((m) => m.isAgent);

  if (members.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState title="No one on your team yet" description="People you add from Accounts appear here with their skills and status." />
      </Card>
    );
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          People <span className="text-ink/35 tabular-nums">{people.length}</span>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((m) => (
            <MemberCard key={m.id} member={m} />
          ))}
        </div>
      </section>

      {agents.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              AI agents <span className="text-ink/35 tabular-nums">{agents.length}</span>
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Agents take assigned work and are measured on delivery. They have no attendance, and act only within the capabilities granted to them.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((m) => (
              <MemberCard key={m.id} member={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
