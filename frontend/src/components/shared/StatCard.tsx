import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CHIP = {
  slate: "bg-slate-100 text-slate-600",
  green: "bg-emerald-50 text-emerald-600",
  red: "bg-rose-50 text-rose-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  blue: "bg-sky-50 text-sky-600",
};

const VALUE = {
  slate: "",
  green: "",
  red: "text-rose-600",
  amber: "text-amber-700",
  violet: "",
  blue: "",
};

/** A headline number. The tone colors the icon chip; only problems (red, amber) also color the value. */
export function StatCard({
  label,
  value,
  hint,
  tone = "slate",
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: keyof typeof CHIP;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
          <div className={cn("mt-1.5 text-2xl font-semibold tracking-tight tabular-nums", VALUE[tone])}>{value}</div>
        </div>
        {icon && (
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", CHIP[tone])}>
            {icon}
          </div>
        )}
      </div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}
