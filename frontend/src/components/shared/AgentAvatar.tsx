import { cn } from "@/lib/utils";

const ROLE = {
  ceo: "bg-slate-900 text-white",
  director: "bg-indigo-600 text-white",
  coordinator: "bg-violet-500 text-white",
  sub_coordinator: "bg-sky-500 text-white",
  specialist: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
};

const STATUS = {
  working: "bg-violet-500 animate-pulse",
  idle: "bg-emerald-500",
  inactive: "bg-slate-300",
};

const SIZE = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-14 text-base",
};

export function initials(name: string) {
  const words = name.replace(/\b(agent|the)\b/gi, "").split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || name.slice(0, 2)).toUpperCase();
}

/** Initials colored by the agent's place in the hierarchy, with a live status dot. */
export function AgentAvatar({
  name,
  role,
  status,
  size = "md",
  className,
}: {
  name: string;
  role: string;
  status?: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-lg font-semibold",
          SIZE[size],
          ROLE[role as keyof typeof ROLE] ?? ROLE.specialist,
        )}
        aria-hidden
      >
        {initials(name)}
      </span>
      {status && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
            STATUS[status as keyof typeof STATUS] ?? STATUS.idle,
          )}
          title={status}
        />
      )}
    </span>
  );
}
