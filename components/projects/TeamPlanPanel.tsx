"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, Check, RefreshCw, Sparkles, UserCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/date";

type Person = { id: string; name: string; avatarColor: string; role: string };
type Role = {
  skillId: string;
  skillName: string;
  weight: number;
  source: string;
  recommendation: {
    id: string;
    status: "PROPOSED" | "ACCEPTED" | "OVERRIDDEN" | "DISMISSED" | "GAP";
    mode: string;
    score: number | null;
    explanation: string;
    components: Record<string, number> | null;
    recommended: Person | null;
    chosen: Person | null;
    overrideReason: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
  } | null;
  options: { userId: string; name: string; isAgent: boolean; score: number; explanation: string }[];
  gap: string | null;
};
type Payload = {
  mode: "RECOMMEND" | "AUTO";
  weights: Record<string, { label: string; share: number }>;
  roles: Role[];
  holders: Record<string, { userId: string; name: string; proficiency: number }[]>;
  everyone: { userId: string; name: string; isAgent: boolean }[];
  suggestions: { id: string; skill: string; from: { id: string; name: string }; to: { id: string; name: string } | null; reason: string; createdAt: string }[];
  viewer: { canDecide: boolean };
};

const SOURCE_LABEL: Record<string, string> = { DERIVED: "from services", BRIEF: "read from the brief", MANUAL: "added by hand" };
const STATUS: Record<string, { label: string; tone: "info" | "success" | "warning" | "neutral" | "danger" }> = {
  PROPOSED: { label: "Recommended", tone: "info" },
  ACCEPTED: { label: "Assigned", tone: "success" },
  OVERRIDDEN: { label: "Assigned (your choice)", tone: "success" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
  GAP: { label: "No one available", tone: "danger" },
};

/**
 * The team plan (Phase 5): one role per required skill, the recommended
 * person and the plain-language reason, how the score was made up, and the
 * founder's decision — accept, choose someone else (audit-logged, and
 * remembered as a signal), or dismiss. Plus any "reassignment suggested".
 */
export function TeamPlanPanel({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<Role | null>(null);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/projects/${projectId}/assignment`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, url: string, method: string, body: unknown, done: string) => {
    setBusy(key);
    const res = await safeFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(out.error ?? "That didn't save");
    toast.success(done);
    await load();
    onChanged();
  };

  if (failed) return <ErrorState title="The team plan didn't load" onRetry={() => void load()} />;
  if (!data) return <Skeleton className="h-48 rounded-card" />;

  const open = data.roles.filter((r) => r.recommendation?.status === "PROPOSED").length;
  // Projects from before Phase 5 (or with skills added since) have roles
  // with no stored recommendation yet: show the live suggestion, and offer
  // to record it.
  const unanalyzed = data.roles.filter((r) => !r.recommendation).length;
  const base = `/api/projects/${projectId}/assignment`;

  return (
    <div className="space-y-6">
      {data.suggestions.map((s) => (
        <div key={s.id} role="status" className="flex flex-wrap items-center gap-3 rounded-card border border-warn/30 bg-warn-tint px-5 py-4">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
          <p className="min-w-0 flex-1 text-[13px] text-ink/85">
            <span className="font-medium">Reassignment suggested — {s.skill}.</span> {s.reason}.{" "}
            {s.to ? `Suggested: ${s.to.name}.` : "No one else is free for it right now."}
          </p>
          {data.viewer.canDecide && (
            <div className="flex gap-2">
              {s.to && (
                <Button size="sm" loading={busy === s.id} onClick={() => void act(s.id, `/api/projects/${projectId}/reassignments/${s.id}`, "PATCH", { accept: true }, `${s.skill} moved to ${s.to!.name}`)}>
                  Move to {s.to.name}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void act(`${s.id}-x`, `/api/projects/${projectId}/reassignments/${s.id}`, "PATCH", { accept: false }, "Suggestion dismissed")}>
                Keep as is
              </Button>
            </div>
          )}
        </div>
      ))}

      <Card padded={false}>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" /> Team plan
            </span>
          }
          description={
            data.mode === "AUTO"
              ? "Assigned automatically from skills, capacity, delivery history and deadlines. Change anyone below."
              : "Recommended from skills, capacity, delivery history and deadlines. Nothing happens until you confirm."
          }
          action={
            data.viewer.canDecide ? (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === "analyze"} onClick={() => void act("analyze", base, "POST", { action: "analyze" }, "Recommendations refreshed")}>
                  Re-analyze
                </Button>
                {unanalyzed > 0 && (
                  <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={busy === "analyze-new"} onClick={() => void act("analyze-new", base, "POST", { action: "analyze" }, "Recommendations recorded — confirm or change them")}>
                    Analyze team ({unanalyzed})
                  </Button>
                )}
                {open > 0 && (
                  <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={busy === "all"} onClick={() => void act("all", base, "POST", { action: "acceptAll" }, "Team confirmed — everyone was told")}>
                    Accept all ({open})
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          {data.roles.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No required skills yet — add services or skills to this project and re-analyze.</p>
          ) : (
            data.roles.map((role) => {
              const rec = role.recommendation;
              const live = role.options[0] ?? null;
              const status = rec ? STATUS[rec.status] : live ? { label: "Not analyzed yet", tone: "neutral" as const } : STATUS.GAP;
              const holder = rec?.chosen ?? (rec?.status === "PROPOSED" ? rec.recommended : null);
              return (
                <div key={role.skillId} className="rounded-[12px] border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                        {role.skillName}
                        <span className="text-[11px] font-normal text-ink-muted">weight {role.weight} · {SOURCE_LABEL[role.source] ?? role.source}</span>
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-[13px] text-ink/80">
                        {holder ? (
                          <>
                            <UserCheck className="h-3.5 w-3.5 text-success-ink" />
                            {holder.name}
                            {holder.role === "AI_AGENT" && <Bot className="h-3.5 w-3.5 text-ink-2" aria-label="AI employee" />}
                          </>
                        ) : rec?.status === "DISMISSED" ? (
                          <span className="text-ink-muted">No one assigned</span>
                        ) : !rec && live ? (
                          <span className="text-ink-muted">Suggested: {live.name}</span>
                        ) : null}
                      </p>
                    </div>
                    <Badge dot tone={status.tone} size="sm">
                      {status.label}
                    </Badge>
                  </div>

                  <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{rec?.status === "OVERRIDDEN" ? `You chose ${rec.chosen?.name}${rec.overrideReason ? ` — "${rec.overrideReason}"` : ""}. Recommended was ${rec.recommended?.name ?? "no one"}: ${rec.explanation}` : rec?.explanation ?? live?.explanation ?? role.gap}</p>

                  {rec?.components && (rec.status === "PROPOSED" || rec.status === "ACCEPTED") && <Breakdown components={rec.components} weights={data.weights} />}

                  {rec?.decidedAt && (
                    <p className="mt-2 text-[11px] text-ink-muted">
                      {rec.mode === "AUTO" && !rec.decidedBy ? "Assigned automatically" : `Decided by ${rec.decidedBy ?? "someone"}`} · {formatDate(rec.decidedAt)}
                    </p>
                  )}

                  {data.viewer.canDecide && rec && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {rec.status === "PROPOSED" && (
                        <Button size="sm" loading={busy === rec.id} onClick={() => void act(rec.id, `${base}/${rec.id}`, "PATCH", { action: "ACCEPT" }, `${rec.recommended?.name} assigned`)}>
                          Accept
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setOverriding(role)}>
                        {rec.status === "PROPOSED" || rec.status === "GAP" || rec.status === "DISMISSED" ? "Choose someone" : "Change"}
                      </Button>
                      {rec.status === "PROPOSED" && (
                        <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => void act(`${rec.id}-d`, `${base}/${rec.id}`, "PATCH", { action: "DISMISS" }, "Recommendation dismissed")}>
                          Dismiss
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      {overriding && overriding.recommendation && (
        <OverrideModal
          role={overriding}
          holders={data.holders[overriding.skillId] ?? []}
          everyone={data.everyone}
          onClose={() => setOverriding(null)}
          onSave={async (userId, reason) => {
            await act("override", `${base}/${overriding.recommendation!.id}`, "PATCH", { action: "OVERRIDE", userId, reason }, "Assignment changed — noted for next time");
            setOverriding(null);
          }}
        />
      )}
    </div>
  );
}

function Breakdown({ components, weights }: { components: Record<string, number>; weights: Payload["weights"] }) {
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-5">
      {Object.entries(weights).map(([key, w]) => (
        <div key={key} className="min-w-0">
          <dt className="truncate text-[11px] text-ink-muted" title={`${w.label} — ${Math.round(w.share * 100)}% of the score`}>
            {w.label} <span className="text-ink-muted">· {Math.round(w.share * 100)}%</span>
          </dt>
          <dd className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-label={`${w.label}: ${Math.round((components[key] ?? 0) * 100)}%`}>
            <div className="h-full rounded-full bg-data-1" style={{ width: `${Math.round((components[key] ?? 0) * 100)}%` }} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OverrideModal({
  role,
  holders,
  everyone,
  onClose,
  onSave,
}: {
  role: Role;
  holders: { userId: string; name: string; proficiency: number }[];
  everyone: { userId: string; name: string; isAgent: boolean }[];
  onClose: () => void;
  onSave: (userId: string, reason: string) => Promise<void>;
}) {
  // Start on the best person who isn't already holding the role.
  const current = role.recommendation?.chosen?.id ?? (role.recommendation?.status === "PROPOSED" ? role.recommendation.recommended?.id : null);
  const [userId, setUserId] = useState(role.options.find((o) => o.userId !== current)?.userId ?? holders.find((h) => h.userId !== current)?.userId ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const optionIds = new Set(role.options.map((o) => o.userId));
  const holderIds = new Set(holders.map((h) => h.userId));
  const options = [
    ...role.options.map((o) => ({ value: o.userId, label: `${o.name} — score ${Math.round(o.score * 100)}` })),
    ...holders.filter((h) => !optionIds.has(h.userId)).map((h) => ({ value: h.userId, label: `${h.name} — ${role.skillName} ${h.proficiency}/5, not eligible now` })),
    ...everyone.filter((e) => !optionIds.has(e.userId) && !holderIds.has(e.userId)).map((e) => ({ value: e.userId, label: `${e.name} — doesn't hold ${role.skillName}` })),
  ];
  const picked = role.options.find((o) => o.userId === userId);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Who takes ${role.skillName}?`}
      description="Your choice is recorded and remembered: people you pick for this skill score a little higher next time."
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!userId}
            onClick={async () => {
              setBusy(true);
              await onSave(userId, reason);
              setBusy(false);
            }}
          >
            Assign
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Person" value={userId} onChange={(e) => setUserId(e.target.value)} options={options} />
        <p className={cn("text-[13px] leading-relaxed", picked ? "text-ink-2" : "text-ink")}>
          {picked ? picked.explanation : "Not a ranked option — they don't meet the skill or capacity rules right now. You can still assign them."}
        </p>
        <Textarea label="Why (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. worked with this client before" />
      </div>
    </Modal>
  );
}
