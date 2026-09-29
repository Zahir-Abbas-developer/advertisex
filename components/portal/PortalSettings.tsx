"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Copy, UserPlus, X } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { NotificationPreferences } from "@/components/notifications/NotificationCenter";
import { safeFetch } from "@/lib/safe-fetch";
import { formatDate } from "@/lib/date";

type Me = { name: string; email: string; phone: string | null; clientRole: string; prefs: { messages: boolean; reports: boolean; updates: boolean } };
type People = {
  users: { id: string; name: string; email: string; clientRole: string; isActive: boolean; avatarColor: string }[];
  invites: { id: string; name: string; email: string; expiresAt: string }[];
  viewer: { id: string; isOwner: boolean };
};

/** The client's settings (Phase 6 scope 7): profile, password, notifications, and who else can sign in. */
export function PortalSettings() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [invite, setInvite] = useState({ name: "", email: "" });
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([safeFetch("/api/portal/me", { cache: "no-store" }), safeFetch("/api/portal/people", { cache: "no-store" })]);
    if (!a.ok || !b.ok) return setFailed(true);
    setFailed(false);
    setMe((await a.json()).me);
    setPeople(await b.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchMe = async (data: Partial<Me>, done: string) => {
    setBusy("me");
    const res = await safeFetch("/api/portal/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setBusy(null);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "That didn't save");
    toast.success(done);
  };

  const changePassword = async () => {
    setBusy("pw");
    const res = await safeFetch("/api/me/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pw) });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPwErrors(body.fields ?? {});
      return toast.error(body.error ?? "Your password wasn't changed");
    }
    // The change signs out every other device — and this one, which signs
    // straight back in with the new password.
    await signIn("credentials", { email: body.email, password: pw.newPassword, redirect: false });
    setPw({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPwErrors({});
    toast.success("Password changed — you're signed out on other devices");
  };

  const sendInvite = async () => {
    setBusy("invite");
    const res = await safeFetch("/api/portal/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invite) });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setInviteErrors(body.fields ?? {});
      return toast.error(body.error ?? "The invitation wasn't sent");
    }
    setInvite({ name: "", email: "" });
    setInviteErrors({});
    setLink(`${window.location.origin}${body.link}`);
    toast.success(body.emailed ? "Invitation emailed" : "Invitation created — share the link below");
    void load();
  };

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Remove ${label}? They won't be able to sign in any more.`)) return;
    const res = await safeFetch(`/api/portal/people/${id}`, { method: "DELETE" });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't remove them");
    toast.success("Removed");
    void load();
  };

  if (failed) return <ErrorState title="Settings didn't load" onRetry={() => void load()} />;
  if (!me || !people) return <Skeleton className="h-96 rounded-card" />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Card padded={false}>
          <CardHeader title="Your profile" />
          <CardBody className="space-y-4">
            <Input label="Name" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} />
            <Input label="Email" value={me.email} disabled hint="To change your email, message your team." />
            <Input label="Phone" value={me.phone ?? ""} onChange={(e) => setMe({ ...me, phone: e.target.value })} />
            <Button loading={busy === "me"} onClick={() => void patchMe({ name: me.name, phone: me.phone || null }, "Profile saved")}>
              Save
            </Button>
          </CardBody>
        </Card>

        <Card padded={false}>
          <CardHeader title="Password" />
          <CardBody className="space-y-4">
            <Input label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} error={pwErrors.currentPassword} />
            <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={pwErrors.newPassword} />
            <Input label="Repeat the new password" type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} error={pwErrors.confirmPassword} />
            <Button variant="secondary" loading={busy === "pw"} onClick={() => void changePassword()}>
              Change password
            </Button>
          </CardBody>
        </Card>
      </div>

      <div className="min-w-0 space-y-6">
        <NotificationPreferences />

        <Card padded={false}>
          <CardHeader title="People on your account" description={people.viewer.isOwner ? "Invite colleagues to see your projects, reports and messages. Billing stays with you." : "Your account's owner can invite colleagues."} />
          <CardBody className="space-y-4">
            <ul className="space-y-3">
              {people.users.filter((u) => u.isActive).map((u) => (
                <li key={u.id} className="flex items-center gap-3">
                  <Avatar name={u.name} color={u.avatarColor} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">
                      {u.name}
                      {u.id === people.viewer.id ? " (you)" : ""}
                    </span>
                    <span className="block truncate text-[12px] text-ink-muted">{u.email}</span>
                  </span>
                  <Badge size="sm" tone={u.clientRole === "OWNER" ? "info" : "neutral"}>
                    {u.clientRole === "OWNER" ? "Owner" : "Member"}
                  </Badge>
                  {people.viewer.isOwner && u.clientRole !== "OWNER" && u.id !== people.viewer.id && (
                    <button type="button" onClick={() => void remove(u.id, u.name)} className="rounded p-1 text-ink-muted hover:text-danger" aria-label={`Remove ${u.name}`}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
              {people.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-line text-ink-muted">
                    <UserPlus className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink/80">{i.name}</span>
                    <span className="block truncate text-[12px] text-ink-muted">
                      {i.email} · invited, link valid until {formatDate(i.expiresAt)}
                    </span>
                  </span>
                  {people.viewer.isOwner && (
                    <button type="button" onClick={() => void remove(i.id, `the invitation for ${i.name}`)} className="rounded p-1 text-ink-muted hover:text-danger" aria-label={`Withdraw invitation for ${i.name}`}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {people.viewer.isOwner && (
              <div className="space-y-3 border-t border-line pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} error={inviteErrors.name} />
                  <Input label="Email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} error={inviteErrors.email} />
                </div>
                <Button size="sm" icon={<UserPlus className="h-4 w-4" />} loading={busy === "invite"} onClick={() => void sendInvite()}>
                  Invite
                </Button>
                {link && (
                  <div className="rounded-lg border border-line bg-surface-2 p-3 text-[12px] text-ink-2">
                    <p className="mb-1.5">Share this link with them — it works once, for 7 days:</p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-ink">{link}</code>
                      <button type="button" aria-label="Copy the link" className="rounded p-1 hover:text-ink" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}>
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
