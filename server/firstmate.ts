/**
 * The Firstmate progress panel's source: the configured Firstmate home's own
 * `bin/fm-bearings-snapshot.sh --json --all-in-flight`, run here and cached.
 *
 * The home, the shell and the Lavish state file come from the server's configuration only;
 * the browser names no path and no command. A run starts when a request finds the cache
 * older than `intervalMs` (one at a time, killed at `timeoutMs`), so the snapshot runs
 * periodically while a panel is open and never while none is. A request is answered from
 * the cache at once, except the very first, which waits for its run.
 *
 * Only the panel's fields leave the server: the projected `in_flight` rows, the in-flight
 * surfaces the snapshot says it `omitted`, whether a decision names the task, and an open
 * Lavish session whose artifact sits in that task's data folder.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { FirstmateProgress, FirstmateTask } from "../shared/protocol.ts";
import { isJsonObject, jsonResponse } from "./http.ts";

/** a run spawns several hundred processes, which a Windows PC feels: at most one every three minutes */
export const FIRSTMATE_INTERVAL_MS = 180_000;
/** a collection older than this is shown as stale, not as current */
export const FIRSTMATE_STALE_MS = 10 * 60_000;
const FIRSTMATE_TIMEOUT_MS = 120_000;

export interface FirstmateOptions {
  /** the Firstmate home (FM_HOME) */
  home: string;
  /** the bash that runs the snapshot; on Windows Git Bash, never WSL's */
  bash?: string;
  /** Lavish's session state; unset, ~/.lavish-axi/state.json */
  lavishState?: string;
  intervalMs?: number;
  staleMs?: number;
  timeoutMs?: number;
  now?: () => number;
  /** runs the snapshot and returns its stdout; tests pass a stand-in */
  run?: () => Promise<string>;
  /** reads the Lavish state file; tests pass a stand-in */
  readLavish?: () => string;
}

/** The service for `HERDR_WEB_FIRSTMATE_HOME`, or null when it is unset (the panel stays away). */
export function firstmateFromEnv(env: Record<string, string | undefined> = process.env): FirstmateProgressService | null {
  const home = env["HERDR_WEB_FIRSTMATE_HOME"]?.trim();
  if (!home) return null;
  return new FirstmateProgressService({ home, bash: env["HERDR_WEB_FIRSTMATE_BASH"]?.trim() || undefined, lavishState: env["HERDR_WEB_LAVISH_STATE"]?.trim() || undefined });
}

type Collected = { generatedAt: string | null; tasks: FirstmateTask[]; omitted: string[] };

export class FirstmateProgressService {
  private readonly options: FirstmateOptions;
  private readonly now: () => number;
  private last: Collected | null = null;
  private lastAt = 0;
  private lastTry = 0;
  private error: string | null = null;
  private running: Promise<void> | null = null;
  private child: ReturnType<typeof Bun.spawn> | null = null;

  constructor(options: FirstmateOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  async report(): Promise<Extract<FirstmateProgress, { configured: true }>> {
    const interval = this.options.intervalMs ?? FIRSTMATE_INTERVAL_MS;
    if (this.running === null && this.now() - this.lastTry >= interval) this.running = this.collect().finally(() => { this.running = null; });
    if (this.last === null && this.running !== null) await this.running;
    const last = this.last;
    if (last === null) return { configured: true, status: "unavailable", generated_at: null, tasks: [], omitted: [], error: this.error };
    const stale = this.now() - this.lastAt > (this.options.staleMs ?? FIRSTMATE_STALE_MS);
    return { configured: true, status: stale ? "stale" : "ok", generated_at: last.generatedAt, tasks: last.tasks, omitted: last.omitted, error: this.error };
  }

  stop(): void {
    this.child?.kill();
  }

  private async collect(): Promise<void> {
    this.lastTry = this.now();
    try {
      const output = await (this.options.run ?? (() => this.runSnapshot()))();
      this.last = project(JSON.parse(output), this.lavishSessions());
      this.lastAt = this.now();
      this.error = null;
    } catch (error) {
      this.error = error instanceof SnapshotError ? error.code : error instanceof SyntaxError ? "invalid_output" : "failed";
      console.error(`firstmate progress: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runSnapshot(): Promise<string> {
    const { home } = this.options;
    let child: ReturnType<typeof Bun.spawn>;
    // resolved here, on this process's PATH: on Windows a spawn given its own env looks for `PATH` and finds `Path`
    const bash = this.options.bash ?? "bash";
    try {
      child = Bun.spawn([Bun.which(bash) ?? bash,join(home, "bin", "fm-bearings-snapshot.sh"), "--json", "--all-in-flight"], {
        cwd: home, env: { ...process.env, FM_HOME: home }, stdin: "ignore", stdout: "pipe", stderr: "ignore",
      });
    } catch (error) {
      throw new SnapshotError("spawn_failed", error instanceof Error ? error.message : String(error));
    }
    this.child = child;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { child.kill(); reject(new SnapshotError("timeout", "snapshot timed out")); }, this.options.timeoutMs ?? FIRSTMATE_TIMEOUT_MS);
    });
    try {
      const [output, code] = await Promise.race([Promise.all([new Response(child.stdout as ReadableStream).text(), child.exited]), timeout]);
      if (code !== 0) throw new SnapshotError("exit_failed", `snapshot exited ${code}`);
      return output;
    } finally {
      clearTimeout(timer);
      this.child = null;
    }
  }

  /** open Lavish sessions keyed by the task whose `<home>/data/<task>/` holds their artifact; any failure only hides the links */
  private lavishSessions(): Map<string, string> {
    try {
      const raw = (this.options.readLavish ?? (() => readFileSync(this.options.lavishState ?? join(homedir(), ".lavish-axi", "state.json"), "utf8")))();
      return lavishByTask(raw, this.options.home);
    } catch {
      return new Map();
    }
  }
}

class SnapshotError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const SESSION_URL = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/session\/[A-Za-z0-9_-]+$/;
const normalPath = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function lavishByTask(raw: string, home: string): Map<string, string> {
  const found = new Map<string, string>();
  let state: unknown;
  try { state = JSON.parse(raw); } catch { return found; }
  const sessions = isJsonObject(state) && Array.isArray(state["sessions"]) ? state["sessions"] : [];
  const data = `${normalPath(home)}/data/`;
  for (const session of sessions) {
    if (!isJsonObject(session) || session["status"] !== "open") continue;
    const { file, url } = session;
    if (typeof file !== "string" || typeof url !== "string" || !SESSION_URL.test(url)) continue;
    const path = normalPath(file);
    if (!path.startsWith(data)) continue;
    const task = file.replace(/\\/g, "/").slice(data.length).split("/")[0];
    if (task) found.set(task, url);
  }
  return found;
}

// the in-flight completeness surfaces of fm-bearings.v1 `omitted`; the rest (bodies, paths, landed, PRs…) the panel never shows
const IN_FLIGHT_OMISSION = /in.?flight|active children|registered secondmates|registry records|cached home ledger|unreadable structured state/i;
const text = (value: unknown): string => typeof value === "string" ? value : "";

// what an activity line carries for the machines, not for the reader
const INTERNAL = [
  /\[(?:at|key)=[^\]]*\]/g, // the status log's bookkeeping
  /\bhttps?:\/\/\S+/g, // a raw address (before the paths: its `//` reads as one)
  /\b[A-Za-z]:[\\/][^\s,;)]*/g, // a Windows path
  /(?:~|\B\/)[\w.-]*\/[^\s,;)]*/g, // a Unix path
  /\b[A-Za-z][\w.-]*(?::[\w.-]+){2,}/g, // a backend target such as default:wX:p3
  /\b[0-9A-HJKMNP-TV-Z]{26}\b/g, // a no-mistakes run id (a ULID)
];

/** the activity line without internal identifiers, paths and bookkeeping */
export function plainActivity(doing: string): string {
  const cleaned = INTERNAL.reduce((line, pattern) => line.replace(pattern, ""), doing);
  return cleaned.replace(/\s+([:;,.…])/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s:;,]+|[\s:;,]+$/g, "").trim();
}

// the status log's own word that opens an activity line: `paused [at=…]: why`
const LOGGED_STATE = /^(working|paused|needs-decision|blocked|done|failed)\b(?:\s*\[[^\]]*\])*\s*:?\s*/;

/**
 * The state the panel shows: the snapshot's when it reconciled one, otherwise the word the task
 * last logged (the snapshot reads `unknown` for every worker it does not see busy, a paused or
 * blocked one included), with that word dropped from the activity line its label now repeats.
 */
export function loggedState(state: string, doing: string): { state: string; doing: string } {
  const logged = state === "unknown" ? LOGGED_STATE.exec(doing) : null;
  return logged ? { state: logged[1]!, doing: doing.slice(logged[0].length) } : { state, doing };
}

/** fm-bearings.v1 down to the panel's fields; anything else in the snapshot stays on the server */
export function project(snapshot: unknown, lavish: Map<string, string> = new Map()): Collected {
  if (!isJsonObject(snapshot) || snapshot["schema"] !== "fm-bearings.v1" || !Array.isArray(snapshot["in_flight"])) throw new SyntaxError("not an fm-bearings.v1 snapshot");
  const decisions = new Set((Array.isArray(snapshot["decisions_open"]) ? snapshot["decisions_open"] : [])
    .filter(isJsonObject).flatMap((decision) => [text(decision["id"]), text(decision["key"])]).filter(Boolean));
  const tasks = snapshot["in_flight"].filter(isJsonObject).map((row): FirstmateTask => {
    const id = text(row["id"]);
    const { state, doing } = loggedState(text(row["state"]) || "unknown", text(row["doing"]));
    return {
      id,
      kind: text(row["kind"]) || "task",
      state,
      repo: text(row["repo"]) || null,
      name: text(row["name"]) || id,
      doing: plainActivity(doing),
      decision: decisions.has(id),
      lavish_url: lavish.get(id) ?? null,
    };
  }).filter((task) => task.id !== "");
  const omitted = (Array.isArray(snapshot["omitted"]) ? snapshot["omitted"] : [])
    .filter(isJsonObject).map((entry) => text(entry["surface"])).filter((surface) => IN_FLIGHT_OMISSION.test(surface) && !/\blanded\b/i.test(surface));
  return { generatedAt: text(snapshot["generated"]) || null, tasks, omitted };
}

export async function handleFirstmateRequest(request: Request, service: FirstmateProgressService | null): Promise<Response> {
  if (request.method !== "GET") return jsonResponse({ error: { code: "method_not_allowed", message: "Use GET /api/firstmate/progress" } }, 405, { allow: "GET" });
  const body: FirstmateProgress = service === null ? { configured: false } : await service.report();
  return jsonResponse(body, 200, { "cache-control": "no-store" });
}
