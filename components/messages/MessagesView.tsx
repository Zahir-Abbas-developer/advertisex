"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCheck, Download, Lock, MessagesSquare, Paperclip, Send, Users, X } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { formatBytes, cn } from "@/lib/utils";
import { relativeFromNow } from "@/lib/date";

type Thread = {
  id: string;
  kind: "TEAM" | "FOUNDER";
  subject: string;
  client: { id: string; businessName: string };
  lastMessageAt: string;
  unread: number;
  preview: { body: string; author: string | null; at: string } | null;
};
type Message = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string; isClient: boolean } | null;
  mine: boolean;
  files: { id: string; filename: string; size: number; mimeType: string; downloadUrl: string; previewUrl: string | null }[];
  seenBy: string[];
};

/**
 * Conversations (Phase 6 scope 6), shared by the portal and the team product.
 * `audience` sets the language: a client sees "Your team" and "Private —
 * founders"; the team sees each client's threads and which one is private.
 */
export function MessagesView({ audience, clientId }: { audience: "client" | "team"; clientId?: string }) {
  const toast = useToast();
  const initial = useSearchParams().get("thread");
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [active, setActive] = useState<string | null>(initial);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const res = await safeFetch(`/api/messages/threads${clientId ? `?clientId=${clientId}` : ""}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    const list: Thread[] = (await res.json()).threads;
    setThreads(list);
    setActive((a) => (a && list.some((t) => t.id === a) ? a : list[0]?.id ?? null));
  }, [clientId]);

  const loadMessages = useCallback(async (id: string) => {
    const res = await safeFetch(`/api/messages/threads/${id}`, { cache: "no-store" });
    if (!res.ok) return setMessages([]);
    setMessages((await res.json()).messages);
    setThreads((ts) => ts?.map((t) => (t.id === id ? { ...t, unread: 0 } : t)) ?? ts);
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!active) return;
    setMessages(null);
    void loadMessages(active);
    // New messages and read receipts, while the conversation is open.
    const timer = setInterval(() => void loadMessages(active), 15_000);
    return () => clearInterval(timer);
  }, [active, loadMessages]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = async () => {
    if (!active || (!draft.trim() && files.length === 0)) return;
    setSending(true);
    const form = new FormData();
    form.set("body", draft);
    for (const f of files) form.append("file", f);
    const res = await safeFetch(`/api/messages/threads/${active}`, { method: "POST", body: form });
    setSending(false);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Your message wasn't sent");
    setDraft("");
    setFiles([]);
    await loadMessages(active);
    void loadThreads();
  };

  const label = (t: Thread) => {
    if (audience === "client") return t.kind === "FOUNDER" ? "Private — founders" : "Your team";
    return `${t.client.businessName} · ${t.kind === "FOUNDER" ? "Private (founders)" : "Team"}`;
  };

  if (failed) return <ErrorState title="Messages didn't load" onRetry={() => void loadThreads()} />;
  if (!threads) return <Skeleton className="h-96 rounded-card" />;
  if (threads.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface">
        <EmptyState icon={MessagesSquare} title="No conversations yet" description={audience === "team" ? "Client conversations you're part of appear here." : "Your conversations with your team will appear here."} />
      </div>
    );
  }
  const current = threads.find((t) => t.id === active) ?? null;

  return (
    <div className="grid min-h-[520px] overflow-hidden rounded-card border border-line bg-surface md:grid-cols-[18rem_minmax(0,1fr)]">
      <ul className={cn("divide-y divide-line border-line md:border-r", active && "hidden md:block")} aria-label="Conversations">
        {threads.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setActive(t.id)}
              aria-current={t.id === active ? "true" : undefined}
              className={cn("flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2", t.id === active && "bg-surface-2")}
            >
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", t.kind === "FOUNDER" ? "bg-brand-tint text-brand" : "bg-surface-2 text-ink-muted")}>
                {t.kind === "FOUNDER" ? <Lock className="h-4 w-4" /> : <Users className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-[13px]", t.unread ? "font-semibold text-ink" : "font-medium text-ink/85")}>{label(t)}</span>
                  {t.unread > 0 && <span className="rounded-pill bg-brand px-1.5 text-[11px] font-semibold tabular-nums text-on-brand">{t.unread}</span>}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{t.preview ? `${t.preview.author ? `${t.preview.author}: ` : ""}${t.preview.body}` : "No messages yet"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {current ? (
        <section className={cn("flex min-w-0 flex-col", !active && "hidden md:flex")} aria-label={label(current)}>
          <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
            <button type="button" onClick={() => setActive(null)} className="rounded p-1 text-ink-muted hover:text-ink md:hidden" aria-label="Back to conversations">
              <X className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{label(current)}</p>
              <p className="text-[12px] text-ink-muted">
                {current.kind === "FOUNDER"
                  ? audience === "client"
                    ? "Only you and the Advertise X founders can read this."
                    : "Private: only this client and the founders see this conversation."
                  : audience === "client"
                    ? "You and the team working on your projects."
                    : "The client and the team working for them."}
              </p>
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5" style={{ maxHeight: 520 }}>
            {!messages ? (
              <Skeleton className="h-24" />
            ) : messages.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-ink-muted">{audience === "client" ? "Say hello — your team usually replies within a working day." : "No messages yet."}</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("flex gap-3", m.mine && "flex-row-reverse")}>
                  <Avatar name={m.author?.name ?? "?"} color={m.author?.avatarColor} size="sm" />
                  <div className={cn("max-w-[80%] min-w-0", m.mine && "text-right")}>
                    <p className="text-[11px] text-ink-muted">
                      {m.mine ? "You" : m.author?.name ?? "Someone"} · <time dateTime={m.createdAt}>{relativeFromNow(m.createdAt)}</time>
                    </p>
                    <div className={cn("mt-1 inline-block rounded-[12px] px-3.5 py-2.5 text-left text-[13px] leading-relaxed", m.mine ? "bg-brand-tint text-ink" : "bg-surface-2 text-ink/90")}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      {m.files.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {m.files.map((f) => (
                            <li key={f.id}>
                              <a href={f.downloadUrl} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink/80 hover:text-ink" target="_blank" rel="noopener noreferrer">
                                <Download className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{f.filename}</span>
                                <span className="shrink-0 text-ink-muted">{formatBytes(f.size)}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {m.mine && m.seenBy.length > 0 && (
                      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-success-ink">
                        <CheckCheck className="h-3.5 w-3.5" /> Seen{audience === "team" ? ` by ${m.seenBy.join(", ")}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={end} />
          </div>

          <div className="border-t border-line p-4">
            {files.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-pill border border-line px-2.5 py-1 text-[12px] text-ink-2">
                    {f.name}
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))} className="text-ink-muted hover:text-danger">
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={input}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  setFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])].slice(0, 5));
                  e.target.value = "";
                }}
              />
              <button type="button" onClick={() => input.current?.click()} className="rounded-lg border border-line p-2.5 text-ink-muted hover:text-ink" aria-label="Attach files">
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                aria-label="Message"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
                }}
                placeholder="Write a message…"
                className="min-h-[44px] flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:border-brand/60 focus:outline-none"
              />
              <Button icon={<Send className="h-4 w-4" />} loading={sending} disabled={!draft.trim() && files.length === 0} onClick={() => void send()}>
                Send
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
