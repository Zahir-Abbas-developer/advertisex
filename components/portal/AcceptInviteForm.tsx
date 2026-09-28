"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { safeFetch } from "@/lib/safe-fetch";

/** Sets the invited person's name and password, then signs them straight in. */
export function AcceptInviteForm({ token, email, name: initialName }: { token: string; email: string; name: string }) {
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (password !== confirm) return setErrors({ confirm: "Those passwords don't match" });
    setBusy(true);
    const res = await safeFetch("/api/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name, password }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setErrors(body.fields ?? {});
      return setFormError(body.error ?? "That didn't work — please try again.");
    }
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.ok) window.location.href = "/portal";
    else window.location.href = "/login";
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <Input label="Email" value={email} disabled />
      <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" />
      <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="At least 10 characters" autoComplete="new-password" />
      <Input label="Repeat the password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} autoComplete="new-password" />
      {formError && (
        <p role="alert" className="text-[13px] text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" fullWidth loading={busy}>
        Create my account
      </Button>
    </form>
  );
}
