"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDate, relativeFromNow } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";

type Credential = {
  id: string;
  label: string;
  kind: string;
  url: string | null;
  username: string | null;
  notes: string | null;
  secret: string;
  lastRevealedAt: string | null;
  updatedAt: string;
  createdBy: { id: string; name: string } | null;
};

const KINDS = [
  { value: "WEBSITE", label: "Website admin" },
  { value: "HOSTING", label: "Hosting" },
  { value: "DOMAIN", label: "Domain registrar" },
  { value: "GOOGLE", label: "Google (Ads, Analytics, Business Profile)" },
  { value: "META", label: "Meta (Facebook, Instagram)" },
  { value: "SOCIAL", label: "Other social" },
  { value: "EMAIL", label: "Email" },
  { value: "OTHER", label: "Other" },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label.split(" (")[0] ?? "Other";

/** How long a revealed secret stays on screen. */
const REVEAL_SECONDS = 30;

/**
 * The client's credentials vault. Masked by default; revealing one is an
 * audited action on the server and hides itself again after 30 seconds.
 */
export function CredentialsPanel({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Credential[] | null>(null);
  const [perms, setPerms] = useState({ canReveal: false, canManage: false });
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Credential | "new" | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/clients/${clientId}/credentials`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setRows(body.credentials);
    setPerms({ canReveal: body.canReveal, canManage: body.canManage });
  }, [clientId]);

  useEffect(() => {
    void load();
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, [load]);

  const hide = (id: string) => {
    clearTimeout(timers.current[id]);
    setShown((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
  };

  const reveal = async (c: Credential) => {
    if (shown[c.id]) return hide(c.id);
    const res = await safeFetch(`/api/credentials/${c.id}/reveal`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error ?? "Couldn't open that login");
    setShown((s) => ({ ...s, [c.id]: body.secret }));
    timers.current[c.id] = setTimeout(() => hide(c.id), REVEAL_SECONDS * 1000);
    setRows((r) => r?.map((x) => (x.id === c.id ? { ...x, lastRevealedAt: new Date().toISOString() } : x)) ?? r);
  };

  const copy = async (c: Credential) => {
    const secret = shown[c.id];
    if (!secret) return;
    await navigator.clipboard.writeText(secret).catch(() => undefined);
    toast.success("Copied — it's on your clipboard");
  };

  const remove = async (c: Credential) => {
    if (!window.confirm(`Remove the login "${c.label}"? The stored secret is destroyed.`)) return;
    const res = await safeFetch(`/api/credentials/${c.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't remove it");
    toast.success("Login removed");
    void load();
  };

  if (failed) return <ErrorState title="The vault didn't load" onRetry={() => void load()} />;
  if (!rows) return <Skeleton className="h-32 rounded-card" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-ink-muted">
          Encrypted at rest. Secrets stay masked; opening one is recorded in the audit log with your name.
        </p>
        {perms.canManage && (
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
            Add login
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No logins stored"
          description={perms.canManage ? "Keep the client's website, ad account and social logins here instead of in chat." : "Nothing has been stored for this client yet."}
        />
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {rows.map((c) => (
            <li key={c.id} className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_8.5rem] sm:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[13px] font-medium text-ink">{c.label}</p>
                  <Badge size="sm">{kindLabel(c.kind)}</Badge>
                </div>
                {c.url && <p className="truncate text-[12px] text-ink-muted">{c.url}</p>}
              </div>
              <div className="min-w-0 space-y-0.5 text-[13px]">
                {c.username && <p className="truncate text-ink-2">{c.username}</p>}
                <p className="truncate font-mono tabular-nums text-ink/80" aria-live="polite">
                  {shown[c.id] ?? c.secret}
                </p>
                <p className="text-[11px] text-ink-muted">
                  {c.lastRevealedAt ? `Last opened ${relativeFromNow(c.lastRevealedAt)}` : "Never opened"} · updated {formatDate(c.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-1 justify-self-end">
                {perms.canReveal && (
                  <button type="button" onClick={() => void reveal(c)} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={shown[c.id] ? `Hide ${c.label}` : `Reveal ${c.label}`}>
                    {shown[c.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
                {shown[c.id] && (
                  <button type="button" onClick={() => void copy(c)} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Copy ${c.label}`}>
                    <Copy className="h-4 w-4" />
                  </button>
                )}
                {perms.canManage && (
                  <>
                    <button type="button" onClick={() => setEditing(c)} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Edit ${c.label}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => void remove(c)} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-danger" aria-label={`Remove ${c.label}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CredentialModal
          clientId={clientId}
          credential={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CredentialModal({
  clientId,
  credential,
  onClose,
  onSaved,
}: {
  clientId: string;
  credential: Credential | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    label: credential?.label ?? "",
    kind: credential?.kind ?? "WEBSITE",
    url: credential?.url ?? "",
    username: credential?.username ?? "",
    notes: credential?.notes ?? "",
    secret: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    const payload = {
      label: form.label,
      kind: form.kind,
      url: form.url || null,
      username: form.username || null,
      notes: form.notes || null,
      ...(form.secret || !credential ? { secret: form.secret } : {}),
    };
    const res = await safeFetch(credential ? `/api/credentials/${credential.id}` : `/api/clients/${clientId}/credentials`, {
      method: credential ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "Couldn't save that login");
    }
    toast.success(credential ? "Login updated" : "Login stored, encrypted");
    onSaved();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={credential ? `Edit ${credential.label}` : "Add a login"}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {credential ? "Save" : "Store login"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Name" requiredMark value={form.label} onChange={set("label")} error={errors.label} placeholder="e.g. WordPress admin" />
        <Select label="Kind" value={form.kind} onChange={set("kind")} options={KINDS} />
        <Input label="Address" value={form.url} onChange={set("url")} placeholder="https://" />
        <Input label="Username or email" value={form.username} onChange={set("username")} autoComplete="off" />
        <Input
          label={credential ? "New password or key" : "Password or key"}
          hint={credential ? "Leave empty to keep the current one." : undefined}
          requiredMark={!credential}
          type="password"
          autoComplete="new-password"
          value={form.secret}
          onChange={set("secret")}
          error={errors.secret}
        />
        <Textarea label="Notes" rows={2} value={form.notes} onChange={set("notes")} hint="Never put the password here — notes are not encrypted." />
      </div>
    </Modal>
  );
}
