"use client";

import { useCallback, useEffect, useState } from "react";
import { History, MessagesSquare } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, relativeFromNow } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";

type Comment = { id: string; body: string; createdAt: string; author: { id: string; name: string; avatarColor: string } | null };
type Entry = { id: string; at: string; actor: string; text: string };

/**
 * The project's thread (internal — client messaging arrives with the portal)
 * and its activity, read from the audit log.
 */
export function ProjectDiscussion({ projectId, canPost, viewerId }: { projectId: string; canPost: boolean; viewerId: string }) {
  const toast = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [activity, setActivity] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([safeFetch(`/api/projects/${projectId}/comments`, { cache: "no-store" }), safeFetch(`/api/projects/${projectId}/activity`, { cache: "no-store" })]);
    if (!c.ok || !a.ok) return setFailed(true);
    setFailed(false);
    setComments((await c.json()).comments);
    setActivity((await a.json()).activity);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/projects/${projectId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draft }) });
    setBusy(false);
    if (!res.ok) return toast.error("Your message didn't post");
    setDraft("");
    void load();
  };

  if (failed) return <ErrorState title="The discussion didn't load" onRetry={() => void load()} />;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card padded={false} className="lg:col-span-3">
        <CardHeader title="Discussion" description="Internal to the team." />
        <CardBody className="space-y-5">
          {!comments ? (
            <Skeleton className="h-24" />
          ) : comments.length === 0 ? (
            <EmptyState icon={MessagesSquare} title="No messages yet" description="Decisions and questions about this project, in one place." className="py-6" />
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar name={c.author?.name ?? "?"} color={c.author?.avatarColor} size="sm" />
                  <div className="min-w-0">
                    <p className="text-[12px] text-ink-muted">
                      <span className="font-medium text-ink/80">{c.author?.id === viewerId ? "You" : c.author?.name ?? "Someone"}</span> · <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)}>{relativeFromNow(c.createdAt)}</time>
                    </p>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink/85">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canPost && (
            <div className="space-y-2 border-t border-line pt-4">
              <Textarea aria-label="Message" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write to the team" />
              <div className="flex justify-end">
                <Button size="sm" loading={busy} disabled={!draft.trim()} onClick={() => void post()}>
                  Post
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card padded={false} className="lg:col-span-2">
        <CardHeader title="Activity" />
        <CardBody>
          {!activity ? (
            <Skeleton className="h-40" />
          ) : activity.length === 0 ? (
            <EmptyState icon={History} title="Nothing yet" description="Changes made to this project in the app appear here." className="py-6" />
          ) : (
            <ol className="space-y-3">
              {activity.map((e) => (
                <li key={e.id} className="text-[13px] leading-snug">
                  <span className="font-medium text-ink/85">{e.actor}</span> <span className="text-ink-2">{e.text}</span>
                  <span className="block text-[11px] text-ink-muted">{relativeFromNow(e.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
