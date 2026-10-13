/**
 * What the Firstmate progress panel (components/FirstmatePanel.tsx) says about a collection.
 * The panel's text is Brazilian Portuguese on purpose: this fork carries the panel for one
 * user, so it is not run through `t()` and the app's dictionaries.
 *
 * A state the home did not confirm stays unconfirmed: nothing here turns an activity line into
 * progress, a percentage or a finish time.
 */
import type { FirstmateTask } from "../../shared/protocol.ts";

/** the five looks a task can take; several home states share one */
export type Tone = "working" | "waiting" | "blocked" | "done" | "unknown";
export const TONES: readonly Tone[] = ["working", "waiting", "blocked", "done", "unknown"];

export function toneOf(state: string): Tone {
  switch (state) {
    case "working": return "working";
    case "parked": case "paused": return "waiting";
    case "blocked": case "failed": return "blocked";
    case "done": return "done";
    default: return "unknown";
  }
}

const STATE_LABELS: Record<string, string> = {
  working: "Em execução", parked: "Aguardando", paused: "Pausada", blocked: "Bloqueada", failed: "Falhou", done: "Concluída",
};
export const stateLabel = (state: string): string => STATE_LABELS[state] ?? "Não verificável";

/** the overview's word for each tone, counted over the whole project */
export const TONE_LABELS: Record<Tone, string> = {
  working: "Em andamento", waiting: "Aguardando", blocked: "Bloqueada", done: "Concluída", unknown: "Sem confirmação",
};

const KIND_LABELS: Record<string, string> = { ship: "Implementação", scout: "Investigação", secondmate: "Secondmate" };
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

export function badgeOf(task: FirstmateTask): string | null {
  if (task.decision) return "Decisão pendente";
  switch (task.state) {
    case "working": return "Em atividade";
    case "blocked": return "Bloqueio";
    case "failed": return "Falha registrada";
    case "done": case "parked": case "paused": return null;
    default: return "Estado não verificável";
  }
}

export interface ProjectGroup {
  readonly key: string;
  readonly label: string;
  readonly tasks: readonly FirstmateTask[];
}

/** one group per repository, in the order the snapshot lists them; a task without one goes under "Sem projeto" */
export function groupByProject(tasks: readonly FirstmateTask[]): ProjectGroup[] {
  const groups = new Map<string, FirstmateTask[]>();
  for (const task of tasks) {
    const key = task.repo ?? "";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups].map(([key, list]) => ({ key, label: key || "Sem projeto", tasks: list }));
}

export function toneCounts(tasks: readonly FirstmateTask[]): Record<Tone, number> {
  const counts: Record<Tone, number> = { working: 0, waiting: 0, blocked: 0, done: 0, unknown: 0 };
  for (const task of tasks) counts[toneOf(task.state)] += 1;
  return counts;
}

export function summaryLine(counts: Record<Tone, number>): string {
  const attention = counts.waiting + counts.blocked;
  if (attention > 0) return attention === 1 ? "1 tarefa precisa de atenção." : `${attention} tarefas precisam de atenção.`;
  const total = TONES.reduce((sum, tone) => sum + counts[tone], 0);
  if (counts.unknown === total) return "A coleta não confirma quais tarefas estão executando.";
  return "Nenhuma tarefa precisa de atenção agora.";
}

/** Agora is what is still open; Histórico is what the collection itself reports as done */
export function splitFeed(tasks: readonly FirstmateTask[]): { now: FirstmateTask[]; past: FirstmateTask[] } {
  return { now: tasks.filter((task) => task.state !== "done"), past: tasks.filter((task) => task.state === "done") };
}

export const taskCount = (n: number): string => n === 1 ? "1 tarefa" : `${n} tarefas`;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pad = (n: number): string => String(n).padStart(2, "0");

/** "13 out 2026 · 11:14" in the browser's local time, or null for a stamp that does not parse */
export function collectedAt(iso: string | null): string | null {
  const date = iso === null ? null : new Date(iso);
  if (date === null || Number.isNaN(date.getTime())) return null;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** the task's time column: when it was collected, never a guessed time of the event */
export function collectedTime(iso: string | null): string | null {
  const date = iso === null ? null : new Date(iso);
  if (date === null || Number.isNaN(date.getTime())) return null;
  return `coleta ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
