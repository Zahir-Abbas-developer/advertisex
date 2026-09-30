"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Megaphone, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { cn } from "@/lib/utils";
import { relativeFromNow } from "@/lib/date";

type Update = { id: string; title: string; body: string; visibility: "INTERNAL" | "CLIENT"; createdAt: string; author: { id: string; name: string; avatarColor: string } | null };

/**
 * Project updates (Phase 6 scope 3). Each one says, visibly, who can read it:
 * "Client can see" updates appear in the client's portal; internal ones never
 * do. Sharing is a deliberate choice, made by the founder or a manager.
 */
export function ProjectUpdates({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const toast = useToast();
  const [updates, setUpdates] = useState<Update[] | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", share: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/projects/${projectId}/updates`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setUpdates(body.updates);
    setCanShare(body.viewer.canShare);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/projects/${projectId}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: form.title, body: form.body, visibility: form.share ? "CLIENT" : "INTERNAL" }),
    });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "The update wasn't posted");
    toast.success(form.share ? "Shared with the client — they've been told" : "Posted for the team");
    setForm({ title: "", body: "", share: false });
    void load();
  };

  const setVisibility = async (u: Update, visibility: Update["visibility"]) => {
    if (visibility === "CLIENT" && !window.confirm(`Share "${u.title}" with the client? It will appear in their portal.`)) return;
    const res = await safeFetch(`/api/projects/${projectId}/updates/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility }) });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't change that");
    toast.success(visibility === "CLIENT" ? "Now visible to the client" : "Now internal only");
    void load();
  };

  const remove = async (u: Update) => {
    if (!window.confirm(`Delete "${u.title}"?`)) return;
    const res = await safeFetch(`/api/projects/${projectId}/updates/${u.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't delete it");
    void load();
  };

  if (failed) return <ErrorState title="Updates didn't load" onRetry={() => void load()} />;
  if (!updates) return <Skeleton className="h-48 rounded-card" />;

  return (
    <div className="space-y-6">
      <Card padded={false}>
        <CardHeader title="Post an update" description="Progress worth telling the client about, or a note for the team." />
        <CardBody className="space-y-3">
          <Input label="Headline" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Your new homepage design is ready" />
          <Textarea label="Update" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {canShare ? (
              <label className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]", form.share ? "border-brand/50 bg-brand-tint text-ink" : "border-line text-ink-2")}>
                <input type="checkbox" className="accent-brand" checked={form.share} onChange={(e) => setForm({ ...form, share: e.target.checked })} />
                Share with the client (appears in their portal)
              </label>
            ) : (
              <span className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                <Lock className="h-3.5 w-3.5" /> Posted for the team; a manager can share it with the client.
              </span>
            )}
            <Button loading={busy} disabled={form.title.trim().length < 2 || !form.body.trim()} onClick={() => void post()}>
              {form.share ? "Share update" : "Post update"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {updates.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Megaphone} title="No updates yet" description="Updates you share appear in the client's portal; internal ones stay with the team." />
        </Card>
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => (
            <li key={u.id} className="rounded-card border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <Avatar name={u.author?.name ?? "?"} color={u.author?.avatarColor} size="sm" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">{u.title}</p>
                    <p className="text-[12px] text-ink-muted">
                      {u.author?.name ?? "Someone"} · {relativeFromNow(u.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge size="sm" tone={u.visibility === "CLIENT" ? "info" : "neutral"}>
                    {u.visibility === "CLIENT" ? "Client can see" : "Internal"}
                  </Badge>
                  {canShare && (
                    <button
                      type="button"
                      onClick={() => void setVisibility(u, u.visibility === "CLIENT" ? "INTERNAL" : "CLIENT")}
                      className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
                      aria-label={u.visibility === "CLIENT" ? `Make "${u.title}" internal` : `Share "${u.title}" with the client`}
                    >
                      {u.visibility === "CLIENT" ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                  {(canShare || u.author?.id === viewerId) && (
                    <button type="button" onClick={() => void remove(u)} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-danger-ink" aria-label={`Delete "${u.title}"`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/80">{u.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
