import { describe, expect, it } from 'vitest';
import type { PaneDescriptor } from '../src/contracts';
import { initialPaneSelection } from '../src/workspace/initial';

const pane = (id: string, workspaceName: string, sessionName = 'default'): PaneDescriptor => ({
  id,
  workspaceName,
  workspaceId: workspaceName,
  sessionName,
  sessionId: sessionName,
  windowId: id,
  windowName: id,
  title: id,
});

describe('initial existing-pane selection', () => {
  it('uses the default workspace/session rather than another active workspace or watcher', () => {
    const selected = pane('%3', 'default');
    selected.active = selected.windowActive = true;
    const result = initialPaneSelection([
      pane('%1', 'Director'),
      pane('%2', 'default', 'watcher'),
      pane('%4', 'default'),
      selected,
    ]);
    expect(result.panes.map((item) => item.id)).toEqual(['%3', '%4']);
    expect(result.activeId).toBe('%3');
  });
  it('fills a second panel from the same scope when the active window has only one pane', () => {
    const selected = { ...pane('%2', 'default', 'qa'), active: true, windowActive: true };
    expect(initialPaneSelection([pane('%1', 'default', 'qa'), selected]).panes).toHaveLength(2);
  });
  it('keeps generic/private hierarchies usable when no default workspace exists', () => {
    const panes = [pane('%1', 'private'), pane('%2', 'private'), pane('%3', 'private')];
    expect(initialPaneSelection(panes)).toEqual({ panes: panes.slice(0, 2) });
  });
});
