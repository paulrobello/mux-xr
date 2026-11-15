import * as THREE from 'three';
import { createScalableLabel, disposeScalableLabel, updateScalableLabel } from './labels';

export interface MenuCell {
  /** Unique within the panel. The control id is `<panel name>-<id>`. */
  id: string;
  label: string;
  /** Omit for a non-interactive text cell. */
  onSelect?: () => void;
  /** Share of the row's width relative to its siblings. Defaults to 1. */
  weight?: number;
  /** Draws the cell in the selected colour. */
  selected?: boolean;
  /** Draw the backplate. Defaults to true for buttons and false for text cells. */
  backplate?: boolean;
}
export type MenuRow = MenuCell | readonly MenuCell[];

export interface MenuPanelOptions {
  rows: readonly MenuRow[];
  /** Prefix for control ids. Defaults to 'menu'. */
  name?: string;
  /** Metres. Defaults: width 0.48, rowHeight 0.095, rowGap 0.015, cellGap 0.04. */
  width?: number;
  rowHeight?: number;
  rowGap?: number;
  cellGap?: number;
  /** Rows from the top that stay on every page (a header). Defaults to 0. */
  pinnedRows?: number;
  /** Rows per page after the pinned ones. Omit for a single page. */
  pageSize?: number;
  /** Labels for the pager cells. Defaults '‹ Prev' and 'Next ›'. */
  previousLabel?: string;
  nextLabel?: string;
  /** Tint applied to the hovered cell's material, which multiplies its backplate. Defaults to 0xd9ffca. */
  hoverColor?: THREE.ColorRepresentation;
}

export interface MenuPanel {
  /** Rows run down from the origin in the local XY plane, facing +Z, centred on X. */
  readonly root: THREE.Group;
  /** Laid-out height in metres of the current page, pager row included. */
  readonly height: number;
  readonly page: number;
  readonly pageCount: number;
  /** Wraps in both directions. */
  setPage(page: number): void;
  /** Replaces every row, disposing the old labels. The page resets to 0. */
  setRows(rows: readonly MenuRow[]): void;
  /** Changes a cell's text. Does nothing when the text is unchanged or the id is unknown. */
  setLabel(id: string, label: string): void;
  /** Marks one cell selected and clears the others. Null clears all. */
  setSelected(id: string | null): void;
  /** The cell id for a hit object or any ancestor inside the panel; null for text cells, cells on another page, and objects outside the panel. Pager cells resolve to 'previous' and 'next'. */
  cellAt(object: THREE.Object3D): string | null;
  /** Runs the cell's handler, or turns the page for 'previous' / 'next'. Returns whether it did. */
  activate(id: string): boolean;
  /** Tints one cell and restores the previous one. */
  setHovered(id: string | null): void;
  dispose(): void;
}

const SELECTED_BACKGROUND = '#315c6d';
const DEFAULT_HOVER_COLOR = 0xd9ffca;

interface Cell {
  id: string;
  label: string;
  onSelect?: () => void;
  backplate?: boolean;
  /** Page the cell shows on; null when it shows on every page. */
  page: number | null;
  row: number;
  mesh: THREE.Mesh | null;
  x: number;
  y: number;
  width: number;
}

export function createMenuPanel(options: MenuPanelOptions): MenuPanel {
  const name = options.name ?? 'menu';
  const width = options.width ?? 0.48;
  const rowHeight = options.rowHeight ?? 0.095;
  const rowGap = options.rowGap ?? 0.015;
  const cellGap = options.cellGap ?? 0.04;
  const pinnedRows = Math.max(0, Math.floor(options.pinnedRows ?? 0));
  const pageSize =
    options.pageSize === undefined ? undefined : Math.max(1, Math.floor(options.pageSize));
  const previousLabel = options.previousLabel ?? '‹ Prev';
  const nextLabel = options.nextLabel ?? 'Next ›';
  const hoverColor = new THREE.Color(options.hoverColor ?? DEFAULT_HOVER_COLOR);

  const root = new THREE.Group();
  root.name = name;
  const cells = new Map<string, Cell>();
  const pager = new Map<string, Cell>();
  const idByMesh = new Map<THREE.Object3D, string>();
  const selected = new Set<string>();
  let page = 0;
  let pageCount = 1;
  let height = 0;
  let hovered: Cell | null = null;
  let disposed = false;

  const rowY = (index: number): number => -(rowHeight / 2 + index * (rowHeight + rowGap));

  function layoutRow(weights: readonly number[], index: number) {
    const available = width - cellGap * (weights.length - 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let left = -width / 2;
    return weights.map((weight) => {
      const cellWidth = (available * weight) / total;
      const x = left + cellWidth / 2;
      left += cellWidth + cellGap;
      return { x, y: rowY(index), width: cellWidth };
    });
  }

  function hasBackplate(cell: Cell, isPager: boolean): boolean {
    return cell.backplate ?? (cell.onSelect !== undefined || isPager);
  }

  function mountMesh(cell: Cell, isPager: boolean): void {
    const labelOptions = !hasBackplate(cell, isPager)
      ? { backplate: false }
      : selected.has(cell.id)
        ? { background: SELECTED_BACKGROUND }
        : {};
    const mesh = createScalableLabel(cell.label, cell.width, rowHeight, labelOptions);
    const controlId = `${name}-${cell.id}`;
    mesh.name = controlId;
    mesh.userData.controlId = controlId;
    mesh.position.set(cell.x, cell.y, 0);
    cell.mesh = mesh;
    idByMesh.set(mesh, cell.id);
    root.add(mesh);
  }

  function unmountMesh(cell: Cell): void {
    if (!cell.mesh) return;
    if (hovered === cell) hovered = null;
    idByMesh.delete(cell.mesh);
    root.remove(cell.mesh);
    disposeScalableLabel(cell.mesh);
    cell.mesh = null;
  }

  function rebuildMesh(cell: Cell, isPager: boolean): void {
    const visible = cell.mesh?.visible ?? true;
    unmountMesh(cell);
    mountMesh(cell, isPager);
    if (cell.mesh) cell.mesh.visible = visible;
  }

  function setCellLabel(cell: Cell, label: string): void {
    if (cell.label === label) return;
    cell.label = label;
    if (cell.mesh) updateScalableLabel(cell.mesh, label);
  }

  function find(id: string): Cell | undefined {
    return cells.get(id) ?? pager.get(id);
  }

  function pageText(): string {
    return `${nextLabel} ${page + 1}/${pageCount}`;
  }

  function clear(): void {
    for (const cell of [...cells.values(), ...pager.values()]) unmountMesh(cell);
    cells.clear();
    pager.clear();
    selected.clear();
    hovered = null;
  }

  function placeRows(rows: readonly MenuRow[], firstIndex: number, rowPage: number | null): void {
    rows.forEach((row, offset) => {
      const rowCells: readonly MenuCell[] = Array.isArray(row)
        ? (row as readonly MenuCell[])
        : [row as MenuCell];
      const boxes = layoutRow(
        rowCells.map((cell) => cell.weight ?? 1),
        firstIndex + offset,
      );
      rowCells.forEach((source, index) => {
        cells.set(source.id, {
          id: source.id,
          label: source.label,
          onSelect: source.onSelect,
          backplate: source.backplate,
          page: rowPage,
          row: firstIndex + offset,
          mesh: null,
          ...boxes[index],
        });
        if (source.selected) selected.add(source.id);
      });
    });
  }

  function assertUnique(rows: readonly MenuRow[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const cell of Array.isArray(row) ? (row as readonly MenuCell[]) : [row as MenuCell]) {
        if (seen.has(cell.id)) throw new Error(`Duplicate menu cell id "${cell.id}"`);
        seen.add(cell.id);
      }
    }
  }

  function build(rows: readonly MenuRow[]): void {
    assertUnique(rows);
    clear();
    const pinned = pageSize === undefined ? rows : rows.slice(0, pinnedRows);
    const paged = pageSize === undefined ? [] : rows.slice(pinnedRows);
    pageCount = pageSize === undefined ? 1 : Math.max(1, Math.ceil(paged.length / pageSize));
    page = 0;
    placeRows(pinned, 0, null);
    if (pageSize !== undefined) {
      for (let index = 0; index < pageCount; index += 1) {
        placeRows(paged.slice(index * pageSize, (index + 1) * pageSize), pinned.length, index);
      }
      if (pageCount > 1) {
        const boxes = layoutRow([1, 1], pinned.length + pageSize);
        [
          ['previous', previousLabel],
          ['next', pageText()],
        ].forEach(([id, label], index) => {
          pager.set(id, {
            id,
            label,
            page: null,
            row: pinned.length + pageSize,
            mesh: null,
            ...boxes[index],
          });
        });
      }
    }
    for (const cell of cells.values()) mountMesh(cell, false);
    for (const cell of pager.values()) mountMesh(cell, true);
    applyPage();
  }

  function applyPage(): void {
    let lastRow = -1;
    for (const cell of [...cells.values(), ...pager.values()]) {
      const visible = cell.page === null || cell.page === page;
      if (cell.mesh) cell.mesh.visible = visible;
      if (visible) lastRow = Math.max(lastRow, cell.row);
      if (!visible && hovered === cell) setHovered(null);
    }
    const next = pager.get('next');
    if (next) setCellLabel(next, pageText());
    const rowCount = lastRow + 1;
    height = rowCount > 0 ? rowCount * rowHeight + (rowCount - 1) * rowGap : 0;
  }

  function setPage(target: number): void {
    if (disposed) return;
    const wrapped = ((Math.floor(target) % pageCount) + pageCount) % pageCount;
    if (wrapped === page) return;
    page = wrapped;
    applyPage();
  }

  function setHovered(id: string | null): void {
    if (disposed) return;
    const cell = id === null ? null : find(id);
    if (id !== null && (!cell?.mesh?.visible || !isInteractive(cell))) return;
    if (hovered?.mesh) tint(hovered.mesh, 0xffffff);
    hovered = cell ?? null;
    if (hovered?.mesh) tint(hovered.mesh, hoverColor);
  }

  function isInteractive(cell: Cell): boolean {
    return cell.onSelect !== undefined || pager.get(cell.id) === cell;
  }

  function tint(mesh: THREE.Mesh, color: THREE.ColorRepresentation): void {
    (mesh.material as THREE.MeshBasicMaterial).color.set(color);
  }

  build(options.rows);

  return {
    root,
    get height() {
      return height;
    },
    get page() {
      return page;
    },
    get pageCount() {
      return pageCount;
    },
    setPage,
    setRows(rows) {
      if (disposed) return;
      build(rows);
    },
    setLabel(id, label) {
      if (disposed) return;
      const cell = cells.get(id);
      if (cell) setCellLabel(cell, label);
    },
    setSelected(id) {
      if (disposed) return;
      const before = new Set(selected);
      selected.clear();
      if (id !== null && cells.has(id)) selected.add(id);
      for (const cellId of new Set([...before, ...selected])) {
        if (before.has(cellId) === selected.has(cellId)) continue;
        const cell = cells.get(cellId);
        if (cell && hasBackplate(cell, false)) rebuildMesh(cell, false);
      }
    },
    cellAt(object) {
      if (disposed) return null;
      let id: string | null = null;
      for (let current: THREE.Object3D | null = object; current; current = current.parent) {
        if (!current.visible) return null;
        id ??= idByMesh.get(current) ?? null;
        if (current === root) {
          const cell = id === null ? undefined : find(id);
          return cell && isInteractive(cell) ? id : null;
        }
      }
      return null;
    },
    activate(id) {
      if (disposed) return false;
      if (pageCount > 1 && (id === 'previous' || id === 'next')) {
        setPage(page + (id === 'next' ? 1 : -1));
        return true;
      }
      const cell = cells.get(id);
      if (!cell?.onSelect) return false;
      cell.onSelect();
      return true;
    },
    setHovered,
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      root.clear();
      root.removeFromParent();
    },
  };
}
