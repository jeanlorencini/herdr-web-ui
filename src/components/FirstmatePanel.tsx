/**
 * The Firstmate progress inspector: a right-hand column beside the panes, drawn only when the
 * server has a Firstmate home (`GET /api/firstmate/progress` answers `configured: true`).
 * A vertical timeline per project with Agora/Histórico, a freshness footer that says plainly
 * when the collection is old or missing, and links to the Lavish sessions it found; Lavish
 * itself opens on its own page (it refuses to be framed). Text is Brazilian Portuguese
 * (lib/firstmateProgress.ts says why).
 */
import { Check, ChevronLeft, ChevronRight, CircleAlert, CircleQuestionMark, CircleX, ExternalLink, Mountain, Pause, Play, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import type { FirstmateProgress, FirstmateTask } from "../../shared/protocol.ts";
import { fetchFirstmateProgress } from "../lib/api.ts";
import { badgeOf, collectedAt, collectedTime, groupByProject, kindLabel, splitFeed, stateLabel, summaryLine, taskCount, TONE_LABELS, toneCounts, toneOf, TONES, type Tone } from "../lib/firstmateProgress.ts";
import "./FirstmatePanel.css";

const POLL_MS = 30_000;
const COLLAPSED_KEY = "herdr-web-ui:firstmate-panel-collapsed";

type Shown = Extract<FirstmateProgress, { configured: true }>;

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

const TASK_ICONS: Record<Tone, ReactNode> = {
  working: <Play />, waiting: <Pause />, blocked: <CircleX />, done: <Check />, unknown: <CircleQuestionMark />,
};
const SUMMARY_ICONS: Record<Tone, ReactNode> = {
  working: <Play />, waiting: <Pause />, blocked: <CircleAlert />, done: <Check />, unknown: <CircleAlert />,
};

/** arrow keys, Home and End move between a tablist's tabs, as the prototype's did */
function stepTabs<T>(event: KeyboardEvent, keys: readonly T[], current: T, pick: (next: T) => void): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const at = keys.indexOf(current);
  const next = event.key === "Home" ? keys[0]! : event.key === "End" ? keys[keys.length - 1]!
    : keys[(at + (event.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length]!;
  pick(next);
  const tablist = (event.currentTarget as HTMLElement).parentElement;
  queueMicrotask(() => tablist?.querySelector<HTMLElement>(`[data-key="${CSS.escape(String(next))}"]`)?.focus());
}

export function FirstmatePanel() {
  const [progress, setProgress] = useState<Shown | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [feed, setFeed] = useState<"now" | "past">("now");
  const [still, setStill] = useState(false);

  useEffect(() => {
    let live = true;
    const read = (): void => {
      if (document.visibilityState === "hidden") return;
      fetchFirstmateProgress().then((answer) => {
        if (live) setProgress(answer.configured ? answer : null);
      }, () => {
        // an older server (404) or one that refuses: no panel if there never was one, an unavailable one if there was
        if (live) setProgress((was) => was && { ...was, status: was.status === "unavailable" ? "unavailable" : "stale" });
      });
    };
    read();
    const timer = setInterval(read, POLL_MS);
    document.addEventListener("visibilitychange", read);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, []);

  if (progress === null) return null;

  const collapse = (next: boolean): void => {
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* blocked storage: the column just forgets */ }
    queueMicrotask(() => document.getElementById(next ? "fm-expand" : "fm-collapse")?.focus());
  };

  const usable = progress.status === "ok";
  const groups = usable ? groupByProject(progress.tasks) : [];
  const group = groups.find((item) => item.key === projectKey) ?? groups[0] ?? null;
  const freshness = progress.status === "ok" ? "fresh" : progress.status === "stale" ? "stale" : "error";
  const when = collectedAt(progress.generated_at);

  if (collapsed) {
    return (
      <aside className="fm-panel is-collapsed" aria-label="Progresso do Firstmate">
        <div className="fm-rail">
          <button type="button" id="fm-expand" className="fm-round" aria-label="Expandir painel" title="Expandir painel" onClick={() => collapse(false)}><ChevronRight /></button>
          <span className={`fm-fresh-dot is-${freshness}`} aria-hidden="true" />
          <span className="fm-rail-label">Progresso</span>
        </div>
      </aside>
    );
  }

  const shown = group ? splitFeed(group.tasks)[feed] : [];
  const lavish = group?.tasks.filter((task) => task.lavish_url !== null) ?? [];

  return (
    <aside className={`fm-panel${still ? " is-still" : ""}`} aria-label="Progresso do Firstmate">
      <div className="fm-top">
        <div className="fm-top-row">
          <div className="fm-top-copy">
            <div className="fm-eyebrow">Progresso do projeto</div>
            <div className="fm-title">{group?.label ?? "Firstmate"}</div>
          </div>
          <button type="button" id="fm-collapse" className="fm-round" aria-label="Recolher painel" title="Recolher painel" onClick={() => collapse(true)}><ChevronLeft /></button>
        </div>
        {groups.length > 1 && (
          <div className="fm-project-tabs" role="tablist" aria-label="Projetos">
            {groups.map((item) => (
              <button key={item.key} type="button" role="tab" data-key={item.key} aria-selected={item === group} tabIndex={item === group ? 0 : -1}
                className={`fm-project-tab${item === group ? " is-active" : ""}`}
                onClick={() => setProjectKey(item.key)}
                onKeyDown={(event) => stepTabs(event, groups.map((g) => g.key), group!.key, setProjectKey)}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="fm-scroll">
        {group && <Overview tasks={group.tasks} still={still} onStill={() => setStill((was) => !was)} />}
        <div className="fm-section-head">
          <span className="fm-timeline-title">Atualizações</span>
          <span className="fm-count">{usable ? taskCount(shown.length) : "dados indisponíveis"}</span>
        </div>
        <div className="fm-feed-tabs" role="tablist" aria-label="Período das atualizações">
          {(["now", "past"] as const).map((key) => (
            <button key={key} type="button" role="tab" data-key={key} aria-selected={feed === key} tabIndex={feed === key ? 0 : -1} className="fm-feed-tab"
              onClick={() => setFeed(key)} onKeyDown={(event) => stepTabs(event, ["now", "past"] as const, feed, setFeed)}>
              {key === "now" && <span className="fm-live-mark" aria-hidden="true" />}{key === "now" ? "Agora" : "Histórico"}
            </button>
          ))}
        </div>
        {!usable ? (
          <Empty stale title="Dados indisponíveis" copy={progress.status === "stale"
            ? "Os dados estão antigos. Ainda não sabemos o que está em andamento."
            : "Ainda não há coleta do Firstmate. Ainda não sabemos o que está em andamento."} />
        ) : group === null ? (
          <Empty title="Nada em andamento" copy="As próximas tarefas aparecerão aqui. Nenhuma tarefa está em andamento nesta coleta." />
        ) : shown.length === 0 ? (
          <div className="fm-empty">
            <div className="fm-empty-title">{feed === "past" ? "Histórico não disponível" : "Sem tarefas abertas"}</div>
            <div className="fm-empty-copy">{feed === "past" ? "A coleta traz as tarefas em andamento, sem histórico de eventos." : "As tarefas deste projeto aparecem como concluídas em Histórico."}</div>
          </div>
        ) : (
          <div>{shown.map((task) => <TaskItem key={task.id} task={task} project={group.label} time={collectedTime(progress.generated_at)} />)}</div>
        )}
      </div>

      <div className="fm-lavish">
        <div className="fm-section-head"><span className="fm-section-title">Lavish</span><span className="fm-count">Revisão visual ↗</span></div>
        {lavish.length === 0 ? (
          <div className="fm-empty-copy">{!usable ? "Sem coleta atual, nenhuma sessão Lavish é mostrada." : group ? "Nenhuma sessão Lavish vinculada por esta coleta." : "Nenhuma sessão vinculada enquanto não há trabalho em andamento."}</div>
        ) : lavish.map((task) => (
          <div key={task.id} className="fm-lavish-card">
            <div className="fm-lavish-row">
              <div className="fm-lavish-mark" aria-hidden="true"><Mountain /></div>
              <div className="fm-lavish-copy">
                <div className="fm-lavish-name">{task.name}</div>
                <div className="fm-lavish-meta">Sessão aberta no Lavish · para anotar e revisar</div>
              </div>
            </div>
            <a className="fm-external" href={task.lavish_url!} target="_blank" rel="noopener noreferrer"><span>Revisar no Lavish</span><ExternalLink /></a>
          </div>
        ))}
      </div>

      <div className="fm-footer" role="status">
        <div className="fm-fresh-row">
          <span className={`fm-fresh-dot is-${freshness}`} aria-hidden="true" />
          <span>{progress.status === "ok" ? `Coletado em ${when ?? "horário desconhecido"}` : when ? `Última coleta · ${when}` : "Sem coleta"}</span>
        </div>
        {progress.status !== "ok" && <div className="fm-warning-line">Não é possível confirmar o andamento agora.</div>}
        {usable && progress.omitted.length > 0 && (
          <div className="fm-warning-line" title={progress.omitted.join("\n")}>
            Parte das tarefas pode não aparecer: a coleta omitiu {progress.omitted.length === 1 ? "1 grupo" : `${progress.omitted.length} grupos`}.
          </div>
        )}
      </div>
    </aside>
  );
}

function Overview({ tasks, still, onStill }: { tasks: readonly FirstmateTask[]; still: boolean; onStill: () => void }) {
  const counts = toneCounts(tasks);
  const label = still ? "Retomar movimento" : "Pausar movimento";
  return (
    <div className="fm-overview">
      <div className="fm-overview-head">
        <h2 className="fm-overview-title">Visão geral</h2>
        <button type="button" className="fm-round fm-motion" aria-pressed={still} aria-label={label} title={label} onClick={onStill}>
          {still ? <Play /> : <Pause />}
        </button>
      </div>
      <p className="fm-overview-copy">{summaryLine(counts)}</p>
      <div className="fm-overview-counts" aria-label="Resumo de todas as tarefas do projeto">
        {TONES.filter((tone) => counts[tone] > 0).map((tone) => (
          <div key={tone} className="fm-summary" data-tone={tone}>
            <span className="fm-summary-icon" aria-hidden="true">{SUMMARY_ICONS[tone]}</span>
            <div className="fm-summary-copy"><b>{counts[tone]}</b><span className="fm-summary-label">{TONE_LABELS[tone]}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskItem({ task, project, time }: { task: FirstmateTask; project: string; time: string | null }) {
  const tone = toneOf(task.state);
  const badge = badgeOf(task);
  return (
    <article className="fm-task" data-tone={tone}>
      <div className="fm-event-icon" aria-hidden="true">{TASK_ICONS[tone]}</div>
      <div className="fm-task-copy">
        <div className="fm-event-head">
          <div><span className="fm-event-state">{stateLabel(task.state)}</span><span className="fm-event-meta"> em {project}</span></div>
          {time && <span className="fm-event-meta">{time}</span>}
        </div>
        <div className="fm-task-title">{task.name}</div>
        <div className="fm-event-kind">{kindLabel(task.kind)} · último registro</div>
        {/* an unconfirmed state has no activity worth reading as current */}
        {tone !== "unknown" && task.doing && <div className="fm-activity">{task.doing}</div>}
        {badge && <div className="fm-badge"><span className="fm-pip" aria-hidden="true" />{badge}</div>}
      </div>
    </article>
  );
}

function Empty({ title, copy, stale = false }: { title: string; copy: string; stale?: boolean }) {
  return (
    <div className="fm-empty">
      <div className="fm-empty-icon" aria-hidden="true">{stale ? <TriangleAlert /> : <Plus />}</div>
      <div className="fm-empty-title">{title}</div>
      <div className="fm-empty-copy">{copy}</div>
    </div>
  );
}
