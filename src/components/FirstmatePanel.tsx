/**
 * The Firstmate progress inspector: a right-hand column beside the panes, drawn only when the
 * server has a Firstmate home (`GET /api/firstmate/progress` answers `configured: true`).
 * A vertical timeline per project with Agora/Histórico, a freshness footer that says plainly
 * when the collection is old or missing, and links to the Lavish sessions it found; Lavish
 * itself opens on its own page (it refuses to be framed). Text is Brazilian Portuguese
 * (lib/firstmateProgress.ts says why).
 */
import { Check, ChevronLeft, ChevronRight, CircleAlert, CircleQuestionMark, CircleX, ExternalLink, Mountain, Pause, Play, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

import type { FirstmateProgress, FirstmateTask } from "../../shared/protocol.ts";
import { fetchFirstmateProgress } from "../lib/api.ts";
import { badgeOf, clampPanelWidth, collectedAt, collectedTime, groupByProject, keyedPanelWidth, kindLabel, PANEL_MIN_WIDTH, panelMaxWidth, parsePanelWidth, splitFeed, stateLabel, summaryLine, taskCount, TONE_LABELS, toneCounts, toneOf, TONES, type Tone } from "../lib/firstmateProgress.ts";
import "./FirstmatePanel.css";
import "./SidebarResizer.css";

const POLL_MS = 30_000;
const COLLAPSED_KEY = "herdr-web-ui:firstmate-panel-collapsed";
const WIDTH_KEY = "herdr-web-ui:firstmate-panel-width";

type Shown = Extract<FirstmateProgress, { configured: true }>;

function readCollapsed(): boolean {
  let stored: string | null = null;
  try { stored = localStorage.getItem(COLLAPSED_KEY); } catch { /* blocked storage */ }
  return stored === null ? window.matchMedia?.("(max-width: 560px)").matches === true : stored === "1";
}

function readWidth(): number | null {
  try { return parsePanelWidth(localStorage.getItem(WIDTH_KEY)); } catch { return null; }
}

/** null forgets the choice: the column goes back to its default width */
function storeWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch { /* blocked storage: the width is not remembered */ }
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
  const [width, setWidth] = useState(readWidth);
  const panel = useRef<HTMLElement>(null);

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

  // the window caps a chosen width too: it never takes more than 60% of it
  const sized = width === null ? undefined : { "--fm-chosen": `min(${width}px, 60vw)` } as CSSProperties;

  return (
    <>
    <PanelResizer panel={panel} width={width} onResize={setWidth} />
    <aside ref={panel} className={`fm-panel${still ? " is-still" : ""}`} style={sized} aria-label="Progresso do Firstmate">
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
    </>
  );
}

/**
 * The seam between the panes and the column, as the sidebar's edge (SidebarResizer): drag it,
 * use the arrow keys, double-click to go back to the default width. Only where the column sits
 * beside the panes (from 769px, the grip's own CSS); a folded column has none.
 */
function PanelResizer({ panel, width, onResize }: { panel: RefObject<HTMLElement | null>; width: number | null; onResize: (width: number | null) => void }) {
  const drag = useRef<{ right: number; grip: number; width: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const measured = (): number => Math.round(panel.current?.getBoundingClientRect().width ?? width ?? PANEL_MIN_WIDTH);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const box = panel.current?.getBoundingClientRect();
    if (event.button !== 0 || !box) return;
    // no text selection in the pane while the seam moves
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { right: box.right, grip: event.clientX - box.left, width: Math.round(box.width), moved: false };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state) return;
    const next = clampPanelWidth(state.right - (event.clientX - state.grip), window.innerWidth);
    if (next === state.width) return;
    state.width = next;
    state.moved = true;
    onResize(next);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (state.moved) storeWidth(state.width);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = keyedPanelWidth(measured(), event.key, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    storeWidth(next);
    onResize(next);
  };

  return (
    <div className="fm-resizer-slot">
      <div
        className={`sidebar-resizer${dragging ? " is-dragging" : ""}`}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Redimensionar painel"
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={panelMaxWidth(window.innerWidth)}
        aria-valuenow={width ?? measured()}
        title="Arraste para redimensionar · clique duplo para voltar ao padrão"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => { storeWidth(null); onResize(null); }}
        onKeyDown={onKeyDown}
      />
    </div>
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
