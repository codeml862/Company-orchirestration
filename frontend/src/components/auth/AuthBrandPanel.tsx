import { Activity, ArrowRight, Bot, ShieldCheck, Sparkles } from "lucide-react";

const FEATURES = [
  {
    icon: Bot,
    title: "A complete AI workforce",
    text: "A CEO agent, department coordinators and specialist agents plan and deliver client work.",
  },
  {
    icon: ShieldCheck,
    title: "People stay in control",
    text: "Spending, external actions and final delivery always wait for a human decision.",
  },
  {
    icon: Activity,
    title: "Every step on the record",
    text: "Live operations, independent QA reviews and a complete audit trail.",
  },
];

const WORKFLOW = ["Analyze", "Plan", "Execute", "Review", "Deliver"];

/** The left half of the sign-in screen: what Orchestria is, in brand colors. Hidden on small screens. */
export function AuthBrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-linear-to-br from-indigo-600 via-indigo-800 to-slate-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="pointer-events-none absolute -top-32 -left-32 size-[28rem] rounded-full bg-indigo-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 -bottom-40 size-[30rem] rounded-full bg-violet-500/25 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.06)_1px,transparent_1px)] mask-[radial-gradient(ellipse_at_center,black_30%,transparent_75%)] bg-size-[36px_36px]" />

      <div className="relative flex items-center gap-2.5 text-lg font-semibold">
        <div className="flex size-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
          <Sparkles className="size-4.5" />
        </div>
        Orchestria
      </div>

      <div className="relative max-w-lg">
        <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-indigo-100 ring-1 ring-white/20">
          AI agent outsourcing company
        </span>
        <h1 className="mt-5 text-4xl leading-tight font-semibold tracking-tight text-balance">
          Your AI workforce, supervised by people.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-indigo-100/80">
          Clients describe the outcome they need. Agents analyze, plan, deliver and review the work, and your team approves
          what matters.
        </p>
        <ul className="mt-10 space-y-5">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                <Icon className="size-5 text-indigo-100" />
              </div>
              <div>
                <div className="font-medium">{title}</div>
                <div className="text-sm text-indigo-100/70">{text}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative space-y-6">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-indigo-100/90">
          {WORKFLOW.map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="rounded-md bg-white/10 px-2.5 py-1 ring-1 ring-white/15">{step}</span>
              {i < WORKFLOW.length - 1 && <ArrowRight className="size-3.5 text-indigo-200/60" />}
            </span>
          ))}
        </div>
        <p className="text-xs text-indigo-100/50">© {new Date().getFullYear()} Orchestria · AI Agent Outsourcing Company</p>
      </div>
    </aside>
  );
}
