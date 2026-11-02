import { Badge } from "@/components/ui/badge";
import { type Tone, humanize, statusTone } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<Tone, string> = {
  gray: "border-slate-200 bg-slate-50 text-slate-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

/** A small colored label; the tone carries meaning (green = done, amber = waiting, red = problem). */
export function ToneBadge({ tone = "gray", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TONE_CLASSES[tone], className)}>
      {children}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <ToneBadge tone={statusTone(status)}>
      {(status === "running" || status === "working") && <span className="size-1.5 animate-pulse rounded-full bg-violet-500" />}
      {humanize(status)}
    </ToneBadge>
  );
}
