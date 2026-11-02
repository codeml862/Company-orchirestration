import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const TONES = {
  primary: "",
  green: "[&_[data-slot=progress-indicator]]:bg-emerald-500",
};

export function ProgressBar({ value, max, tone = "primary", className }: { value: number; max: number; tone?: keyof typeof TONES; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <Progress value={pct} className={cn("h-2", TONES[tone], className)} />;
}
