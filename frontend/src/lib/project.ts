import type { Project } from "./types";

export function progressOf(p: Project) {
  const total = Object.values(p.task_counts).reduce((a, b) => a + b, 0);
  return { done: p.task_counts.approved ?? 0, total };
}
