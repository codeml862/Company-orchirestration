"use client";

import { Check, Copy, Download, FileCode2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { download, fetchText } from "@/lib/api";
import { formatBytes } from "@/lib/format";

import type { TreeFile } from "./FileTree";

const MAX_PREVIEW_BYTES = 500_000;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|exe|dll|so|bin|woff2?|ttf|mp[34]|mov|xlsx?|docx?|pptx?)$/i;

/** Read-only view of one file with line numbers. */
export function CodePreview({ file, onClose }: { file: TreeFile; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const name = file.path.split("/").at(-1) ?? file.path;
  const previewable = !BINARY.test(name) && file.size_bytes <= MAX_PREVIEW_BYTES;

  useEffect(() => {
    let current = true;
    setText(null);
    setError(null);
    if (!previewable) return;
    fetchText(file.id)
      .then((t) => current && setText(t))
      .catch((e) => current && setError(e instanceof Error ? e.message : "Could not load the file"));
    return () => {
      current = false;
    };
  }, [file.id, previewable]);

  async function copy() {
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: nothing to do
    }
  }

  const lines = text?.replace(/\n$/, "").split("\n") ?? [];
  return (
    <div className="border-t">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <FileCode2 className="size-4 shrink-0 text-sky-600" />
        <span className="min-w-0 truncate font-mono text-[13px] font-medium" title={file.path}>
          {file.path}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {text !== null && `${lines.length} lines · `}
          {formatBytes(file.size_bytes)}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          <Button size="icon" variant="ghost" className="size-7" aria-label="Copy file contents" onClick={copy} disabled={text === null}>
            {copied ? <Check /> : <Copy />}
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label={`Download ${file.path}`} onClick={() => download(file.id, name)}>
            <Download />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label="Close preview" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      {!previewable ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          This file can&apos;t be previewed here. Download it to open it.
        </p>
      ) : error ? (
        <p className="px-4 py-6 text-center text-sm text-destructive">{error}</p>
      ) : text === null ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        // contain: long lines scroll inside the box instead of widening the page
        <div className="max-h-[32rem] overflow-auto bg-slate-950 text-slate-100 [contain:inline-size]">
          <table className="w-full border-collapse font-mono text-[12.5px] leading-5">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-white/5">
                  <td className="sticky left-0 w-px select-none border-r border-white/10 bg-slate-950 px-3 text-right text-slate-500 tabular-nums">
                    {i + 1}
                  </td>
                  <td className="whitespace-pre px-4">{line || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
