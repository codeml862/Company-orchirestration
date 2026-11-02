import { Inbox } from "lucide-react";

export function EmptyState({ title, hint, icon }: { title: string; hint?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="mt-1 max-w-md text-sm text-muted-foreground">{hint}</div>}
    </div>
  );
}
