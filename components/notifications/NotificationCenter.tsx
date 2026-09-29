"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { relativeFromNow } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";
import { cn } from "@/lib/utils";
import type { Level } from "@/modules/notifications/catalog";

type Row = { id: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string; category: string };
type Pref = { key: string; label: string; description: string; minimum: Level; level: Level };

const LEVEL_LABEL: Record<Level, string> = { off: "Off", app: "In the app", email: "In the app and by email" };
const RANK: Record<Level, number> = { off: 0, app: 1, email: 2 };

/**
 * The notification center (Phase 8 scope 5), for the team and for clients:
 * everything you've been told, filterable, and — on the Settings tab — how
 * you want to be told, per category, plus the optional daily digest.
 */
export function NotificationCenter() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"all" | "settings">(params.get("tab") === "settings" ? "settings" : "all");
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow text-brand">Notifications</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">What&apos;s happened</h1>
        <p className="mt-2 text-[14px] text-ink-muted">Everything you&apos;ve been told, and how you&apos;d like to be told.</p>
      </header>
      <Tabs
        items={[
          { key: "all", label: "Notifications" },
          { key: "settings", label: "Settings" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "all" ? <History /> : <NotificationPreferences />}
    </div>
  );
}

function History() {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [cats, setCats] = useState<Pref[]>([]);
  const [data, setData] = useState<{ notifications: Row[]; total: number; pageSize: number; unread: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page) });
    if (unreadOnly) q.set("unread", "1");
    if (category) q.set("category", category);
    const res = await safeFetch(`/api/notifications?${q}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [page, unreadOnly, category]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void safeFetch("/api/me/notifications", { cache: "no-store" }).then(async (r) => r.ok && setCats((await r.json()).categories));
  }, []);

  const open = async (n: Row) => {
    if (!n.readAt) await safeFetch(`/api/notifications/${n.id}`, { method: "PATCH" });
    if (n.href) router.push(n.href);
    else void load();
  };
  const markAll = async () => {
    await safeFetch("/api/notifications", { method: "POST" });
    void load();
  };

  if (failed) return <ErrorState title="Notifications didn't load" onRetry={() => void load()} />;
  if (!data) return <Skeleton className="h-64 rounded-card" />;
  const label = (key: string) => cats.find((c) => c.key === key)?.label ?? "Other";

  return (
    <Card padded={false}>
      <CardHeader title={data.unread ? `${data.unread} unread` : "All caught up"} />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
        <div className="w-full sm:w-48">
          <Select
            aria-label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            options={[{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c.key, label: c.label }))]}
          />
        </div>
        <Button
          variant={unreadOnly ? "primary" : "secondary"}
          size="sm"
          aria-pressed={unreadOnly}
          onClick={() => {
            setUnreadOnly(!unreadOnly);
            setPage(1);
          }}
        >
          Unread only
        </Button>
        {data.unread > 0 && (
          <Button variant="ghost" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={() => void markAll()}>
            Mark all read
          </Button>
        )}
      </div>
      {data.notifications.length === 0 ? (
        <EmptyState icon={Bell} title={unreadOnly || category ? "Nothing matches" : "No notifications yet"} description="When something needs you, it appears here." className="py-10" />
      ) : (
        <CardBody className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {data.notifications.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void open(n)} className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2 sm:px-6">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[14px] text-ink", !n.readAt && "font-medium")}>{n.title}</span>
                    <span className="mt-0.5 block text-[13px] text-ink-2">{n.body}</span>
                    <span className="mt-1 block text-[12px] text-ink-muted">
                      {label(n.category)} · {relativeFromNow(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-5 py-3 sm:px-6">
            <Pagination page={page} pageCount={Math.ceil(data.total / data.pageSize)} onPageChange={setPage} />
          </div>
        </CardBody>
      )}
    </Card>
  );
}

/** Per-category levels and the digest — on the center's Settings tab and in the portal's settings. */
export function NotificationPreferences() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [digest, setDigest] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch("/api/me/notifications", { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setPrefs(body.categories);
    setDigest(body.digest);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!prefs) return;
    setBusy(true);
    const res = await safeFetch("/api/me/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ levels: Object.fromEntries(prefs.map((p) => [p.key, p.level])), digest }),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't save your preferences");
    toast.success("Preferences saved");
  };

  if (failed) return <ErrorState title="Preferences didn't load" onRetry={() => void load()} />;
  if (!prefs) return <Skeleton className="h-64 rounded-card" />;

  return (
    <Card padded={false}>
      <CardHeader title="How you're told" description="Some notices can't be switched off entirely — they stay in the app." />
      <CardBody className="space-y-1 p-0 sm:p-0">
        <ul className="divide-y divide-line">
          {prefs.map((p, i) => (
            <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-ink">{p.label}</span>
                <span className="block text-[12px] text-ink-muted">{p.description}</span>
              </span>
              <div className="w-56">
                <Select
                  aria-label={`${p.label} notifications`}
                  value={p.level}
                  onChange={(e) => setPrefs(prefs.map((x, j) => (j === i ? { ...x, level: e.target.value as Level } : x)))}
                  options={(["off", "app", "email"] as const).filter((l) => RANK[l] >= RANK[p.minimum]).map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
                />
              </div>
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-3 border-t border-line px-5 py-4 text-[14px] text-ink sm:px-6">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={digest} onChange={(e) => setDigest(e.target.checked)} />
          <span>
            Daily digest
            <span className="block text-[12px] text-ink-muted">One email each morning with anything you haven&apos;t opened.</span>
          </span>
        </label>
        <div className="flex justify-end border-t border-line px-5 py-3 sm:px-6">
          <Button loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
