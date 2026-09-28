"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

type Service = { id?: string; slug: string; name: string };

/**
 * Convert a lead in one action (Phase 3 scope 7). Everything the lead
 * already knows is carried over by the server — this asks only for what a
 * lead cannot know yet: which services the first project covers, its dates,
 * and whether to open a portal login for the client.
 */
export function ConvertDialog({
  lead,
  services,
  onClose,
  onConverted,
}: {
  lead: { id: string; businessName: string; contactName: string; email: string | null; interestedServices: string[] } | null;
  services: Service[];
  onClose: () => void;
  onConverted: (clientId: string) => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [invite, setInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ clientId: string; email: string; temporaryPassword: string } | null>(null);

  useEffect(() => {
    if (!lead) return;
    // The services the lead said it wanted are the default plan.
    setSelected(services.filter((s) => s.id && lead.interestedServices.includes(s.slug)).map((s) => s.id!));
    setTitle("");
    const today = new Date().toISOString().slice(0, 10);
    setStart(today);
    setEnd(new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
    setInvite(Boolean(lead.email));
    setInviteName(lead.contactName);
    setInviteEmail(lead.email ?? "");
    setErrors({});
    setDone(null);
  }, [lead, services]);

  async function convert() {
    if (!lead) return;
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(`/api/leads/${lead.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: selected,
          projectTitle: title || undefined,
          startDate: start,
          endDate: end,
          invite: invite ? { name: inviteName, email: inviteEmail } : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.fields) setErrors(body.fields);
        return toast.error(body.error ?? "That conversion didn't go through — nothing was changed.");
      }
      toast.success(`${lead.businessName} is now a client.`);
      if (body.invitedUser) setDone({ clientId: body.clientId, ...body.invitedUser });
      else onConverted(body.clientId);
    } finally {
      setBusy(false);
    }
  }

  if (!lead) return null;

  if (done) {
    return (
      <Modal open onClose={() => onConverted(done.clientId)} title="Client login created" eyebrow={lead.businessName}>
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Share this with {inviteName} securely. It is shown once and not stored anywhere readable; they&rsquo;ll set their own password on first sign-in.
          </p>
          <div className="space-y-2 rounded-[10px] border border-line bg-surface-2 p-4 text-[13px] tabular-nums">
            <p>Email: <span className="text-ink">{done.email}</span></p>
            <p className="flex items-center gap-2">
              Temporary password: <span className="font-medium text-brand">{done.temporaryPassword}</span>
              <button
                type="button"
                aria-label="Copy password"
                onClick={() => void navigator.clipboard.writeText(done.temporaryPassword).then(() => toast.success("Copied."))}
                className="rounded-[8px] p-1 text-ink-muted hover:bg-surface hover:text-ink"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => onConverted(done.clientId)}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Convert ${lead.businessName}`}
      eyebrow="Won deal → client"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={() => void convert()}>Convert to client</Button>
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          One step: the client, its portal account and first project are created from this lead — contact details, notes,
          tags and answers carry over, and the lead&rsquo;s history moves with it. The lead is marked Won.
        </p>

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">First project covers</p>
          {errors.serviceIds && <p className="mb-2 text-[13px] text-danger">{errors.serviceIds}</p>}
          <div className="flex flex-wrap gap-1.5">
            {services.filter((s) => s.id).map((s) => {
              const on = selected.includes(s.id!);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id!]))}
                  className={cn(
                    "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                    on ? "border-brand/50 bg-brand-tint text-brand" : "border-line text-ink-muted hover:border-line-strong",
                  )}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Input label="Project name" placeholder={`${lead.businessName} — onboarding`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Input label="Starts" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="Ends" type="date" value={end} error={errors.endDate} onChange={(e) => setEnd(e.target.value)} />
        </div>

        <div className="space-y-3 rounded-card border border-line p-4">
          <Checkbox
            label="Give the client a portal login"
            hint="They'll see only their own restaurant, projects and reports."
            checked={invite}
            onChange={(e) => setInvite(e.target.checked)}
          />
          {invite && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
              <Input label="Email" type="email" value={inviteEmail} error={errors.inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
