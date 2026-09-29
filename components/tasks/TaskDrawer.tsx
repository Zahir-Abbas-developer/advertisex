"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Plus, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { ActivityFeed, type FeedEntry } from "@/components/team/ActivityFeed";
import { TASK_STATUSES, TASK_STATUS_LABEL, canMove, type TaskStatus } from "@/modules/tasks/domain";
import { formatBytes, cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/EmptyState";

type Item = { id: string; label: string; done: boolean };
type Comment = { id: string; body: string; createdAt: string; author: { id: string; name: string; avatarColor: string } | null };
type FileRow = { id: string; filename: string; size: number; createdAt: string; uploader: { name: string } | null };

export type DrawerTask = { id: string; title: string; note: string | null; status: TaskStatus; dueAt: string | null };

/**
 * Everything about one task: its status (only the moves the lifecycle
 * allows), description, checklist, comments, files and full history — the
 * history read from the audit log the data layer writes.
 */
export function TaskDrawer({
  task,
  onClose,
  onChanged,
}: {
  task: DrawerTask | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [history, setHistory] = useState<FeedEntry[] | null>(null);
  const [tab, setTab] = useState<"checklist" | "comments" | "files" | "history">("checklist");
  const [newItem, setNewItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const id = task?.id;

  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    if (!id) return;
    let failed = false;
    const get = (url: string, empty: object) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .catch(() => {
          failed = true;
          return empty;
        });
    const [l, c, f, h] = await Promise.all([
      get(`/api/tasks/${id}/checklist`, { items: [] }),
      get(`/api/tasks/${id}/comments`, { comments: [] }),
      get(`/api/tasks/${id}/files`, { files: [] }),
      get(`/api/tasks/${id}/activity`, { entries: [] }),
    ]);
    setLoadFailed(failed);
    setItems(l.items);
    setComments(c.comments);
    setFiles(f.files);
    setHistory(
      (h.entries as FeedEntry[]).map((e) => ({ ...e, summary: e.summary ?? `${e.entityType} changed` })).reverse(),
    );
  }, [id]);

  useEffect(() => {
    if (!task) return;
    setStatus(task.status);
    setNote(task.note ?? "");
    setItems(null);
    setComments(null);
    setFiles(null);
    setHistory(null);
    setTab("checklist");
    void load();
  }, [task, load]);

  async function patch(body: Record<string, unknown>, success: string) {
    if (!id) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(out.error ?? "That didn't save.");
        return false;
      }
      toast.success(success);
      onChanged();
      void load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function checklist(method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>, itemId?: string) {
    if (!id) return;
    const url = method === "DELETE" ? `/api/tasks/${id}/checklist?itemId=${itemId}` : `/api/tasks/${id}/checklist`;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(out.error ?? "That didn't save.");
    setItems((current) => {
      const list = current ?? [];
      if (method === "POST") return [...list, out.item];
      if (method === "PATCH") return list.map((i) => (i.id === out.item.id ? out.item : i));
      return list.filter((i) => i.id !== itemId);
    });
    void load();
  }

  async function comment() {
    if (!id || !newComment.trim()) return;
    const res = await fetch(`/api/tasks/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newComment }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(out.error ?? "That comment didn't post.");
    setNewComment("");
    setComments((c) => [...(c ?? []), out.comment]);
  }

  async function upload(file: File) {
    if (!id) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/tasks/${id}/files`, { method: "POST", body: form });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(out.error ?? "That upload didn't work.");
    toast.success("File attached.");
    void load();
  }

  async function removeFile(fileId: string) {
    const res = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
    if (!res.ok) return toast.error("That file couldn't be removed.");
    setFiles((f) => (f ?? []).filter((x) => x.id !== fileId));
  }

  const done = items?.filter((i) => i.done).length ?? 0;

  return (
    <Drawer open={Boolean(task)} onClose={onClose} title={task?.title ?? ""}>
      {task && status && (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink/80">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {TASK_STATUSES.map((s) => {
                const current = s === status;
                const allowed = current || canMove(status, s);
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!allowed || busy}
                    aria-pressed={current}
                    onClick={async () => {
                      if (current) return;
                      if (await patch({ status: s }, `Moved to ${TASK_STATUS_LABEL[s]}.`)) setStatus(s);
                    }}
                    className={cn(
                      "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                      current ? "border-brand/50 bg-brand-tint text-brand" : "border-line text-ink-muted hover:border-line-strong hover:text-ink",
                      "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink-muted",
                    )}
                  >
                    {TASK_STATUS_LABEL[s]}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] text-ink-muted">One step at a time, back from review, or straight to Completed.</p>
          </div>

          <div>
            <Textarea label="Description" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            {note !== (task.note ?? "") && (
              <div className="mt-2 flex justify-end">
                <Button size="sm" loading={busy} onClick={() => void patch({ note }, "Description saved.")}>Save description</Button>
              </div>
            )}
          </div>

          <Tabs
            items={[
              { key: "checklist", label: "Checklist", count: items ? items.length : undefined },
              { key: "comments", label: "Comments", count: comments?.length },
              { key: "files", label: "Files", count: files?.length },
              { key: "history", label: "History" },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === "checklist" &&
            (items === null ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="space-y-3">
                {items.length > 0 && <p className="text-[12px] tabular-nums text-ink-muted">{done} of {items.length} done</p>}
                {items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-2">
                    <Checkbox label={item.label} checked={item.done} onChange={(e) => void checklist("PATCH", { itemId: item.id, done: e.target.checked })} />
                    <button type="button" aria-label={`Remove ${item.label}`} onClick={() => void checklist("DELETE", undefined, item.id)} className="rounded-[8px] p-1 text-ink-muted hover:bg-surface-2 hover:text-ink">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newItem.trim()) return;
                    void checklist("POST", { label: newItem });
                    setNewItem("");
                  }}
                >
                  <div className="flex-1">
                    <Input placeholder="Add a checklist item" aria-label="New checklist item" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
                  </div>
                  <Button type="submit" variant="secondary" icon={<Plus className="h-4 w-4" />}>Add</Button>
                </form>
              </div>
            ))}

          {tab === "comments" &&
            (comments === null ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="space-y-4">
                {comments.length === 0 && <p className="text-[13px] text-ink-muted">No comments yet.</p>}
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    {c.author && <Avatar name={c.author.name} color={c.author.avatarColor} size="sm" />}
                    <div className="min-w-0">
                      <p className="text-[12px] text-ink-muted">
                        {c.author?.name ?? "Someone"} ·{" "}
                        {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(c.createdAt))}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink/85">{c.body}</p>
                    </div>
                  </div>
                ))}
                <Textarea label="Add a comment" rows={2} value={newComment} onChange={(e) => setNewComment(e.target.value)} />
                <div className="flex justify-end">
                  <Button size="sm" disabled={!newComment.trim()} onClick={() => void comment()}>Comment</Button>
                </div>
              </div>
            ))}

          {tab === "files" &&
            (files === null ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="space-y-3">
                {files.length === 0 && <p className="text-[13px] text-ink-muted">No files attached.</p>}
                {files.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2">
                    <a href={`/api/files/${f.id}`} className="min-w-0 truncate text-[13px] text-ink hover:text-brand">{f.filename}</a>
                    <span className="flex shrink-0 items-center gap-2 text-[12px] tabular-nums text-ink-muted">
                      {formatBytes(f.size)}
                      <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => void removeFile(f.id)} className="rounded-[8px] p-1 hover:bg-surface-2 hover:text-ink">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                ))}
                <input ref={fileInput} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
                <Button variant="secondary" icon={<Paperclip className="h-4 w-4" />} onClick={() => fileInput.current?.click()}>
                  Attach a file
                </Button>
              </div>
            ))}

          {loadFailed && <InlineError message="Part of this task didn't load." onRetry={() => void load()} />}
          {tab === "history" && (history === null ? <Skeleton className="h-24" /> : <ActivityFeed entries={history} />)}
        </div>
      )}
    </Drawer>
  );
}
