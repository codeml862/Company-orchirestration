import { Sparkles } from "lucide-react";

/** Inline loader for panels and drawers: three bouncing dots and a label. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full bg-violet-500"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}

/** Full-screen branded splash shown while the app decides where to send the user. */
export function LoadingScreen({ label = "Loading your workspace…", children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div
      role="status"
      className="relative flex min-h-svh flex-col items-center justify-center gap-6 overflow-hidden bg-sidebar px-6 text-center"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 blur-3xl"
      />
      <div className="relative flex size-16 items-center justify-center">
        <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-violet-500/25 [animation-duration:2s]" />
        <span aria-hidden className="absolute -inset-2 animate-spin rounded-3xl border-2 border-transparent border-t-violet-500 border-r-indigo-400 [animation-duration:1.4s]" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-600 text-white shadow-xl shadow-violet-500/30">
          <Sparkles className="size-7" />
        </div>
      </div>
      <div className="relative space-y-1">
        <div className="text-lg font-semibold tracking-tight">Orchestria</div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <div aria-hidden className="relative h-1 w-48 overflow-hidden rounded-full bg-muted">
        <div className="loading-bar absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-indigo-400 to-violet-600" />
      </div>
      {children}
    </div>
  );
}
