import type { PaneDescriptor } from '../contracts';

export function initialPaneSelection(panes: PaneDescriptor[]): {
  panes: PaneDescriptor[];
  activeId?: string;
} {
  const workspace = panes.filter((pane) => pane.workspaceName === 'default');
  if (!workspace.length) return { panes: panes.slice(0, 2) };
  const session = workspace.filter((pane) => pane.sessionName === 'default');
  const scoped = session.length ? session : workspace;
  const ordered = [...scoped].sort(
    (left, right) =>
      Number(right.windowActive === true) - Number(left.windowActive === true) ||
      Number(right.active === true) - Number(left.active === true),
  );
  return { panes: ordered.slice(0, 2), activeId: ordered[0]?.id };
}
