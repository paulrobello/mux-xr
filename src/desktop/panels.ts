import './styles.css';
import type { TerminalSurface } from '../contracts';

const CELL_WIDTH = 11;
const LINE_HEIGHT = 21;

export interface DesktopPanels {
  add(surface: TerminalSurface): void;
  remove(id: string): void;
  select(id: string | null): void;
  setImmersive(enabled: boolean): void;
  showTerminals(): void;
  dispose(): void;
}

export function createDesktopPanels(
  host: HTMLElement,
  onSelect: (id: string) => void,
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
  toolbar.append(preview);
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
  const updateMode = (): void => {
    host.classList.toggle('is-3d-preview', previewing);
    host.classList.toggle('is-immersive', immersive);
    if (sceneCanvas) sceneCanvas.style.display = previewing || immersive ? 'block' : 'none';
    root.hidden = immersive;
    grid.hidden = immersive || previewing;
    preview.textContent = previewing ? 'Show terminals' : '3D preview';
    preview.title = previewing ? 'Show terminal panels' : 'Show the workspace in 3D';
    preview.setAttribute('aria-pressed', String(previewing));
    if (previewing || immersive) window.dispatchEvent(new Event('resize'));
  };
  preview.addEventListener('click', () => {
    previewing = !previewing;
    updateMode();
  });
  const panels = new Map<string, { element: HTMLElement; unsubscribe: () => void }>();

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
    heading.textContent = `${surface.pane.title} · ${surface.status}`;
    heading.title = `Select terminal ${surface.pane.title} as the input target`;
    heading.className = 'desktop-terminal-heading';
    heading.addEventListener('click', () => onSelect(surface.pane.id));
    const body = document.createElement('div');
    body.className = 'desktop-terminal-output';
    body.addEventListener('pointerdown', () => onSelect(surface.pane.id));
    surface.canvas.setAttribute('aria-label', `${surface.pane.title} terminal output`);
    updateSize(surface, surface.canvas);
    body.append(surface.canvas);
    panel.append(heading, body);
    grid.append(panel);
    const unsubscribe = surface.subscribe(() => {
      heading.textContent = `${surface.pane.title} · ${surface.status}`;
      heading.title = `Select terminal ${surface.pane.title} as the input target`;
      updateSize(surface, surface.canvas);
    });
    panels.set(surface.pane.id, { element: panel, unsubscribe });
  };
  const remove = (id: string): void => {
    const panel = panels.get(id);
    if (!panel) return;
    panel.unsubscribe();
    panel.element.remove();
    panels.delete(id);
  };
  const select = (id: string | null): void => {
    for (const [paneId, panel] of panels) {
      panel.element.classList.toggle('active', paneId === id);
      panel.element.querySelector('button')?.setAttribute('aria-pressed', String(paneId === id));
    }
  };
  const setImmersive = (enabled: boolean): void => {
    if (immersive === enabled) return;
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
  };
}
