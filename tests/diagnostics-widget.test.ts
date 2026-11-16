import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { diagnostics } from '../src/diagnostics';
import {
  createDiagnosticsWidget,
  DIAGNOSTICS_MAX_ROWS,
  hasUnseenDiagnostics,
  markDiagnosticsSeen,
} from '../src/xr/diagnostics-widget';

const NOW = 1_800_000_000_000;

type DiagnosticsWidget = ReturnType<typeof createDiagnosticsWidget>;

function shownRows(widget: DiagnosticsWidget): THREE.Object3D[] {
  return widget.root.children.filter(
    (child) => child.name.startsWith('diagnostics-row-') && child.visible,
  );
}

function part(row: THREE.Object3D, name: string): THREE.Object3D {
  const found = row.getObjectByName(`diagnostics-row-${name}`);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function labels(widget: DiagnosticsWidget): string[] {
  return shownRows(widget).map((row) => String(part(row, 'label').userData.labelText));
}

function named(widget: DiagnosticsWidget, name: string): THREE.Object3D {
  const found = widget.root.getObjectByName(name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe('diagnostics widget', () => {
  beforeEach(() => diagnostics.clear());
  afterEach(() => vi.restoreAllMocks());

  it('shows a quiet empty state', () => {
    const widget = createDiagnosticsWidget(null);
    expect(shownRows(widget)).toHaveLength(0);
    expect(named(widget, 'diagnostics-empty').visible).toBe(true);
    expect(named(widget, 'diagnostics-header').userData.labelText).toBe('Diagnostics');
    expect(named(widget, 'diagnostics-overflow').visible).toBe(false);
    widget.dispose();
  });

  it('lists the newest eight entries with scope, message and age, newest first', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    for (let index = 1; index <= DIAGNOSTICS_MAX_ROWS + 2; index += 1)
      diagnostics.report(`scope.${index}`, new Error(`failure ${index}`));
    const widget = createDiagnosticsWidget(null);
    widget.setEntries(diagnostics.entries());
    expect(shownRows(widget)).toHaveLength(DIAGNOSTICS_MAX_ROWS);
    expect(labels(widget)[0]).toBe('scope.10 · failure 10');
    expect(labels(widget).at(-1)).toBe('scope.3 · failure 3');
    expect(named(widget, 'diagnostics-overflow').userData.labelText).toBe('+2 more');
    const rows = shownRows(widget);
    expect(rows.map((row) => part(row, 'age').userData.labelText)).toEqual(
      Array.from({ length: DIAGNOSTICS_MAX_ROWS }, () => 'now'),
    );
    widget.dispose();
  });

  it('prefixes a tripled entry with its count and keeps the full row in hover help', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    diagnostics.report('render.frame', new Error('context lost'));
    diagnostics.report('render.frame', new Error('context lost'));
    diagnostics.report('render.frame', new Error('context lost'));
    const widget = createDiagnosticsWidget(null);
    widget.setEntries(diagnostics.entries());
    expect(labels(widget)[0]?.startsWith('×3 ')).toBe(true);
    expect(part(shownRows(widget)[0] as THREE.Object3D, 'label').userData.helpText).toBe(
      'render.frame · context lost',
    );
    widget.dispose();
  });

  it('clear empties the log and the panel', () => {
    diagnostics.report('host.stats', new Error('unavailable'));
    const widget = createDiagnosticsWidget(null);
    widget.setEntries(diagnostics.entries());
    expect(shownRows(widget)).toHaveLength(1);
    const clearButton = named(widget, 'diagnostics-clear');
    expect(clearButton.userData.inputAction).toBe('widgetControl');
    expect(clearButton.userData.diagnosticsAction).toBe('clear');
    widget.activate?.(clearButton);
    expect(diagnostics.entries()).toHaveLength(0);
    widget.setEntries(diagnostics.entries());
    expect(shownRows(widget)).toHaveLength(0);
    expect(named(widget, 'diagnostics-empty').visible).toBe(true);
    widget.dispose();
  });

  it('refreshes ages at most once a second and marks the log seen', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    diagnostics.report('host.stats', new Error('unavailable'));
    const widget = createDiagnosticsWidget(null);
    widget.setEntries(diagnostics.entries());
    const age = (): unknown =>
      part(shownRows(widget)[0] as THREE.Object3D, 'age').userData.labelText;
    expect(age()).toBe('now');
    expect(hasUnseenDiagnostics()).toBe(true);
    widget.update(NOW + 400);
    expect(age()).toBe('now');
    expect(hasUnseenDiagnostics()).toBe(false);
    widget.update(NOW + 60_000);
    expect(age()).toBe('1m');
    expect(hasUnseenDiagnostics()).toBe(false);
    markDiagnosticsSeen(0);
    expect(hasUnseenDiagnostics()).toBe(true);
    const clearButton = named(widget, 'diagnostics-clear');
    widget.dispose();
    expect(() => widget.setEntries([])).not.toThrow();
    expect(() => widget.update(NOW + 120_000)).not.toThrow();
    expect(() => widget.activate?.(clearButton)).not.toThrow();
  });
});
