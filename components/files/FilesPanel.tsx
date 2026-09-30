"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff, FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/utils";
import { formatDate } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";

export type FileItem = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  visibility: string;
  createdAt: string;
  uploader: { id: string; name: string } | null;
  previewUrl: string | null;
  downloadUrl: string;
};

type Owner = { clientId: string } | { projectId: string } | { contractId: string };

/**
 * Files on a client, project or contract (Phase 4 scope 5). Private storage:
 * every link here is a signed URL that works for five minutes, so a list is
 * re-fetched rather than trusted when it is old.
 */
export function FilesPanel({
  owner,
  canUpload,
  canChangeVisibility,
  viewerId,
  compact = false,
}: {
  owner: Owner;
  canUpload: boolean;
  /** Founder and managers: share with the client, and remove anyone's file. */
  canChangeVisibility: boolean;
  /** Everyone else removes only what they uploaded. */
  viewerId?: string;
  compact?: boolean;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [visibility, setVisibility] = useState<"INTERNAL" | "CLIENT">("INTERNAL");
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const query = new URLSearchParams(owner as Record<string, string>).toString();

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/files?${query}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setFiles((await res.json()).files);
    setLoadedAt(Date.now());
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Signed links last five minutes; refresh the list before opening a stale one.
  const fresh = async (file: FileItem): Promise<FileItem | null> => {
    if (Date.now() - loadedAt < 4 * 60_000) return file;
    const res = await safeFetch(`/api/files?${query}`, { cache: "no-store" });
    if (!res.ok) return null;
    const list: FileItem[] = (await res.json()).files;
    setFiles(list);
    setLoadedAt(Date.now());
    return list.find((f) => f.id === file.id) ?? null;
  };

  const upload = async (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    form.set("visibility", visibility);
    for (const [k, v] of Object.entries(owner)) form.set(k, v);
    const res = await safeFetch("/api/files", { method: "POST", body: form }).catch(() => null);
    setUploading(false);
    if (!res) return toast.error("The upload didn't reach the server — check your connection");
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "That file didn't upload");
      return;
    }
    toast.success(`${file.name} uploaded`);
    void load();
  };

  const toggle = async (file: FileItem) => {
    const next = file.visibility === "CLIENT" ? "INTERNAL" : "CLIENT";
    const res = await safeFetch(`/api/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't change that");
    toast.success(next === "CLIENT" ? "Now visible to the client" : "Now internal only");
    void load();
  };

  const remove = async (file: FileItem) => {
    if (!window.confirm(`Remove ${file.filename}? This can't be undone.`)) return;
    const res = await safeFetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't remove that");
    toast.success("File removed");
    void load();
  };

  const open = async (file: FileItem, mode: "preview" | "download") => {
    const f = await fresh(file);
    if (!f) return toast.error("That file is no longer available");
    if (mode === "preview" && f.mimeType.startsWith("image/")) return setPreview(f);
    window.open(mode === "preview" ? f.previewUrl ?? f.downloadUrl : f.downloadUrl, "_blank", "noopener");
  };

  if (failed) return <ErrorState title="Files didn't load" onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} loading={uploading} onClick={() => input.current?.click()}>
            Upload file
          </Button>
          {canChangeVisibility && (
            <label className="flex items-center gap-2 text-[13px] text-ink-muted">
              <input
                type="checkbox"
                className="accent-brand"
                checked={visibility === "CLIENT"}
                onChange={(e) => setVisibility(e.target.checked ? "CLIENT" : "INTERNAL")}
              />
              Visible to the client
            </label>
          )}
          <span className="text-[12px] text-ink-muted">Images, PDFs, documents and archives · up to 10 MB</span>
        </div>
      )}

      {!files ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="No files yet"
          description={canUpload ? "Contracts, briefs, designs and reports live here, privately." : "Nothing has been shared here yet."}
          className={compact ? "py-8" : undefined}
        />
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              {f.mimeType.startsWith("image/") ? <ImageIcon className="h-4 w-4 shrink-0 text-ink-muted" /> : <FileText className="h-4 w-4 shrink-0 text-ink-muted" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{f.filename}</p>
                <p className="text-[12px] text-ink-muted">
                  {formatBytes(f.size)} · {formatDate(f.createdAt)}
                  {f.uploader ? ` · ${f.uploader.name}` : ""}
                </p>
              </div>
              {/* Who can see a file is the team's question; the client sees only what's shared. */}
              {canUpload && (
                <Badge tone={f.visibility === "CLIENT" ? "info" : "neutral"} size="sm">
                  {f.visibility === "CLIENT" ? "Client can see" : "Internal"}
                </Badge>
              )}
              <div className="flex items-center gap-1">
                {f.previewUrl && (
                  <button type="button" onClick={() => void open(f, "preview")} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Preview ${f.filename}`}>
                    <Eye className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={() => void open(f, "download")} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Download ${f.filename}`}>
                  <Download className="h-4 w-4" />
                </button>
                {canChangeVisibility && (
                  <button
                    type="button"
                    onClick={() => void toggle(f)}
                    className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
                    aria-label={f.visibility === "CLIENT" ? `Make ${f.filename} internal` : `Share ${f.filename} with the client`}
                  >
                    {f.visibility === "CLIENT" ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4 text-success-ink" />}
                  </button>
                )}
                {canUpload && (canChangeVisibility || (viewerId && f.uploader?.id === viewerId)) && (
                  <button type="button" onClick={() => void remove(f)} className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-danger-ink" aria-label={`Remove ${f.filename}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.filename ?? ""} size="lg">
        {preview?.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived private URL; next/image would proxy and cache it
          <img src={preview.previewUrl} alt={preview.filename} className="mx-auto max-h-[70vh] rounded-lg" />
        )}
      </Modal>
    </div>
  );
}
