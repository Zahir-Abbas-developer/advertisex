"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import type { AgentRow } from "@/modules/ai/agents/server";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/safe-fetch";

type Subject = { id: string; label: string; hint: string };

const NOUN: Record<string, string> = { lead: "lead", client: "client", project: "project" };

/** Give an agent one piece of work: pick the record its capability works on, add an optional brief. */
export function GiveWorkModal({ agent, onClose, onStarted }: { agent: AgentRow; onClose: () => void; onStarted: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const cap = agent.capability!;
  const needsSubject = cap.subjectType !== "organization";
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Subject[] | null>(null);
  const [picked, setPicked] = useState<Subject | null>(null);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!needsSubject) return;
    const t = setTimeout(async () => {
      const res = await safeFetch(`/api/agents/subjects?type=${cap.subjectType}&q=${encodeURIComponent(q)}`, { cache: "no-store" });
      setResults(res.ok ? ((await res.json()) as { results: Subject[] }).results : []);
    }, 200);
    return () => clearTimeout(t);
  }, [q, cap.subjectType, needsSubject]);

  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await safeFetch("/api/agents/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, subjectType: cap.subjectType, subjectId: picked?.id ?? null, brief: brief.trim() || null }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "It couldn't start");
    toast.success(`${agent.name} is on it`);
    onStarted();
    onClose();
    router.push(`/agents/runs/${body.run.id}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={cap.name}
      title={`Give ${agent.name} work`}
      description={cap.description}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={needsSubject && !picked} onClick={() => void start()}>
            Start
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {needsSubject ? (
          <div className="space-y-2">
            <Input label={`Which ${NOUN[cap.subjectType]}?`} placeholder="Search by name" icon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="max-h-60 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label={`Matching ${NOUN[cap.subjectType]}s`}>
              {results === null ? (
                <li className="px-3 py-2.5 text-[13px] text-ink-muted">Searching…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2.5 text-[13px] text-ink-muted">No {NOUN[cap.subjectType]}s match.</li>
              ) : (
                results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={picked?.id === r.id}
                      onClick={() => setPicked(r)}
                      className={cn("flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] transition-colors duration-150 hover:bg-surface-2", picked?.id === r.id && "bg-brand/[0.06]")}
                    >
                      <span className="truncate font-medium text-ink">{r.label}</span>
                      <span className="shrink-0 text-[12px] text-ink-muted">{r.hint}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">This works across the whole agency — no record to pick.</p>
        )}
        <Textarea label="Brief (optional)" hint="Anything it should know. It's treated as instructions from you." rows={3} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} />
        {error && (
          <p role="alert" className="text-[13px] text-danger-ink">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
