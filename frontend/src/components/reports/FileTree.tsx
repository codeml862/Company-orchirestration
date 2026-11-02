"use client";

import { ChevronRight, Download, File, FileCode2, FileText, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { download } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CodePreview } from "./CodePreview";

export interface TreeFile {
  id: string;
  /** Relative path in the project, e.g. "src/app.py". */
  path: string;
  size_bytes: number;
  author?: string | null;
}

interface FolderNode {
  name: string;
  folders: Map<string, FolderNode>;
  files: { name: string; file: TreeFile }[];
}

function buildTree(files: TreeFile[]): FolderNode {
  const root: FolderNode = { name: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { name: part, folders: new Map(), files: [] });
      node = node.folders.get(part)!;
    }
    node.files.push({ name: parts.at(-1) ?? file.path, file });
  }
  return root;
}

function countFiles(node: FolderNode): number {
  return node.files.length + [...node.folders.values()].reduce((n, f) => n + countFiles(f), 0);
}

const CODE = /\.(py|ts|tsx|js|jsx|json|ya?ml|toml|html|css|sh|sql|go|rs|java|c|cpp|rb|php)$/i;
const TEXT = /\.(md|txt|rst|csv)$/i;

function FileIcon({ name }: { name: string }) {
  if (CODE.test(name)) return <FileCode2 className="size-4 shrink-0 text-sky-600" />;
  if (TEXT.test(name)) return <FileText className="size-4 shrink-0 text-slate-500" />;
  return <File className="size-4 shrink-0 text-slate-500" />;
}

const INDENT = 16; // px per level

interface RowProps {
  node: FolderNode;
  depth: number;
  closed: Set<string>;
  toggle: (path: string) => void;
  prefix: string;
  selected: string | null;
  onSelect: (file: TreeFile) => void;
}

function FolderRows({ node, depth, closed, toggle, prefix, selected, onSelect }: RowProps) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {folders.map((folder) => {
        const path = `${prefix}${folder.name}/`;
        const isOpen = !closed.has(path);
        return (
          <li key={path}>
            <button
              type="button"
              onClick={() => toggle(path)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-muted/70"
              style={{ paddingLeft: depth * INDENT + 8 }}
            >
              <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              {isOpen ? <FolderOpen className="size-4 shrink-0 text-amber-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />}
              <span className="font-medium">{folder.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{countFiles(folder)}</span>
            </button>
            {isOpen && (
              <ul>
                <FolderRows {...{ node: folder, depth: depth + 1, closed, toggle, prefix: path, selected, onSelect }} />
              </ul>
            )}
          </li>
        );
      })}
      {files.map(({ name, file }) => (
        <li
          key={file.id}
          className={cn(
            "group flex items-center gap-1.5 rounded-md pr-1 text-sm hover:bg-muted/70",
            selected === file.id && "bg-primary/10 hover:bg-primary/15",
          )}
          style={{ paddingLeft: depth * INDENT + 8 + 20 }}
        >
          <button
            type="button"
            onClick={() => onSelect(file)}
            aria-pressed={selected === file.id}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
            title={`Preview ${file.path}`}
          >
            <FileIcon name={name} />
            <span className="min-w-0 truncate font-mono text-[13px]">{name}</span>
          </button>
          <span className="ml-auto hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">
            {file.author ? `${file.author} · ` : ""}
            {formatBytes(file.size_bytes)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label={`Download ${file.path}`}
            onClick={() => download(file.id, name)}
          >
            <Download />
          </Button>
        </li>
      ))}
    </>
  );
}

/** Files shown as their project folder structure: folders collapse, a click previews a file. */
export function FileTree({ files, rootName }: { files: TreeFile[]; rootName: string }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [selected, setSelected] = useState<TreeFile | null>(null);
  // Every folder starts open, so the whole structure is visible at a glance.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <>
      <ul className="px-2 py-2" aria-label="Project files">
        <FolderRows
          node={{ name: "", folders: new Map([[rootName, { ...tree, name: rootName }]]), files: [] }}
          depth={0}
          closed={closed}
          toggle={toggle}
          prefix=""
          selected={selected?.id ?? null}
          onSelect={(file) => setSelected(selected?.id === file.id ? null : file)}
        />
      </ul>
      {selected ? (
        <CodePreview file={selected} onClose={() => setSelected(null)} />
      ) : (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Click a file to preview its code.</p>
      )}
    </>
  );
}
