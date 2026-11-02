import {
  Building2,
  Cpu,
  Crown,
  FlaskConical,
  Headphones,
  Landmark,
  type LucideIcon,
  Megaphone,
  TrendingUp,
  UsersRound,
  Workflow,
} from "lucide-react";

import { cn } from "@/lib/utils";

const DEPARTMENTS: Record<string, { icon: LucideIcon; tint: string }> = {
  executive: { icon: Crown, tint: "bg-slate-900 text-white" },
  operations: { icon: Workflow, tint: "bg-indigo-50 text-indigo-600" },
  technology: { icon: Cpu, tint: "bg-sky-50 text-sky-600" },
  hr: { icon: UsersRound, tint: "bg-pink-50 text-pink-600" },
  marketing: { icon: Megaphone, tint: "bg-orange-50 text-orange-600" },
  sales: { icon: TrendingUp, tint: "bg-emerald-50 text-emerald-600" },
  finance: { icon: Landmark, tint: "bg-amber-50 text-amber-700" },
  support: { icon: Headphones, tint: "bg-teal-50 text-teal-600" },
  research: { icon: FlaskConical, tint: "bg-violet-50 text-violet-600" },
};

export function DepartmentIcon({ department, className }: { department: string | null | undefined; className?: string }) {
  const { icon: Icon, tint } = DEPARTMENTS[department ?? ""] ?? { icon: Building2, tint: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tint, className)}>
      <Icon className="size-5" />
    </span>
  );
}
