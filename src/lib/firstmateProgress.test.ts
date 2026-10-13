import { describe, expect, it } from "bun:test";

import type { FirstmateTask } from "../../shared/protocol.ts";
import { badgeOf, collectedAt, groupByProject, splitFeed, stateLabel, summaryLine, toneCounts, toneOf } from "./firstmateProgress.ts";

const task = (id: string, state: string, repo: string | null = "firstmate", decision = false): FirstmateTask =>
  ({ id, kind: "ship", state, repo, name: id, doing: "", decision, lavish_url: null });

describe("firstmate progress", () => {
  it("keeps an unconfirmed state unconfirmed", () => {
    expect(toneOf("unknown")).toBe("unknown");
    expect(toneOf("something-new")).toBe("unknown");
    expect(stateLabel("something-new")).toBe("Não verificável");
    expect(badgeOf(task("a", "unknown"))).toBe("Estado não verificável");
    expect(summaryLine(toneCounts([task("a", "unknown"), task("b", "unknown")]))).toBe("A coleta não confirma quais tarefas estão executando.");
  });

  it("counts what needs attention and names an open decision", () => {
    const tasks = [task("a", "working"), task("b", "parked", "firstmate", true), task("c", "failed"), task("d", "done")];
    expect(toneCounts(tasks)).toEqual({ working: 1, waiting: 1, blocked: 1, done: 1, unknown: 0 });
    expect(summaryLine(toneCounts(tasks))).toBe("2 tarefas precisam de atenção.");
    expect(summaryLine(toneCounts([task("a", "parked")]))).toBe("1 tarefa precisa de atenção.");
    expect(summaryLine(toneCounts([task("a", "working"), task("b", "unknown")]))).toBe("Nenhuma tarefa precisa de atenção agora.");
    expect(badgeOf(tasks[1]!)).toBe("Decisão pendente");
    expect(splitFeed(tasks)).toEqual({ now: tasks.slice(0, 3), past: [tasks[3]!] });
  });

  it("groups by repository in snapshot order", () => {
    const groups = groupByProject([task("a", "working", "herdr-web-ui"), task("b", "working", null), task("c", "working", "herdr-web-ui")]);
    expect(groups.map((group) => [group.key, group.label, group.tasks.map((t) => t.id)])).toEqual([
      ["herdr-web-ui", "herdr-web-ui", ["a", "c"]], ["", "Sem projeto", ["b"]],
    ]);
  });

  it("formats the collection time and refuses a stamp that does not parse", () => {
    expect(collectedAt("2026-10-13T14:14:55Z")).toMatch(/^1[34] out 2026 · \d\d:\d\d$/);
    expect(collectedAt("never")).toBeNull();
    expect(collectedAt(null)).toBeNull();
  });
});
