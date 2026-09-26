"use client";

import { useCallback, useEffect, useState } from "react";
import { Pin, PinOff, StickyNote, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/date";

type Note = { id: string; body: string; pinned: boolean; createdAt: string; author: { id: string; name: string; avatarColor: string } | null };

/** Notes about a client. Pinned notes are shown as "important" on the overview. */
export function NotesPanel({ clientId, canEdit, viewerId, isManager }: { clientId: string; canEdit: boolean; viewerId: string; isManager: boolean }) {
  const toast = useToast();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/notes`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setNotes((await res.json()).notes);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/clients/${clientId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft, pinned: pin }),
    });
    setBusy(false);
    if (!res.ok) return toast.error("The note wasn't saved");
    setDraft("");
    setPin(false);
    void load();
  };

  const update = async (n: Note, data: { pinned?: boolean }) => {
    const res = await fetch(`/api/clients/${clientId}/notes/${n.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) return toast.error("Couldn't change that");
    void load();
  };

  const remove = async (n: Note) => {
    if (!window.confirm("Delete this note?")) return;
    const res = await fetch(`/api/clients/${clientId}/notes/${n.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't delete it");
    void load();
  };

  if (failed) return <ErrorState title="Notes didn't load" onRetry={() => void load()} />;

  return (
    <Card>
      <CardBody className="space-y-5">
        {canEdit && (
          <div className="space-y-2">
            <Textarea aria-label="New note" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What should everyone working with this client know?" />
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px] text-ink/60">
                <input type="checkbox" className="accent-brand" checked={pin} onChange={(e) => setPin(e.target.checked)} />
                Pin as important
              </label>
              <Button size="sm" loading={busy} disabled={!draft.trim()} onClick={() => void add()}>
                Add note
              </Button>
            </div>
          </div>
        )}
        {!notes ? (
          <Skeleton className="h-24" />
        ) : notes.length === 0 ? (
          <EmptyState icon={StickyNote} title="No notes yet" description="Preferences, history and anything the next person should know." className="py-6" />
        ) : (
          <ul className="divide-y divide-line">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-3 py-4">
                <Avatar name={n.author?.name ?? "?"} color={n.author?.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink/85">{n.body}</p>
                  <p className="mt-1 text-[11px] text-ink/40">
                    {n.author?.name ?? "Someone"} · {formatDateTime(n.createdAt)}
                    {n.pinned ? " · Pinned" : ""}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-start gap-1">
                    <button type="button" onClick={() => void update(n, { pinned: !n.pinned })} className="rounded p-1.5 text-ink/50 hover:bg-surface-2 hover:text-ink" aria-label={n.pinned ? "Unpin" : "Pin as important"}>
                      {n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                    {(isManager || n.author?.id === viewerId) && (
                      <button type="button" onClick={() => void remove(n)} className="rounded p-1.5 text-ink/50 hover:bg-surface-2 hover:text-danger" aria-label="Delete note">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
