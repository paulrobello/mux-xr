import { agentRosterLayout, type WorkspaceSettings } from '../settings/store';
import {
  AGE_TOKENS,
  type AgentRosterRow,
  agentRowLines,
  agentRowParts,
  agentRowsSignature,
  agentStateTone,
  agentTokenText,
} from '../workspace/agent-roster';
import { escapeHtml } from './html';

const AGENT_AGE_REFRESH_MS = 15_000;

export interface AgentRosterDeps {
  root: HTMLElement;
  /** The live settings; read at render time. */
  current(): WorkspaceSettings;
  activePaneId(): string | undefined;
}

export interface AgentRoster {
  /** Shows the rows; renders only when the order, layout or text changed. */
  setRows(rows: readonly AgentRosterRow[]): void;
  /** Renders now, for a layout or sort change. */
  render(): void;
  destroy(): void;
}

/** The sidebar's agent roster: one button per agent pane, kept fresh as ages tick. */
export function mountAgentRoster(deps: AgentRosterDeps): AgentRoster {
  const qs = <T extends Element>(selector: string): T => {
    const element = deps.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  let agentRows: AgentRosterRow[] = [];
  let agentSignature = '';
  let agentRenderDeferred = false;
  let agentRenderedOrder = '';
  let agentRenderedAges = '';
  const renderAgents = (): void => {
    const section = qs<HTMLElement>('[data-agents-section]');
    section.hidden = agentRows.length === 0;
    qs<HTMLElement>('[data-agent-count]').textContent = agentRows.length
      ? String(agentRows.length)
      : '';
    const layout = agentRosterLayout(deps.current());
    const sortButton = qs<HTMLButtonElement>('[data-action="agents-sort"]');
    sortButton.textContent = layout.sort;
    sortButton.title = `Agent order: ${layout.sort}. Change the agent order`;
    const list = qs<HTMLElement>('[data-agents]');
    // A reorder waits while the pointer is over the list; other updates render in place.
    const order = agentRows.map((row) => row.paneId).join(' ');
    if (order !== agentRenderedOrder && agentRenderedOrder && list.matches(':hover')) {
      agentRenderDeferred = true;
      return;
    }
    agentRenderDeferred = false;
    agentRenderedOrder = order;
    agentRenderedAges = agentAgesKey();
    const now = Date.now();
    list.innerHTML = agentRows
      .map((row) => {
        const tone = agentStateTone(row.state);
        const state = agentTokenText(row, 'state', now);
        const lines = agentRowParts(row, layout.rows, now);
        const content = (lines.length ? lines : [[{ token: 'agent' as const, text: row.agent }]])
          .map((line, index) => {
            const parts = line
              .map(
                (part) =>
                  `<span class="agent-token" data-token="${part.token}">${escapeHtml(part.text)}</span>`,
              )
              .join('<span class="agent-sep"> · </span>');
            return index === 0 ? `<b>${parts}</b>` : `<small>${parts}</small>`;
          })
          .join('');
        return `<button class="tree-pane agent-row ${row.paneId === deps.activePaneId() ? 'selected' : ''}" data-pane="${escapeHtml(row.paneId)}" data-agent-tone="${tone}" title="${escapeHtml(`Open ${row.agent} in ${row.paneId}`)}" aria-label="${escapeHtml(`${row.agent} ${state} in ${row.workspaceName || 'unknown workspace'}, pane ${row.paneId}${row.project ? `, project ${row.project}` : ''}${row.reason ? `, ${row.reason}` : ''}`)}"><span class="agent-lines">${content}</span></button>`;
      })
      .join('');
  };
  /** The age texts the rows would show now; empty when the layout has no age token. */
  function agentAgesKey(): string {
    const { rows } = agentRosterLayout(deps.current());
    const ages = rows.map((line) => line.filter((token) => AGE_TOKENS.has(token)));
    if (!ages.some((line) => line.length)) return '';
    const now = Date.now();
    return agentRows.map((row) => agentRowLines(row, ages, now).join('|')).join('\u0000');
  }
  qs<HTMLElement>('[data-agents]').addEventListener('pointerleave', () => {
    if (agentRenderDeferred) renderAgents();
  });
  const agentAgeTimer = setInterval(() => {
    // Also resumes a deferred reorder where pointerleave never fired (touch).
    if (agentRenderDeferred || (agentRows.length && agentAgesKey() !== agentRenderedAges))
      renderAgents();
  }, AGENT_AGE_REFRESH_MS);

  return {
    setRows(rows) {
      const layout = agentRosterLayout(deps.current());
      const signature = `${layout.sort}\u0002${agentRowsSignature(rows, layout)}`;
      agentRows = [...rows];
      if (signature === agentSignature) return;
      agentSignature = signature;
      renderAgents();
    },
    render: renderAgents,
    destroy: () => clearInterval(agentAgeTimer),
  };
}
