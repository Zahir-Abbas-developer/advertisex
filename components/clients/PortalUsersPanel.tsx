"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, UserPlus, X } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { formatDate } from "@/lib/date";

type Data = {
  users: { id: string; name: string; email: string; clientRole: string; isActive: boolean; avatarColor: string }[];
  invites: { id: string; name: string; email: string; clientRole: string; expiresAt: string }[];
  hasPortal: boolean;
};

/**
 * Who can sign in to this client's portal (Phase 6 scope 1): invite-only.
 * The founder or a manager invites the owner (and anyone else); an owner can
 * then invite colleagues from the portal.
 */
export function PortalUsersPanel({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", clientRole: "OWNER" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/clients/${clientId}/portal-users`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/clients/${clientId}/portal-users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrors(body.fields ?? {});
      return toast.error(body.error ?? "The invitation wasn't created");
    }
    setErrors({});
    setForm({ name: "", email: "", clientRole: "MEMBER" });
    setLink(`${window.location.origin}${body.link}`);
    toast.success(body.emailed ? "Invitation emailed" : "Invitation created — share the link");
    void load();
  };

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Remove ${label}?`)) return;
    const res = await safeFetch(`/api/clients/${clientId}/portal-users/${id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't remove them");
    toast.success("Removed");
    void load();
  };

  if (failed) return <ErrorState title="Portal access didn't load" onRetry={() => void load()} />;
  if (!data) return <Skeleton className="h-40 rounded-card" />;
  const active = data.users.filter((u) => u.isActive);

  return (
    <Card padded={false}>
      <CardHeader title="Client portal access" description="Invite-only. Each login sees this client's projects, shared files, reports and messages — nothing else." />
      <CardBody className="space-y-5">
        {active.length === 0 && data.invites.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No one from this client can sign in yet. Invite the owner below.</p>
        ) : (
          <ul className="space-y-3">
            {active.map((u) => (
              <li key={u.id} className="flex items-center gap-3">
                <Avatar name={u.name} color={u.avatarColor} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{u.name}</span>
                  <span className="block truncate text-[12px] text-ink-muted">{u.email}</span>
                </span>
                <Badge size="sm" tone={u.clientRole === "OWNER" ? "info" : "neutral"}>
                  {u.clientRole === "OWNER" ? "Owner" : "Member"}
                </Badge>
                <button type="button" onClick={() => void remove(u.id, u.name)} className="rounded p-1 text-ink-muted hover:text-danger-ink" aria-label={`Remove ${u.name}`}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
            {data.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-line text-ink-muted">
                  <UserPlus className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink/80">{i.name}</span>
                  <span className="block truncate text-[12px] text-ink-muted">
                    {i.email} · invited as {i.clientRole === "OWNER" ? "owner" : "member"}, until {formatDate(i.expiresAt)}
                  </span>
                </span>
                <button type="button" onClick={() => void remove(i.id, `the invitation for ${i.name}`)} className="rounded p-1 text-ink-muted hover:text-danger-ink" aria-label={`Withdraw invitation for ${i.name}`}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
            <Select
              label="Access"
              value={form.clientRole}
              onChange={(e) => setForm({ ...form, clientRole: e.target.value })}
              options={[
                { value: "OWNER", label: "Owner — also sees billing, invites people" },
                { value: "MEMBER", label: "Member — projects, reports, messages" },
              ]}
            />
          </div>
          <Button size="sm" icon={<UserPlus className="h-4 w-4" />} loading={busy} onClick={() => void invite()}>
            Invite to the portal
          </Button>
          {link && (
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-[12px] text-ink-2">
              <p className="mb-1.5">Their personal link — works once, for 7 days:</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-ink">{link}</code>
                <button type="button" aria-label="Copy the link" className="rounded p-1 hover:text-ink" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}>
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
