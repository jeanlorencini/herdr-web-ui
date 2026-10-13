import { describe, expect, it } from "bun:test";

import { FirstmateProgressService, handleFirstmateRequest, lavishByTask, plainActivity, project } from "./firstmate.ts";

const HOME = "C:\\Users\\me\\firstmate";

const snapshot = (inFlight: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({
  schema: "fm-bearings.v1", home: "me/firstmate", generated: "2026-10-13T14:14:55Z", in_flight: inFlight,
  decisions_open: [{ id: "held-01", key: "held-01", verb: "captain-hold", summary: "x", owner: "(main)" }],
  landed: [{ id: "old", what: "secret landed title", artifact: "https://example.invalid/pr/1", owner: "(main)" }],
  omitted: [
    { surface: "task paths", reveal: "--fields paths" },
    { surface: "landed per-home capped at 6 for 1 home(s)", reveal: "--all-landed" },
    { surface: "secondmate sm-1 active children omitted by snapshot bound: 2", reveal: "raise FM_SNAPSHOT_SECONDMATE_CHILDREN" },
  ],
  ...extra,
});

const row = (id: string, state: string, repo: string | null = "firstmate") => ({ id, kind: "ship", state, repo, name: `Task ${id}`, doing: `paused [at=1791898902]: waiting on ${id}` });

describe("project", () => {
  it("keeps only the panel's fields and the in-flight omissions", () => {
    const collected = project(JSON.parse(snapshot([row("a-01", "working"), row("held-01", "parked", null), { id: "", state: "working" }])));
    expect(collected.generatedAt).toBe("2026-10-13T14:14:55Z");
    expect(collected.tasks).toEqual([
      { id: "a-01", kind: "ship", state: "working", repo: "firstmate", name: "Task a-01", doing: "paused: waiting on a-01", decision: false, lavish_url: null },
      { id: "held-01", kind: "ship", state: "parked", repo: null, name: "Task held-01", doing: "paused: waiting on held-01", decision: true, lavish_url: null },
    ]);
    expect(collected.omitted).toEqual(["secondmate sm-1 active children omitted by snapshot bound: 2"]);
    expect(JSON.stringify(collected)).not.toContain("secret landed title");
  });

  it("drops internal identifiers and paths from the activity line", () => {
    expect(plainActivity("backend target gone: default:wX:p3")).toBe("backend target gone");
    expect(plainActivity("paused [at=1791898902]: no-mistakes run 01M4TNE92405XQH5A50KA7VQW7 is in its CI step on ht…")).toBe("paused: no-mistakes run is in its CI step on ht…");
    expect(plainActivity("wrote C:\\Users\\me\\firstmate\\data\\x\\report.md and /home/me/fm/data/y.md")).toBe("wrote and");
    expect(plainActivity("PR https://github.com/o/r/pull/9 opened")).toBe("PR opened");
    expect(plainActivity("harness busy (claude-hook)")).toBe("harness busy (claude-hook)");
  });

  it("refuses output that is not a bearings snapshot", () => {
    expect(() => project({ schema: "fm-fleet.v1", in_flight: [] })).toThrow(SyntaxError);
    expect(() => project(null)).toThrow(SyntaxError);
  });
});

describe("lavishByTask", () => {
  const state = JSON.stringify({ sessions: [
    { key: "a", status: "open", file: `${HOME}\\data\\a-01\\board.html`, url: "http://127.0.0.1:4387/session/aaaa" },
    { key: "b", status: "ended", file: `${HOME}\\data\\b-01\\board.html`, url: "http://127.0.0.1:4387/session/bbbb" },
    { key: "c", status: "open", file: "C:\\elsewhere\\data\\c-01\\board.html", url: "http://127.0.0.1:4387/session/cccc" },
    { key: "d", status: "open", file: `${HOME}\\data\\d-01\\board.html`, url: "javascript:alert(1)" },
    { key: "e", status: "open", file: "c:/users/me/firstmate/data/e-01/x/board.html", url: "http://localhost:4387/session/eeee" },
  ] });

  it("links only open sessions under the home's data folder, by task", () => {
    expect([...lavishByTask(state, HOME)]).toEqual([["a-01", "http://127.0.0.1:4387/session/aaaa"], ["e-01", "http://localhost:4387/session/eeee"]]);
    expect(lavishByTask("not json", HOME).size).toBe(0);
  });
});

describe("FirstmateProgressService", () => {
  it("answers unavailable before a collection, then caches and goes stale", async () => {
    let clock = 1_000_000;
    let runs = 0;
    let fail = true;
    const service = new FirstmateProgressService({
      home: HOME, now: () => clock, intervalMs: 60_000, staleMs: 300_000,
      run: async () => { runs += 1; if (fail) throw new Error("boom"); return snapshot([row("a-01", "working")]); },
      readLavish: () => JSON.stringify({ sessions: [{ status: "open", file: `${HOME}/data/a-01/b.html`, url: "http://127.0.0.1:4387/session/abc" }] }),
    });

    expect(await service.report()).toEqual({ configured: true, status: "unavailable", generated_at: null, tasks: [], omitted: [], error: "failed" });
    fail = false;
    expect((await service.report()).status).toBe("unavailable"); // inside the interval: no new run
    expect(runs).toBe(1);

    clock += 60_000;
    const ok = await service.report();
    expect(runs).toBe(2);
    expect(ok).toMatchObject({ status: "ok", generated_at: "2026-10-13T14:14:55Z", error: null });
    expect(ok.tasks[0]!.lavish_url).toBe("http://127.0.0.1:4387/session/abc");

    fail = true;
    clock += 301_000;
    // starts a failing run and answers from the cache, which is past the stale limit
    expect(await service.report()).toMatchObject({ status: "stale", generated_at: "2026-10-13T14:14:55Z" });
    expect(runs).toBe(3);
  });

  it("only hides the Lavish links when the Lavish state cannot be read", async () => {
    const service = new FirstmateProgressService({ home: HOME, run: async () => snapshot([row("a-01", "working")]), readLavish: () => { throw new Error("EACCES"); } });
    const report = await service.report();
    expect(report).toMatchObject({ status: "ok", error: null });
    expect(report.tasks.map((task) => task.lavish_url)).toEqual([null]);
  });

  it("answers configured: false without a service and refuses other methods", async () => {
    const off = await handleFirstmateRequest(new Request("http://x/api/firstmate/progress"), null);
    expect(off.headers.get("cache-control")).toBe("no-store");
    expect(await off.json()).toEqual({ configured: false });
    expect((await handleFirstmateRequest(new Request("http://x/api/firstmate/progress", { method: "POST" }), null)).status).toBe(405);
  });
});
