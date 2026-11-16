import type { PaneDescriptor, TerminalStatus, WorkspaceSnapshot } from '../contracts';
import type { PaneCreationState } from '../workspace/pane-create';
import { connectionActionLabel, connectionActionTitle, escapeHtml, icon } from './html';

export interface SidebarDeps {
  root: HTMLElement;
  snapshot(): WorkspaceSnapshot;
  activePaneId(): string | undefined;
  attachedPaneIds(): string[];
  paneCreation(): PaneCreationState;
  /** The exit or stopped badge text for a pane, or null. */
  paneBadge(paneId: string): string | null;
  /** The stream status of an attached pane, or undefined when it is not attached. */
  paneStatus(paneId: string): TerminalStatus | undefined;
  /** Renders the agent roster above the tree. */
  renderAgents(): void;
}

export interface Sidebar {
  /** Redraws the workspace tree, including the agent roster. */
  renderTree(): void;
  /** Redraws the attached-pane selectors in the stage. */
  renderPanes(): void;
}

/** The workspace tree and the attached-pane selectors, redrawn from the presenter's state. */
export function mountSidebar(deps: SidebarDeps): Sidebar {
  const qs = <T extends Element>(selector: string): T => {
    const element = deps.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  const exitBadge = (paneId: string): string => {
    const badge = deps.paneBadge(paneId);
    return badge ? `<small class="pane-exit-badge">${escapeHtml(badge)}</small>` : '';
  };
  const renderTree = (): void => {
    deps.renderAgents();
    const tree = qs<HTMLElement>('[data-tree]');
    if (!deps.snapshot().panes.length) {
      tree.innerHTML = '<div class="empty-tree">No panes reported</div>';
      return;
    }
    const expanded = new Map(
      [...tree.querySelectorAll<HTMLDetailsElement>('details[data-branch]')].map((node) => [
        node.dataset.branch,
        node.open,
      ]),
    );
    const grouped = (
      panes: PaneDescriptor[],
      field: 'workspaceId' | 'sessionId' | 'windowId',
    ): PaneDescriptor[][] => {
      const groups = new Map<string, PaneDescriptor[]>();
      for (const pane of panes) groups.set(pane[field], [...(groups.get(pane[field]) ?? []), pane]);
      return [...groups.values()];
    };
    const createLabel = deps.paneCreation().pending
      ? 'Creating terminal…'
      : deps.paneCreation().available
        ? 'New terminal'
        : 'Creation unavailable';
    const createButton = (sessionId: string, sessionName: string): string =>
      `<button class="tree-create" data-create-session="${escapeHtml(sessionId)}" ${deps.paneCreation().available && !deps.paneCreation().pending ? '' : 'disabled'} aria-label="Create a new default-shell terminal in ${escapeHtml(sessionName)}" title="${escapeHtml(deps.paneCreation().reason ?? `Create a new default-shell terminal in ${sessionName}`)}">${icon('plus')} ${createLabel}</button>`;
    const creation = deps.paneCreation();
    const createNote =
      creation.reason && (creation.pending || !creation.available)
        ? `<div class="tree-create-note" role="status">${escapeHtml(creation.reason)}</div>`
        : '';
    const branch = (id: string, label: string, content: string): string =>
      `<details data-branch="${escapeHtml(id)}" ${expanded.get(id) !== false ? 'open' : ''}><summary>${escapeHtml(label)}</summary>${content}</details>`;
    tree.innerHTML = `<div class="tree-daemon">Connected computer</div>${createNote}${grouped(
      deps.snapshot().panes,
      'workspaceId',
    )
      .map((workspace) =>
        branch(
          workspace[0].workspaceId,
          workspace[0].workspaceName,
          grouped(workspace, 'sessionId')
            .map((session) =>
              branch(
                session[0].sessionId,
                session[0].sessionName,
                grouped(session, 'windowId')
                  .map((window) =>
                    branch(
                      window[0].windowId,
                      window[0].windowName,
                      window
                        .map(
                          (pane) =>
                            `<button class="tree-pane ${pane.id === deps.activePaneId() ? 'selected' : ''}" data-pane="${escapeHtml(pane.id)}"><span class="pane-pip"></span><span><b>${escapeHtml(pane.title)}</b><small>${escapeHtml(pane.id)}</small>${exitBadge(pane.id)}</span></button>`,
                        )
                        .join(''),
                    ),
                  )
                  .join('') + createButton(session[0].sessionId, session[0].sessionName),
              ),
            )
            .join(''),
        ),
      )
      .join('')}`;
  };
  const renderPanes = (): void => {
    const host = qs<HTMLElement>('[data-panes]');
    const attached = deps
      .snapshot()
      .panes.filter((pane) => deps.attachedPaneIds().includes(pane.id));
    host.innerHTML = attached.length
      ? attached
          .map(
            (pane) =>
              `<div class="attached-selector ${pane.id === deps.activePaneId() ? 'active' : ''}"><button data-select="${escapeHtml(pane.id)}">${escapeHtml(pane.title)}</button>${exitBadge(pane.id)}<button class="text-btn" data-toggle-connection="${escapeHtml(pane.id)}" aria-label="${escapeHtml(connectionActionLabel(deps.paneStatus(pane.id)))} ${escapeHtml(pane.title)}" title="${escapeHtml(connectionActionTitle(pane.title, deps.paneStatus(pane.id)))}">${escapeHtml(connectionActionLabel(deps.paneStatus(pane.id)))}</button><button class="icon-btn" data-close="${escapeHtml(pane.id)}" aria-label="Close view for ${escapeHtml(pane.title)}" title="Close this viewer and keep the terminal running">${icon('close')}</button></div>`,
          )
          .join('')
      : '<div class="empty-state"><div class="empty-orbit"></div><h2>No panes attached</h2><p>Choose a pane from the workspace tree to attach it to the XR scene.</p></div>';
  };

  return { renderTree, renderPanes };
}
