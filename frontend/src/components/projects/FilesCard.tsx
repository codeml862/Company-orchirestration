"use client";

import { Download, FileText, Upload } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { download, upload } from "@/lib/api";
import { formatBytes, formatDate, humanize } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Artifact, Project } from "@/lib/types";

export function FilesCard({ project, canUpload, onUploaded }: { project: Project; canUpload: boolean; onUploaded: () => void }) {
  const { data: files, reload } = useApi<Artifact[]>(`/api/projects/${project.id}/artifacts`, 15000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await upload(project.id, file);
      await reload();
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <SectionCard
      title="Files & deliverables"
      flush
      actions={
        canUpload && (
          <Button size="sm" variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload /> {busy ? "Uploading…" : "Upload"}
              <input type="file" className="hidden" onChange={onFile} disabled={busy} />
            </label>
          </Button>
        )
      }
    >
      {error && <div className="px-5 pt-3 text-xs text-destructive">{error}</div>}
      {!files?.length ? (
        <EmptyState title="No files yet" hint="Client uploads and approved deliverables appear here." icon={<FileText className="size-5" />} />
      ) : (
        <ul className="divide-y">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground">
                  {humanize(f.kind)} · {formatBytes(f.size_bytes)} · {formatDate(f.created_at)}
                </div>
              </div>
              <Button size="icon" variant="ghost" aria-label={`Download ${f.name}`} onClick={() => download(f.id, f.name)}>
                <Download />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
