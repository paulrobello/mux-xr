// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor, TerminalMouseInput, TerminalSurface } from '../src/contracts';
import { createDesktopPanels } from '../src/desktop/panels';

const pane: PaneDescriptor = {
  id: 'pane-1',
  workspaceId: 'w',
  workspaceName: 'Workspace',
  sessionId: 's',
  sessionName: 'Session',
  windowId: 'win',
  windowName: 'Window',
  title: 'Terminal',
  cols: 10,
  rows: 5,
};

function surface(): TerminalSurface {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left: 100, top: 50, width: 500, height: 250 }),
  });
  Object.assign(canvas, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  return {
    canvas,
    pane,
    revision: 0,
    cols: 10,
    rows: 5,
    status: 'connected',
    error: null,
    canResizeGrid: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendText: () => true,
    sendKey: () => true,
    scroll: vi.fn(() => true),
    paste: () => true,
    focus: () => undefined,
    resizeGrid: () => true,
    setColorMode: () => undefined,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, ...init });
}

function canvasFor(host: HTMLElement): HTMLCanvasElement {
  const canvas = host.querySelector<HTMLCanvasElement>(
    'canvas[aria-label="Terminal terminal output"]',
  );
  if (!canvas) throw new Error('missing terminal canvas');
  return canvas;
}

describe('desktop terminal mouse adapter', () => {
  it('maps wheel units to terminal lines and prevents the browser scroll when handled', () => {
    const host = document.createElement('div');
    const desktop = createDesktopPanels(host, () => undefined);
    const terminal = surface();
    desktop.add(terminal);
    const canvas = canvasFor(host);
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 42,
      deltaMode: 0,
      clientX: 150,
      clientY: 100,
    });
    Object.defineProperties(event, { clientX: { value: 150 }, clientY: { value: 100 } });
    canvas.dispatchEvent(event);
    expect(vi.mocked(terminal.scroll)).toHaveBeenCalledWith(2, { col: 1, row: 1 });
    expect(event.defaultPrevented).toBe(true);
    desktop.dispose();
  });

  it('maps CSS coordinates, captures the source pane, and releases after drag', () => {
    const host = document.createElement('div');
    const selected: string[] = [];
    const mouse = vi.fn((_id: string, _input: TerminalMouseInput) => true);
    const desktop = createDesktopPanels(host, (id) => selected.push(id), { onMouse: mouse });
    const terminal = surface();
    desktop.add(terminal);
    const canvas = canvasFor(host);

    canvas.dispatchEvent(
      pointer('pointerdown', {
        pointerId: 4,
        button: 0,
        clientX: 150,
        clientY: 100,
        shiftKey: true,
      }),
    );
    canvas.dispatchEvent(
      pointer('pointermove', { pointerId: 4, clientX: 649, clientY: 299, button: 0 }),
    );
    canvas.dispatchEvent(pointer('pointerup', { pointerId: 4, clientX: 649, clientY: 299 }));

    expect(selected).toEqual(['pane-1']);
    expect(mouse.mock.calls.map(([, input]) => input)).toEqual([
      { col: 1, row: 1, button: 0, eventType: 'press', modifiers: { shift: true } },
      { col: 9, row: 4, button: 0, eventType: 'move', modifiers: { shift: true } },
      { col: 9, row: 4, button: 0, eventType: 'release', modifiers: { shift: true } },
    ]);
    expect(vi.mocked(canvas.setPointerCapture)).toHaveBeenCalledWith(4);
    desktop.dispose();
  });

  it('does not capture or suppress defaults when mouse input is gated off', () => {
    const host = document.createElement('div');
    const mouse = vi.fn(() => false);
    const desktop = createDesktopPanels(host, () => undefined, { onMouse: mouse });
    const terminal = surface();
    desktop.add(terminal);
    const canvas = canvasFor(host);
    const event = pointer('pointerdown', { pointerId: 1, button: 0, clientX: 110, clientY: 60 });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(vi.mocked(canvas.setPointerCapture)).not.toHaveBeenCalled();
    desktop.dispose();
  });
});
