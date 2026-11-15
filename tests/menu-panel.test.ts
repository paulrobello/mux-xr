import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../packages/xr-workspace/src/labels', async () => {
  const helper = await import('./helpers/labels');
  return {
    ...helper,
    createScalableLabel: vi.fn(
      (label: string, width: number, height: number, options?: Record<string, unknown>) => {
        const mesh = helper.createScalableLabel(label, width, height);
        mesh.userData.labelOptions = options;
        return mesh;
      },
    ),
    updateScalableLabel: vi.fn(helper.updateScalableLabel),
    disposeScalableLabel: vi.fn(helper.disposeScalableLabel),
  };
});

import {
  createMenuPanel,
  createScalableLabel,
  disposeScalableLabel,
  type MenuCell,
  type MenuRow,
  updateScalableLabel,
} from '@par/xr-workspace';

const button = (id: string, label = id, onSelect: () => void = () => undefined): MenuCell => ({
  id,
  label,
  onSelect,
});

function mesh(panel: ReturnType<typeof createMenuPanel>, id: string): THREE.Mesh {
  const found = panel.root.getObjectByName(`menu-${id}`);
  if (!found) throw new Error(`no cell ${id}`);
  return found as THREE.Mesh;
}

function pagedRows(count: number): MenuRow[] {
  return Array.from({ length: count }, (_, index) => button(`row-${index}`));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('menu panel layout', () => {
  it('stacks single rows down from the origin', () => {
    const panel = createMenuPanel({ rows: [button('a'), button('b'), button('c')] });
    expect(mesh(panel, 'a').position.y).toBeCloseTo(-0.0475);
    expect(mesh(panel, 'b').position.y).toBeCloseTo(-0.1575);
    expect(mesh(panel, 'c').position.y).toBeCloseTo(-0.2675);
    expect(mesh(panel, 'a').position.x).toBe(0);
    expect(mesh(panel, 'a').userData.labelWidth).toBeCloseTo(0.48);
    expect(panel.height).toBeCloseTo(0.315);
  });

  it('splits a row between equal cells', () => {
    const panel = createMenuPanel({ rows: [[button('l'), button('r')]] });
    expect(mesh(panel, 'l').userData.labelWidth).toBeCloseTo(0.22);
    expect(mesh(panel, 'l').position.x).toBeCloseTo(-0.13);
    expect(mesh(panel, 'r').position.x).toBeCloseTo(0.13);
  });

  it('shares row width by weight', () => {
    const panel = createMenuPanel({
      rows: [[button('minus'), { ...button('value'), weight: 3 }, button('plus')]],
    });
    expect(mesh(panel, 'minus').userData.labelWidth).toBeCloseTo(0.08);
    expect(mesh(panel, 'value').userData.labelWidth).toBeCloseTo(0.24);
    expect(mesh(panel, 'plus').userData.labelWidth).toBeCloseTo(0.08);
    expect(mesh(panel, 'minus').position.x).toBeCloseTo(-0.2);
    expect(mesh(panel, 'value').position.x).toBeCloseTo(0);
    expect(mesh(panel, 'plus').position.x).toBeCloseTo(0.2);
  });

  it('draws text cells without a backplate', () => {
    const panel = createMenuPanel({ rows: [{ id: 'title', label: 'Title' }, button('go')] });
    expect(mesh(panel, 'title').userData.labelOptions).toEqual({ backplate: false });
    expect(mesh(panel, 'go').userData.labelOptions).toEqual({});
  });

  it('draws a plated text cell that stays non-interactive', () => {
    const panel = createMenuPanel({
      rows: [
        { id: 'value', label: '4.8', backplate: true },
        { id: 'plain', label: 'Plain' },
      ],
    });
    expect(mesh(panel, 'value').userData.labelOptions).toEqual({});
    expect(mesh(panel, 'value').userData.labelOptions).not.toHaveProperty('backplate');
    expect(mesh(panel, 'plain').userData.labelOptions).toEqual({ backplate: false });
    expect(panel.cellAt(mesh(panel, 'value'))).toBeNull();
    expect(panel.activate('value')).toBe(false);
    panel.setHovered('value');
    expect((mesh(panel, 'value').material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      0xffffff,
    );
  });

  it('draws a button without a backplate and keeps it interactive', () => {
    const onSelect = vi.fn();
    const panel = createMenuPanel({
      rows: [{ id: 'ghost', label: 'Ghost', onSelect, backplate: false }],
    });
    expect(mesh(panel, 'ghost').userData.labelOptions).toEqual({ backplate: false });
    expect(panel.cellAt(mesh(panel, 'ghost'))).toBe('ghost');
    expect(panel.activate('ghost')).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the backplate choice through selection rebuilds and setRows', () => {
    const panel = createMenuPanel({
      rows: [
        { id: 'ghost', label: 'Ghost', onSelect: () => undefined, backplate: false },
        { id: 'value', label: '4.8', backplate: true },
      ],
    });
    panel.setSelected('ghost');
    expect(mesh(panel, 'ghost').userData.labelOptions).toEqual({ backplate: false });
    panel.setSelected('value');
    expect(mesh(panel, 'value').userData.labelOptions).toEqual({ background: '#315c6d' });
    expect(panel.cellAt(mesh(panel, 'value'))).toBeNull();
    panel.setRows([{ id: 'value', label: '4.8', backplate: true }]);
    expect(mesh(panel, 'value').userData.labelOptions).toEqual({});
  });
});

describe('menu panel control ids', () => {
  it('names meshes and resolves hits on a cell or its children', () => {
    const panel = createMenuPanel({
      name: 'music',
      rows: [button('play'), { id: 'title', label: 'Title' }],
    });
    const play = panel.root.getObjectByName('music-play') as THREE.Mesh;
    expect(play.userData.controlId).toBe('music-play');
    expect(panel.cellAt(play)).toBe('play');
    const child = new THREE.Object3D();
    play.add(child);
    expect(panel.cellAt(child)).toBe('play');
  });

  it('returns null for text cells and objects outside the panel', () => {
    const panel = createMenuPanel({ rows: [{ id: 'title', label: 'Title' }] });
    expect(panel.cellAt(mesh(panel, 'title'))).toBeNull();
    expect(panel.cellAt(new THREE.Mesh())).toBeNull();
    expect(panel.cellAt(panel.root)).toBeNull();
  });

  it('returns null when the root is hidden', () => {
    const panel = createMenuPanel({ rows: [button('a')] });
    panel.root.visible = false;
    expect(panel.cellAt(mesh(panel, 'a'))).toBeNull();
  });
});

describe('menu panel activation', () => {
  it('runs a handler once and reports it', () => {
    const onSelect = vi.fn();
    const panel = createMenuPanel({ rows: [button('go', 'Go', onSelect)] });
    expect(panel.activate('go')).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('refuses text cells and unknown ids', () => {
    const panel = createMenuPanel({ rows: [{ id: 'title', label: 'Title' }] });
    expect(panel.activate('title')).toBe(false);
    expect(panel.activate('missing')).toBe(false);
    expect(panel.activate('next')).toBe(false);
  });
});

describe('menu panel labels', () => {
  it('changes label text and skips unchanged text', () => {
    const panel = createMenuPanel({ rows: [button('arms', 'Arms on')] });
    panel.setLabel('arms', 'Arms off');
    expect(mesh(panel, 'arms').userData.labelText).toBe('Arms off');
    expect(updateScalableLabel).toHaveBeenCalledTimes(1);
    panel.setLabel('arms', 'Arms off');
    panel.setLabel('missing', 'x');
    expect(updateScalableLabel).toHaveBeenCalledTimes(1);
  });
});

describe('menu panel paging', () => {
  function pagedPanel() {
    return createMenuPanel({
      rows: [{ id: 'head', label: 'Head' }, { id: 'sub', label: 'Sub' }, ...pagedRows(14)],
      pinnedRows: 2,
      pageSize: 6,
    });
  }

  it('shows the pinned rows and the first page', () => {
    const panel = pagedPanel();
    expect(panel.pageCount).toBe(3);
    expect(panel.page).toBe(0);
    expect(mesh(panel, 'head').visible).toBe(true);
    expect(mesh(panel, 'sub').visible).toBe(true);
    for (let index = 0; index < 14; index += 1) {
      expect(mesh(panel, `row-${index}`).visible).toBe(index < 6);
    }
    expect(mesh(panel, 'row-0').position.y).toBeCloseTo(-(0.0475 + 2 * 0.11));
    expect(mesh(panel, 'row-6').position.y).toBeCloseTo(-(0.0475 + 2 * 0.11));
    expect(panel.cellAt(mesh(panel, 'row-6'))).toBeNull();
    expect(panel.cellAt(mesh(panel, 'row-0'))).toBe('row-0');
  });

  it('turns pages through the pager cells and wraps', () => {
    const panel = pagedPanel();
    expect(panel.cellAt(mesh(panel, 'next'))).toBe('next');
    expect(panel.cellAt(mesh(panel, 'previous'))).toBe('previous');
    expect(mesh(panel, 'next').userData.labelText).toBe('Next › 1/3');
    expect(panel.activate('next')).toBe(true);
    expect(panel.page).toBe(1);
    expect(mesh(panel, 'next').userData.labelText).toBe('Next › 2/3');
    expect(mesh(panel, 'row-6').visible).toBe(true);
    expect(mesh(panel, 'row-0').visible).toBe(false);
    panel.setPage(0);
    panel.setPage(-1);
    expect(panel.page).toBe(2);
    expect(panel.activate('next')).toBe(true);
    expect(panel.page).toBe(0);
    expect(panel.activate('previous')).toBe(true);
    expect(panel.page).toBe(2);
  });

  it('keeps the pager row in place and measures the visible page', () => {
    const panel = pagedPanel();
    const pagerY = mesh(panel, 'next').position.y;
    expect(pagerY).toBeCloseTo(-(0.0475 + 8 * 0.11));
    expect(panel.height).toBeCloseTo(9 * 0.095 + 8 * 0.015);
    panel.setPage(2);
    expect(mesh(panel, 'next').position.y).toBe(pagerY);
    expect(mesh(panel, 'previous').position.y).toBe(pagerY);
    expect(panel.height).toBeCloseTo(9 * 0.095 + 8 * 0.015);
  });

  it('creates no pager when everything fits on one page', () => {
    const panel = createMenuPanel({ rows: pagedRows(4), pageSize: 6 });
    expect(panel.pageCount).toBe(1);
    expect(panel.root.getObjectByName('menu-next')).toBeUndefined();
    expect(panel.height).toBeCloseTo(4 * 0.095 + 3 * 0.015);
  });

  it('uses custom pager labels', () => {
    const panel = createMenuPanel({
      rows: pagedRows(4),
      pageSize: 2,
      previousLabel: 'Back',
      nextLabel: 'More',
    });
    expect(mesh(panel, 'previous').userData.labelText).toBe('Back');
    expect(mesh(panel, 'next').userData.labelText).toBe('More 1/2');
  });
});

describe('menu panel selection', () => {
  it('moves the selected background between cells', () => {
    const panel = createMenuPanel({ rows: [{ ...button('a'), selected: true }, button('b')] });
    expect(mesh(panel, 'a').userData.labelOptions).toEqual({ background: '#315c6d' });
    expect(mesh(panel, 'b').userData.labelOptions).toEqual({});
    const positionB = mesh(panel, 'b').position.clone();
    panel.setSelected('b');
    expect(mesh(panel, 'a').userData.labelOptions).toEqual({});
    expect(mesh(panel, 'b').userData.labelOptions).toEqual({ background: '#315c6d' });
    expect(mesh(panel, 'b').position).toEqual(positionB);
    expect(mesh(panel, 'b').userData.controlId).toBe('menu-b');
    expect(panel.cellAt(mesh(panel, 'b'))).toBe('b');
    expect(disposeScalableLabel).toHaveBeenCalledTimes(2);
    panel.setSelected(null);
    expect(mesh(panel, 'b').userData.labelOptions).toEqual({});
  });
});

describe('menu panel rows', () => {
  it('replaces rows, disposes old labels and resets the page', () => {
    const panel = createMenuPanel({ rows: pagedRows(4), pageSize: 2 });
    const labelCount = vi.mocked(createScalableLabel).mock.calls.length;
    panel.setPage(1);
    panel.setRows([button('only')]);
    expect(disposeScalableLabel).toHaveBeenCalledTimes(labelCount);
    expect(panel.page).toBe(0);
    expect(panel.pageCount).toBe(1);
    expect(panel.root.getObjectByName('menu-row-0')).toBeUndefined();
    expect(mesh(panel, 'only').position.y).toBeCloseTo(-0.0475);
  });
});

describe('menu panel hover', () => {
  it('tints the hovered cell and restores the previous one', () => {
    const panel = createMenuPanel({ rows: [button('a'), button('b'), { id: 't', label: 'T' }] });
    const colorOf = (id: string) => (mesh(panel, id).material as THREE.MeshBasicMaterial).color;
    panel.setHovered('a');
    expect(colorOf('a').getHex()).toBe(0xd9ffca);
    panel.setHovered('b');
    expect(colorOf('a').getHex()).toBe(0xffffff);
    expect(colorOf('b').getHex()).toBe(0xd9ffca);
    panel.setHovered('t');
    expect(colorOf('t').getHex()).toBe(0xffffff);
    expect(colorOf('b').getHex()).toBe(0xd9ffca);
    panel.setHovered(null);
    expect(colorOf('b').getHex()).toBe(0xffffff);
  });

  it('uses a custom hover colour', () => {
    const panel = createMenuPanel({ rows: [button('a')], hoverColor: 0x112233 });
    panel.setHovered('a');
    expect((mesh(panel, 'a').material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x112233);
  });

  it('clears the hover when the cell goes off page', () => {
    const panel = createMenuPanel({ rows: pagedRows(4), pageSize: 2 });
    const first = mesh(panel, 'row-0').material as THREE.MeshBasicMaterial;
    panel.setHovered('row-0');
    panel.setPage(1);
    expect(first.color.getHex()).toBe(0xffffff);
    panel.setHovered('row-0');
    expect(first.color.getHex()).toBe(0xffffff);
  });
});

describe('menu panel lifecycle', () => {
  it('throws on duplicate ids', () => {
    expect(() => createMenuPanel({ rows: [button('a'), [button('a'), button('b')]] })).toThrow(
      /Duplicate/,
    );
    const panel = createMenuPanel({ rows: [button('a')] });
    expect(() => panel.setRows([button('x'), button('x')])).toThrow(/Duplicate/);
  });

  it('disposes once and ignores later calls', () => {
    const parent = new THREE.Group();
    const onSelect = vi.fn();
    const panel = createMenuPanel({ rows: [button('a', 'A', onSelect), button('b')] });
    parent.add(panel.root);
    panel.dispose();
    expect(disposeScalableLabel).toHaveBeenCalledTimes(2);
    expect(panel.root.children).toHaveLength(0);
    expect(panel.root.parent).toBeNull();
    panel.dispose();
    expect(disposeScalableLabel).toHaveBeenCalledTimes(2);
    expect(panel.activate('a')).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(() => {
      panel.setLabel('a', 'x');
      panel.setSelected('a');
      panel.setRows([button('c')]);
      panel.setPage(1);
      panel.setHovered('a');
    }).not.toThrow();
    expect(panel.root.children).toHaveLength(0);
  });
});
