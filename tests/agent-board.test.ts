import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('troika-three-text')>();
  return {
    ...actual,
    Text: class MockText extends THREE.Mesh {
      text = '';
      anchorX: number | string = 0;
      textAlign = '';
      sync(callback?: () => void): void {
        callback?.();
      }
      dispose(): void {
        /* test double */
      }
    },
    configureTextBuilder: vi.fn(),
  };
});

import type { AgentRosterRow } from '../src/workspace/agent-roster';
import {
  AGENT_BOARD_MAX_ROWS,
  agentBoardHeight,
  agentBoardPage,
  agentBoardPageCount,
  agentBoardRows,
  createAgentBoardWidget,
} from '../src/xr/agent-board';
import { AGENT_TONE_COLORS } from '../src/xr/hierarchy-navigator';

const NOW = 1_800_000_000_000;

function agent(id: number, state: string, extra: Partial<AgentRosterRow> = {}): AgentRosterRow {
  return {
    paneId: `%${id}`,
    agent: 'claude',
    state,
    reason: '',
    workspace: '+1',
    project: 'mux-xr',
    paneLabel: '',
    source: 'hook',
    stalled: false,
    lastActivityAt: NOW - 5 * 60_000,
    lastReportAt: 0,
    lastInputAt: 0,
    lastViewedAt: 0,
    viewerCount: 0,
    cpuMs: 0,
    workspaceName: 'Main',
    title: `Shell ${id}`,
    sessionName: 'S',
    windowName: 'W',
    ...extra,
  };
}

function rows(widget: ReturnType<typeof createAgentBoardWidget>): THREE.Object3D[] {
  return widget.root.children.filter(
    (child) => child.name.startsWith('agent-board-row-') && child.visible,
  );
}

function part(row: THREE.Object3D, name: string): THREE.Mesh {
  const found = row.getObjectByName(`agent-board-row-${name}`);
  if (!found) throw new Error(`missing ${name}`);
  return found as THREE.Mesh;
}

function named(widget: ReturnType<typeof createAgentBoardWidget>, name: string): THREE.Object3D {
  const found = widget.root.getObjectByName(name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function pagerNode(
  widget: ReturnType<typeof createAgentBoardWidget>,
  side: string,
): THREE.Object3D {
  return named(widget, `agent-board-page-${side}`);
}

function activate(widget: ReturnType<typeof createAgentBoardWidget>, side: string): void {
  widget.activate(pagerNode(widget, side));
}

describe('agent board widget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a quiet empty state without a roster', () => {
    const widget = createAgentBoardWidget(null);
    expect(rows(widget)).toHaveLength(0);
    expect(named(widget, 'agent-board-empty').visible).toBe(true);
    expect(named(widget, 'agent-board-empty').userData.labelText).toBe('No agents reporting');
    expect(named(widget, 'agent-board-page-label').visible).toBe(false);
    expect(named(widget, 'agent-board-page-prev').visible).toBe(false);
    expect(named(widget, 'agent-board-page-next').visible).toBe(false);
    expect(named(widget, 'agent-board-header').userData.labelText).toBe('Agents');
    widget.dispose();
  });

  it('renders one row per agent with state colour, stalled marker and age', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const widget = createAgentBoardWidget(null);
    widget.setAgentRoster?.([
      agent(1, 'working', { lastActivityAt: NOW - 42_000 }),
      agent(2, 'idle', { stalled: true, lastActivityAt: NOW - 3 * 3_600_000 }),
      agent(3, 'question', { lastActivityAt: NOW - 2_000 }),
      agent(4, 'done', { lastActivityAt: 0 }),
    ]);
    const shown = rows(widget);
    expect(shown).toHaveLength(4);
    expect(named(widget, 'agent-board-empty').visible).toBe(false);
    expect(named(widget, 'agent-board-header').userData.labelText).toBe('Agents · 4');
    // Pane order, so a state flip never moves a row under the ray.
    expect(shown.map((row) => part(row, 'name').userData.labelText)).toEqual([
      'working · claude · Shell 1',
      'idle · claude · Shell 2',
      'question · claude · Shell 3',
      'done · claude · Shell 4',
    ]);
    expect(shown.map((row) => part(row, 'age').userData.labelText)).toEqual([
      '42s',
      '3h',
      'now',
      '',
    ]);
    expect(shown.map((row) => part(row, 'stalled').visible)).toEqual([false, true, false, false]);
    const colour = (row: THREE.Object3D): string =>
      `#${(part(row, 'state').material as THREE.MeshBasicMaterial).color.getHexString()}`;
    expect(colour(shown[0] as THREE.Object3D)).toBe(AGENT_TONE_COLORS.working);
    expect(colour(shown[2] as THREE.Object3D)).toBe(AGENT_TONE_COLORS.attention);
    for (const row of shown)
      for (const child of row.children) {
        expect(child.userData.inputAction).toBe('selectAgentPane');
        expect(child.userData.widgetKind).toBe('agent-board');
      }
    expect(part(shown[1] as THREE.Object3D, 'plate').userData.agentPaneId).toBe('%2');
    widget.dispose();
  });

  it('caps the rows and offers the rest on the pager', () => {
    const widget = createAgentBoardWidget(null);
    const roster = Array.from({ length: AGENT_BOARD_MAX_ROWS + 3 }, (_, index) =>
      agent(index + 1, 'working'),
    );
    roster.push(agent(99, 'blocked'));
    widget.setAgentRoster?.(roster);
    expect(rows(widget)).toHaveLength(AGENT_BOARD_MAX_ROWS);
    expect(named(widget, 'agent-board-page-label').visible).toBe(true);
    expect(named(widget, 'agent-board-page-label').userData.labelText).toBe('1/2');
    // A blocked agent past the cap in pane order still makes the board, in its pane slot.
    const shownIds = rows(widget).map((row) => part(row, 'plate').userData.agentPaneId);
    expect(shownIds).toEqual(['%1', '%2', '%3', '%4', '%5', '%99']);
    const flipped = roster.map((row) =>
      row.paneId === '%1' ? { ...row, state: 'question' } : row,
    );
    widget.setAgentRoster?.(flipped);
    expect(rows(widget).map((row) => part(row, 'plate').userData.agentPaneId)).toEqual(shownIds);
    widget.setAgentRoster?.(roster.slice(0, 2));
    expect(rows(widget)).toHaveLength(2);
    expect(named(widget, 'agent-board-page-label').visible).toBe(false);
    const freed = widget.root.children.find(
      (child) => child.name.startsWith('agent-board-row-') && !child.visible,
    );
    expect(freed?.children[0]?.userData.inputAction).toBe('grabWidget');
    widget.setAgentRoster?.([]);
    expect(named(widget, 'agent-board-empty').visible).toBe(true);
    widget.dispose();
  });

  it('ticks ages at most once a second and only while visible', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const widget = createAgentBoardWidget(null);
    widget.setAgentRoster?.([agent(1, 'working', { lastActivityAt: NOW - 20_000 })]);
    const age = part(rows(widget)[0] as THREE.Object3D, 'age');
    expect(age.userData.labelText).toBe('20s');
    widget.update(NOW + 400);
    expect(age.userData.labelText).toBe('20s');
    widget.update(NOW + 1_000);
    expect(age.userData.labelText).toBe('21s');
    widget.update(NOW + 5_000);
    expect(age.userData.labelText).toBe('25s');
    widget.dispose();
  });

  it('ignores update and roster feeds once disposed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const widget = createAgentBoardWidget(null);
    widget.setAgentRoster?.([agent(1, 'working', { lastActivityAt: NOW - 20_000 })]);
    const age = part(rows(widget)[0] as THREE.Object3D, 'age');
    widget.dispose();
    expect(widget.root.children).toHaveLength(0);
    expect(() => {
      widget.update(NOW + 10_000);
      widget.setAgentRoster?.([agent(2, 'question')]);
    }).not.toThrow();
    expect(age.userData.labelText).toBe('20s');
    expect(widget.root.children).toHaveLength(0);
  });

  it('keeps rows in their slots when an urgent agent displaces one past the cap', () => {
    const widget = createAgentBoardWidget(null);
    const roster = [
      agent(1, 'working'),
      agent(2, 'working'),
      agent(3, 'idle'),
      agent(4, 'working'),
      agent(5, 'working'),
      agent(6, 'working'),
      agent(7, 'idle'),
    ];
    const ids = (): unknown[] => rows(widget).map((row) => part(row, 'plate').userData.agentPaneId);
    widget.setAgentRoster?.(roster);
    expect(ids()).toEqual(['%1', '%2', '%3', '%4', '%5', '%6']);
    // %7 needs attention and evicts idle %3, taking its slot; nothing else moves.
    widget.setAgentRoster?.(
      roster.map((row) => (row.paneId === '%7' ? { ...row, state: 'question' } : row)),
    );
    expect(ids()).toEqual(['%1', '%2', '%7', '%4', '%5', '%6']);
    // A state flip among shown agents moves nothing either.
    widget.setAgentRoster?.(
      roster.map((row) =>
        row.paneId === '%7'
          ? { ...row, state: 'question' }
          : row.paneId === '%5'
            ? { ...row, state: 'blocked' }
            : row,
      ),
    );
    expect(ids()).toEqual(['%1', '%2', '%7', '%4', '%5', '%6']);
    widget.dispose();
  });

  it('fills fresh capped slots by urgency, in pane order', () => {
    const roster = Array.from({ length: AGENT_BOARD_MAX_ROWS + 2 }, (_, index) =>
      agent(index + 1, 'idle'),
    );
    roster.push(agent(50, 'working', { stalled: true }), agent(40, 'question'));
    const ids = agentBoardRows(roster).map((row) => row.paneId);
    expect(ids).toHaveLength(AGENT_BOARD_MAX_ROWS);
    expect(ids.slice(-2)).toEqual(['%40', '%50']);
    expect(ids).toEqual([...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it('counts pages and lists later pages in priority order', () => {
    expect(agentBoardPageCount([], 6)).toBe(1);
    const eight = Array.from({ length: 8 }, (_, index) => agent(index + 1, 'working'));
    const fifteen = Array.from({ length: 15 }, (_, index) => agent(index + 1, 'working'));
    expect(agentBoardPageCount(eight, 6)).toBe(2);
    expect(agentBoardPageCount(fifteen, 6)).toBe(3);
    expect(agentBoardPage(eight, [], 0, 6)).toEqual(agentBoardRows(eight, [], 6));
    expect(agentBoardPage(eight, [], 1, 6).map((row) => row.paneId)).toEqual(['%7', '%8']);
    expect(agentBoardPage(eight, [], 99, 6).map((row) => row.paneId)).toEqual(['%7', '%8']);
    expect(agentBoardPage(eight, [], -1, 6).map((row) => row.paneId)).toEqual([
      '%1',
      '%2',
      '%3',
      '%4',
      '%5',
      '%6',
    ]);
  });

  it('flips pages from the pager buttons', () => {
    const widget = createAgentBoardWidget(null);
    const roster = Array.from({ length: 8 }, (_, index) => agent(index + 1, 'working'));
    widget.setAgentRoster?.(roster);
    const ids = (): unknown[] => rows(widget).map((row) => part(row, 'plate').userData.agentPaneId);
    expect(ids()).toEqual(['%1', '%2', '%3', '%4', '%5', '%6']);
    expect(named(widget, 'agent-board-page-label').userData.labelText).toBe('1/2');
    for (const name of ['prev', 'next']) {
      expect(pagerNode(widget, name).userData.inputAction).toBe('widgetControl');
      expect(pagerNode(widget, name).userData.agentBoardAction).toBe(name);
    }
    expect(pagerNode(widget, 'prev').userData.helpText).toBe('Previous agents page');
    expect(pagerNode(widget, 'next').userData.helpText).toBe('Next agents page');
    activate(widget, 'next');
    expect(ids()).toEqual(['%7', '%8']);
    expect(pagerLabelText(widget)).toBe('2/2');
    activate(widget, 'next');
    expect(pagerLabelText(widget)).toBe('2/2');
    activate(widget, 'prev');
    expect(ids()).toEqual(['%1', '%2', '%3', '%4', '%5', '%6']);
    expect(pagerLabelText(widget)).toBe('1/2');
    activate(widget, 'label');
    expect(ids()).toEqual(['%1', '%2', '%3', '%4', '%5', '%6']);
    expect(pagerLabelText(widget)).toBe('1/2');
    widget.dispose();
  });

  it('clamps the page when the roster shrinks below it', () => {
    const widget = createAgentBoardWidget(null);
    const roster = Array.from({ length: 8 }, (_, index) => agent(index + 1, 'working'));
    widget.setAgentRoster?.(roster);
    activate(widget, 'next');
    expect(pagerLabelText(widget)).toBe('2/2');
    widget.setAgentRoster?.(roster.slice(0, 4));
    expect(pagerNode(widget, 'label').visible).toBe(false);
    const shown = rows(widget).map((row) => part(row, 'plate').userData.agentPaneId);
    expect(shown).toEqual(['%1', '%2', '%3', '%4']);
    widget.dispose();
  });

  it('rebuilds the board when max rows change, keeping the stored roster', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const widget = createAgentBoardWidget(null);
    const four = [agent(1, 'working'), agent(2, 'idle'), agent(3, 'done'), agent(4, 'working')];
    widget.setAgentRoster?.(four);
    widget.setAgentBoardMaxRows?.(3);
    expect(rows(widget)).toHaveLength(3);
    expect(pagerLabelText(widget)).toBe('1/2');
    const body = named(widget, 'agent-board-body') as THREE.Mesh;
    expect((body.geometry as THREE.BoxGeometry).parameters.height).toBe(agentBoardHeight(3));
    const eight = Array.from({ length: 8 }, (_, index) => agent(index + 1, 'working'));
    widget.setAgentRoster?.(eight);
    activate(widget, 'next');
    expect(pagerLabelText(widget)).toBe('2/3');
    expect(rows(widget).map((row) => part(row, 'plate').userData.agentPaneId)).toEqual([
      '%4',
      '%5',
      '%6',
    ]);
    widget.setAgentBoardMaxRows?.(12);
    expect(pagerNode(widget, 'label').visible).toBe(false);
    expect(rows(widget)).toHaveLength(8);
    widget.dispose();
  });
});

function pagerLabelText(widget: ReturnType<typeof createAgentBoardWidget>): string | undefined {
  return named(widget, 'agent-board-page-label').userData.labelText as string | undefined;
}
