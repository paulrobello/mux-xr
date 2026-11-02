import './styles.css';
import type { TerminalMouseInput, TerminalSurface } from '../contracts';

const CELL_WIDTH = 11;
const LINE_HEIGHT = 21;

export interface DesktopPanels {
  add(surface: TerminalSurface): void;
  remove(id: string): void;
  select(id: string | null): void;
  setImmersive(enabled: boolean): void;
  showTerminals(): void;
  showPreview(): void;
  dispose(): void;
}

export interface DesktopPanelCallbacks {
  onScale?(direction: number): void;
  onReset?(): void;
  onClose?(id: string): void;
  onToggleConnection?(id: string): void;
  onMouse?(id: string, input: TerminalMouseInput): boolean;
}

export function createDesktopPanels(
  host: HTMLElement,
  onSelect: (id: string) => void,
  callbacks: DesktopPanelCallbacks = {},
): DesktopPanels {
  const root = document.createElement('section');
  root.className = 'desktop-terminal-workspace';
  const toolbar = document.createElement('div');
  toolbar.className = 'desktop-terminal-toolbar';
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.dataset.action = 'desktop-preview';
  preview.textContent = '3D preview';
  preview.title = 'Show the workspace in 3D';
  preview.setAttribute('aria-pressed', 'false');
  const scaleDown = document.createElement('button');
  scaleDown.type = 'button';
  scaleDown.dataset.action = 'desktop-scale-down';
  scaleDown.textContent = 'Smaller panel';
  scaleDown.title = 'Make the selected panel smaller';
  const scaleUp = document.createElement('button');
  scaleUp.type = 'button';
  scaleUp.dataset.action = 'desktop-scale-up';
  scaleUp.textContent = 'Larger panel';
  scaleUp.title = 'Enlarge the selected panel, bounded by the browser view';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.dataset.action = 'desktop-reset-layout';
  reset.textContent = 'Reset layout';
  reset.title = 'Restore all panel positions and sizes';
  toolbar.append(preview, scaleDown, scaleUp, reset);
  const grid = document.createElement('div');
  grid.className = 'mux-desktop-panels';
  root.append(toolbar, grid);
  host.prepend(root);
  host.classList.add('desktop-terminal-host');
  const sceneCanvas = host.querySelector<HTMLCanvasElement>(
    'canvas[aria-label="Mux XR workspace"]',
  );
  let immersive = false;
  let previewing = false;
  let selectedPaneId: string | null = null;
  const updateMode = (): void => {
    host.classList.toggle('is-3d-preview', previewing);
    host.classList.toggle('is-immersive', immersive);
    if (sceneCanvas) sceneCanvas.style.display = previewing || immersive ? 'block' : 'none';
    root.hidden = immersive;
    grid.hidden = immersive || previewing;
    preview.textContent = previewing ? 'Show terminals' : '3D preview';
    preview.title = previewing ? 'Show terminal panels' : 'Show the workspace in 3D';
    preview.setAttribute('aria-pressed', String(previewing));
    scaleDown.hidden = scaleUp.hidden = reset.hidden = !previewing || immersive;
    scaleDown.disabled = scaleUp.disabled = !selectedPaneId;
    if (previewing || immersive) window.dispatchEvent(new Event('resize'));
  };
  preview.addEventListener('click', () => {
    previewing = !previewing;
    updateMode();
  });
  scaleDown.addEventListener('click', () => callbacks.onScale?.(-1));
  scaleUp.addEventListener('click', () => callbacks.onScale?.(1));
  reset.addEventListener('click', () => callbacks.onReset?.());
  const panels = new Map<
    string,
    {
      element: HTMLElement;
      unsubscribe: () => void;
      cancelMouse: () => void;
      cleanupMouse: () => void;
    }
  >();

  const updateSize = (surface: TerminalSurface, canvas: HTMLCanvasElement): void => {
    canvas.style.width = `${surface.cols * CELL_WIDTH}px`;
    canvas.style.height = `${surface.rows * LINE_HEIGHT}px`;
    canvas.style.imageRendering = 'auto';
    canvas.style.display = 'block';
  };
  const add = (surface: TerminalSurface): void => {
    if (panels.has(surface.pane.id)) return;
    const panel = document.createElement('article');
    panel.dataset.paneId = surface.pane.id;
    panel.className = 'desktop-terminal-panel';
    const heading = document.createElement('button');
    heading.type = 'button';
    const updateHeading = (): void => {
      const error = surface.error ? ` · ${surface.error.slice(0, 48)}` : '';
      heading.textContent = `${surface.pane.title} · ${surface.status}${error}`;
      heading.title = surface.error
        ? `${surface.error} Select terminal ${surface.pane.title} as the input target.`
        : `Select terminal ${surface.pane.title} as the input target`;
    };
    updateHeading();
    heading.className = 'desktop-terminal-heading';
    heading.addEventListener('click', () => onSelect(surface.pane.id));
    const controls = document.createElement('div');
    controls.className = 'desktop-terminal-controls';
    const connection = document.createElement('button');
    connection.type = 'button';
    connection.className = 'desktop-terminal-action';
    connection.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.onToggleConnection?.(surface.pane.id);
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'desktop-terminal-action';
    close.textContent = 'Close view';
    close.title = `Close ${surface.pane.title} view and keep the terminal running`;
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.onClose?.(surface.pane.id);
    });
    const updateActions = (): void => {
      const reconnect = !['connected', 'connecting'].includes(String(surface.status));
      connection.textContent = reconnect ? 'Reconnect' : 'Disconnect';
      connection.title = reconnect
        ? `Reconnect ${surface.pane.title} view to the running terminal`
        : `Disconnect ${surface.pane.title} view without stopping the terminal`;
      connection.setAttribute('aria-label', connection.title);
    };
    updateActions();
    controls.append(connection, close);
    const body = document.createElement('div');
    body.className = 'desktop-terminal-output';
    surface.canvas.setAttribute('aria-label', `${surface.pane.title} terminal output`);
    updateSize(surface, surface.canvas);
    body.append(surface.canvas);
    panel.append(heading, controls, body);
    grid.append(panel);
    let drag:
      | {
          pointerId: number;
          button: 0 | 1 | 2;
          modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean };
          cell: { col: number; row: number };
        }
      | undefined;
    let suppressContextMenu = false;
    const cellAt = (event: MouseEvent): { col: number; row: number } => {
      const rect = surface.canvas.getBoundingClientRect();
      const width = rect.width || surface.canvas.width || 1;
      const height = rect.height || surface.canvas.height || 1;
      const clientX = Number.isFinite(event.clientX) ? event.clientX : rect.left + width / 2;
      const clientY = Number.isFinite(event.clientY) ? event.clientY : rect.top + height / 2;
      const col = Math.max(
        0,
        Math.min(surface.cols - 1, Math.floor(((clientX - rect.left) / width) * surface.cols)),
      );
      const row = Math.max(
        0,
        Math.min(surface.rows - 1, Math.floor(((clientY - rect.top) / height) * surface.rows)),
      );
      return { col, row };
    };
    const modifiers = (
      event: PointerEvent,
    ): { shift?: boolean; ctrl?: boolean; alt?: boolean } => ({
      shift: event.shiftKey || undefined,
      ctrl: event.ctrlKey || undefined,
      alt: event.altKey || undefined,
    });
    const release = (): void => {
      if (!drag) return;
      const active = drag;
      drag = undefined;
      surface.canvas.releasePointerCapture?.(active.pointerId);
      callbacks.onMouse?.(surface.pane.id, {
        ...active.cell,
        button: active.button,
        eventType: 'release',
        modifiers: active.modifiers,
      });
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button < 0 || event.button > 2 || drag) return;
      suppressContextMenu = false;
      onSelect(surface.pane.id);
      const cell = cellAt(event);
      const button = event.button as 0 | 1 | 2;
      const handled =
        callbacks.onMouse?.(surface.pane.id, {
          ...cell,
          button,
          eventType: 'press',
          modifiers: modifiers(event),
        }) ?? false;
      if (!handled) return;
      drag = { pointerId: event.pointerId, button, modifiers: modifiers(event), cell };
      suppressContextMenu = button === 2;
      surface.canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const cell = cellAt(event);
      if (cell.col === drag.cell.col && cell.row === drag.cell.row) return;
      drag.cell = cell;
      const handled =
        callbacks.onMouse?.(surface.pane.id, {
          ...cell,
          button: drag.button,
          eventType: 'move',
          modifiers: drag.modifiers,
        }) ?? false;
      if (handled) event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (drag && event.pointerId === drag.pointerId) release();
    };
    const onLostCapture = (): void => release();
    const onContextMenu = (event: MouseEvent): void => {
      if (!suppressContextMenu) return;
      event.preventDefault();
      suppressContextMenu = false;
    };
    surface.canvas.addEventListener('pointerdown', onPointerDown);
    surface.canvas.addEventListener('pointermove', onPointerMove);
    surface.canvas.addEventListener('pointerup', onPointerUp);
    surface.canvas.addEventListener('pointercancel', release);
    surface.canvas.addEventListener('lostpointercapture', onLostCapture);
    surface.canvas.addEventListener('contextmenu', onContextMenu);
    const onWheel = (event: WheelEvent): void => {
      const unit = event.deltaMode === 0 ? LINE_HEIGHT : event.deltaMode === 2 ? surface.rows : 1;
      const magnitude = Math.abs(event.deltaY / unit);
      const lines = Math.sign(event.deltaY) * Math.max(1, Math.round(magnitude));
      if (lines === 0 || !surface.scroll?.(lines, cellAt(event))) return;
      onSelect(surface.pane.id);
      event.preventDefault();
    };
    surface.canvas.addEventListener('wheel', onWheel, { passive: false });
    const cleanupMouse = (): void => {
      release();
      suppressContextMenu = false;
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      surface.canvas.removeEventListener('pointercancel', release);
      surface.canvas.removeEventListener('lostpointercapture', onLostCapture);
      surface.canvas.removeEventListener('contextmenu', onContextMenu);
      surface.canvas.removeEventListener('wheel', onWheel);
    };
    const cancelMouse = (): void => release();
    const unsubscribe = surface.subscribe(() => {
      updateHeading();
      updateSize(surface, surface.canvas);
      updateActions();
    });
    panels.set(surface.pane.id, { element: panel, unsubscribe, cancelMouse, cleanupMouse });
  };
  const remove = (id: string): void => {
    const panel = panels.get(id);
    if (!panel) return;
    panel.cleanupMouse();
    panel.unsubscribe();
    panel.element.remove();
    panels.delete(id);
  };
  const select = (id: string | null): void => {
    selectedPaneId = id;
    scaleDown.disabled = scaleUp.disabled = !selectedPaneId;
    for (const [paneId, panel] of panels) {
      panel.element.classList.toggle('active', paneId === id);
      panel.element.querySelector('button')?.setAttribute('aria-pressed', String(paneId === id));
    }
  };
  const setImmersive = (enabled: boolean): void => {
    if (immersive === enabled) return;
    if (enabled) for (const panel of panels.values()) panel.cancelMouse();
    immersive = enabled;
    updateMode();
  };
  const dispose = (): void => {
    for (const id of [...panels.keys()]) remove(id);
    root.remove();
    host.classList.remove('desktop-terminal-host', 'is-3d-preview', 'is-immersive');
  };
  updateMode();
  return {
    add,
    remove,
    select,
    setImmersive,
    dispose,
    showTerminals() {
      previewing = false;
      updateMode();
    },
    showPreview() {
      previewing = true;
      updateMode();
    },
  };
}
