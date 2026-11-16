import { MAX_TERMINAL_CURVATURE_DEGREES } from '../workspace/window-preferences';

export interface TerminalControlsDeps {
  root: HTMLElement;
  /** The selected pane, which the grid, curvature and opacity controls edit. */
  activePaneId(): string | undefined;
  /** Asks the streamer to resize a pane; false when it cannot. */
  onResizeGrid?(paneId: string, cols: number, rows: number): boolean;
}

export interface TerminalControls {
  /** Saved per-pane curvature, shared with the settings panel's slider. */
  readonly curvature: Map<string, number>;
  /** Saved per-pane glass opacity percentage, shared with the settings panel's slider. */
  readonly opacity: Map<string, number>;
  /** Fills the controls from the saved values for the selected pane. */
  show(paneId: string): void;
  /** Disables the controls when no pane is selected. */
  clear(): void;
  setGrid(paneId: string, cols: number, rows: number, canResize: boolean): void;
  setCurvature(paneId: string, degrees: number): void;
  setOpacity(paneId: string, value: number): void;
}

/** The selected terminal's grid size, curvature and opacity controls in the settings panel. */
export function mountTerminalControls(deps: TerminalControlsDeps): TerminalControls {
  const { root } = deps;
  const qs = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  const terminalGrid = new Map<string, { cols: number; rows: number; canResize: boolean }>();
  const terminalCurvature = new Map<string, number>();
  const terminalOpacity = new Map<string, number>();
  const pendingGrid = new Map<string, { cols: number; rows: number }>();

  const clearGridControls = (): void => {
    qs<HTMLButtonElement>('[data-action="apply-grid"]').disabled = true;
    qs<HTMLElement>('[data-grid-caption]').textContent = 'No terminal selected';
    qs<HTMLElement>('[data-grid-status]').textContent =
      'Select an attached terminal to change its grid.';
    qs<HTMLInputElement>('[data-terminal-curvature]').value = '0';
    qs<HTMLElement>('[data-terminal-curvature-value]').textContent = '0°';
    qs<HTMLInputElement>('[data-terminal-curvature]').disabled = true;
    qs<HTMLInputElement>('[data-terminal-opacity]').value = '100';
    qs<HTMLElement>('[data-terminal-opacity-value]').textContent = '100%';
    qs<HTMLInputElement>('[data-terminal-opacity]').disabled = true;
    qs<HTMLButtonElement>('[data-action="reset-terminal-appearance"]').disabled = true;
  };
  const updateCurvatureControls = (paneId: string | undefined): void => {
    const input = qs<HTMLInputElement>('[data-terminal-curvature]');
    const value = paneId ? (terminalCurvature.get(paneId) ?? 0) : 0;
    input.value = String(value);
    input.disabled = !paneId;
    qs<HTMLElement>('[data-terminal-curvature-value]').textContent = `${value}°`;
  };
  const updateOpacityControls = (paneId: string | undefined): void => {
    const input = qs<HTMLInputElement>('[data-terminal-opacity]');
    const value = paneId ? (terminalOpacity.get(paneId) ?? 100) : 100;
    input.value = String(value);
    input.disabled = !paneId;
    qs<HTMLButtonElement>('[data-action="reset-terminal-appearance"]').disabled = !paneId;
    qs<HTMLElement>('[data-terminal-opacity-value]').textContent = `${value}%`;
  };

  qs<HTMLButtonElement>('[data-action="apply-grid"]').addEventListener('click', () => {
    const paneId = deps.activePaneId();
    const cols = Number(qs<HTMLInputElement>('[data-grid-cols]').value);
    const rows = Number(qs<HTMLInputElement>('[data-grid-rows]').value);
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      cols > 300 ||
      rows < 2 ||
      rows > 150
    ) {
      qs<HTMLElement>('[data-grid-status]').textContent = 'Use 2–300 columns and 2–150 rows.';
      return;
    }
    if (!paneId || !deps.onResizeGrid) {
      qs<HTMLElement>('[data-grid-status]').textContent =
        'Resize unavailable while disconnected or read-only.';
      return;
    }
    pendingGrid.set(paneId, { cols, rows });
    if (!deps.onResizeGrid(paneId, cols, rows)) {
      pendingGrid.delete(paneId);
      qs<HTMLElement>('[data-grid-status]').textContent =
        'Resize unavailable while disconnected or read-only.';
      return;
    }
    qs<HTMLElement>('[data-grid-status]').textContent =
      'Resize requested. Waiting for server confirmation…';
  });

  return {
    curvature: terminalCurvature,
    opacity: terminalOpacity,
    show(paneId) {
      updateCurvatureControls(paneId);
      updateOpacityControls(paneId);
      const grid = terminalGrid.get(paneId);
      if (grid) {
        pendingGrid.delete(paneId);
        qs<HTMLInputElement>('[data-grid-cols]').value = String(grid.cols);
        qs<HTMLInputElement>('[data-grid-rows]').value = String(grid.rows);
        qs<HTMLElement>('[data-grid-caption]').textContent = `${grid.cols} × ${grid.rows}`;
        qs<HTMLButtonElement>('[data-action="apply-grid"]').disabled = !grid.canResize;
      }
    },
    clear: clearGridControls,
    setGrid(paneId, cols, rows, canResize) {
      const previous = terminalGrid.get(paneId);
      const pending = pendingGrid.get(paneId);
      if (
        previous?.cols === cols &&
        previous.rows === rows &&
        previous.canResize === canResize &&
        (!pending || (pending.cols === cols && pending.rows === rows))
      )
        return;
      terminalGrid.set(paneId, { cols, rows, canResize });
      if (deps.activePaneId() !== paneId) return;
      const acknowledged = !pending || (pending.cols === cols && pending.rows === rows);
      if (acknowledged) {
        pendingGrid.delete(paneId);
        qs<HTMLInputElement>('[data-grid-cols]').value = String(cols);
        qs<HTMLInputElement>('[data-grid-rows]').value = String(rows);
      }
      qs<HTMLElement>('[data-grid-caption]').textContent = `${cols} × ${rows}`;
      const apply = qs<HTMLButtonElement>('[data-action="apply-grid"]');
      apply.disabled = !canResize;
      if (acknowledged)
        qs<HTMLElement>('[data-grid-status]').textContent = canResize
          ? 'Resize changes the process display size and do not restart it.'
          : 'Resize unavailable while disconnected or read-only.';
    },
    setCurvature(paneId, degrees) {
      const value = Number.isFinite(degrees)
        ? Math.max(0, Math.min(MAX_TERMINAL_CURVATURE_DEGREES, degrees))
        : 0;
      terminalCurvature.set(paneId, value);
      if (deps.activePaneId() === paneId) updateCurvatureControls(paneId);
    },
    setOpacity(paneId, value) {
      const opacity = Number.isFinite(value) ? Math.max(10, Math.min(100, value)) : 100;
      terminalOpacity.set(paneId, opacity);
      if (deps.activePaneId() === paneId) updateOpacityControls(paneId);
    },
  };
}
