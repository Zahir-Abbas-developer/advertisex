"use client";

import { useState } from "react";
import { Upload } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CSV_COLUMNS } from "@/modules/leads/csv";

type Preview = {
  summary: { total: number; valid: number; invalid: number; duplicates: number; willImport: number };
  rows: ({ line: number; ok: true; businessName: string; duplicateOf: string | null } | { line: number; ok: false; errors: string[] })[];
};

/**
 * Import leads from CSV, in two steps: preview (every row validated,
 * duplicates flagged, nothing written), then import. Duplicates are skipped
 * unless the person explicitly includes them.
 */
export function ImportLeadsModal({
  open,
  departmentId,
  departmentName,
  onClose,
  onImported,
}: {
  open: boolean;
  departmentId: string;
  departmentName: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("departmentId", departmentId);
      form.append("mode", mode);
      form.append("includeDuplicates", String(includeDuplicates));
      const res = await fetch("/api/leads/import", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(body.error ?? "That import didn't work.");
      if (mode === "preview") setPreview(body);
      else {
        toast.success(`Imported ${body.summary.imported} lead${body.summary.imported === 1 ? "" : "s"} into ${departmentName}.`);
        reset();
        onImported();
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setIncludeDuplicates(false);
  }

  const willImport = preview ? preview.summary.valid - (includeDuplicates ? 0 : preview.summary.duplicates) : 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import leads"
      eyebrow={departmentName}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          {preview ? (
            <Button loading={busy} disabled={willImport === 0} onClick={() => void send("commit")}>
              Import {willImport} lead{willImport === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button loading={busy} disabled={!file} onClick={() => void send("preview")}>Check file</Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          A CSV with a header row. <span className="text-ink/80">business_name</span> and <span className="text-ink/80">contact_name</span> are required; the rest are optional:{" "}
          <span className="text-ink-muted">{CSV_COLUMNS.slice(2).join(", ")}</span>. An export from this page is already in this format.
        </p>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-line-strong px-4 py-8 text-[13px] text-ink-muted hover:bg-surface-2">
          <Upload className="h-4 w-4" />
          {file ? file.name : "Choose a CSV file"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </label>

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-[13px]">
              <Badge tone="success">{preview.summary.valid} valid</Badge>
              {preview.summary.invalid > 0 && <Badge tone="danger">{preview.summary.invalid} with problems</Badge>}
              {preview.summary.duplicates > 0 && <Badge tone="warning">{preview.summary.duplicates} possible duplicates</Badge>}
            </div>
            {preview.summary.duplicates > 0 && (
              <Checkbox
                label="Import possible duplicates too"
                hint="Off by default — a duplicate usually means someone is already working that business."
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
            )}
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-[10px] border border-line p-3 text-[12px]">
              {preview.rows
                .filter((r) => !r.ok || r.duplicateOf)
                .map((r) => (
                  <li key={r.line} className={r.ok ? "text-ink" : "text-danger"}>
                    Line {r.line}: {r.ok ? `${r.businessName} — duplicate of ${r.duplicateOf}` : r.errors.join("; ")}
                  </li>
                ))}
              {preview.rows.every((r) => r.ok && !r.duplicateOf) && <li className="text-ink-muted">Every row is valid and new.</li>}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
