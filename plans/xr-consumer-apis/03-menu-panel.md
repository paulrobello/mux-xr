# Slice 3: menu panel

## Problem

Audio Probe XR builds its Music, Tracks and Visuals menus by hand: an `add(menu, text, x, y, action, width)` helper places each label at a computed offset, a `Map` holds the handlers, and paging, hover and hit resolution are written out again for each menu. Read `src/immersive.ts` in the sibling `audio-probe-xr` checkout (read-only) for the shapes this component has to cover: full-width rows, rows of two half-width buttons, a `−` / value / `+` row, rows whose text changes (`Arms on`, `Shuffle off`), a paged track list with `‹ Prev` and `Next › 2/3`, and a highlighted current item.

## Files

Create only `packages/xr-workspace/src/menu-panel.ts` and `tests/menu-panel.test.ts`. Edit nothing else.

Import `createScalableLabel`, `updateScalableLabel` and `disposeScalableLabel` from `./labels`. Another slice is adding a `name` option to `createScalableLabel` and making `updateScalableLabel` skip unchanged text; depend on neither. Set `name` and `userData.controlId` on each cell yourself, and skip unchanged text yourself.

For tests, labels need troika and a font. `tests/radial-menu.test.ts` shows how a test of a module that imports `./labels` replaces it with `tests/helpers/labels.ts`; use the same mechanism.

## Model

A panel is a list of rows. A row is one cell or several cells side by side. A cell with a handler is a button; a cell without one is text.

```ts
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
  /** Highlights one cell and restores the previous one. */
  setHovered(id: string | null): void;
  dispose(): void;
}
export function createMenuPanel(options: MenuPanelOptions): MenuPanel;
```

## Layout

- Row `i` on the visible page is centred at `y = -(rowHeight / 2 + i * (rowHeight + rowGap))`, so the panel's top edge is at `y = 0`. With the defaults the pitch is 0.11 m, which matches the consumer's existing menus.
- Cells in a row share `width - cellGap * (cells - 1)` in proportion to `weight`, laid left to right, centred on `x = 0` as a group. A single cell spans the full width. Two equal cells at the defaults are 0.22 m wide, centred at `x = ±0.13`.
- Each cell is one `createScalableLabel(label, cellWidth, rowHeight, { background })`. Text cells use `backplate: false` unless the cell sets `backplate: true`, which gives a plated, non-interactive value cell (the middle of a `−` / value / `+` row). A button with `backplate: false` stays interactive. Button cells use the label default background; a selected cell uses `#315c6d` (the radial menu's selected colour).
- `setSelected` and a `selected` change need a new background, which a label bakes into a texture at creation: dispose that cell's label and create a new one in place (same position, name, control id).
- Each cell mesh gets `name` and `userData.controlId` equal to `<name>-<cell id>`. The pager cells are `<name>-previous` and `<name>-next`.

## Paging

- With `pageSize` set, the first `pinnedRows` rows show on every page. The remaining rows are split into pages of `pageSize`. `pageCount` is at least 1.
- Rows on other pages have `visible = false`. Position every paged row by its index within its own page, so each page starts directly under the pinned rows.
- When `pageCount > 1`, one pager row is appended under a full page's worth of rows (at row index `pinnedRows + pageSize`, so it does not move between pages): two equal cells, previous and next. The next cell's label is `<nextLabel> <page + 1>/<pageCount>`. When `pageCount` is 1 the pager row is not created.
- `height` is the bottom edge of the lowest visible row: `rows * rowHeight + (rows - 1) * rowGap` for the rows on show, counting the pager row when present.

## Behaviour

- `cellAt` walks from the object up through its parents until it reaches a cell mesh or the panel root. It returns null if any object on that path up to and including the root has `visible === false`, or the cell has no handler.
- `activate` returns false for unknown ids and text cells.
- `setHovered` tints the hovered cell: `mesh.material.color.set(hoverColor)`, and restores the previous cell to `0xffffff`. A label's material is a `MeshBasicMaterial` whose colour multiplies its backplate texture, which is how the consumer highlights rows today. Add `hoverColor?: THREE.ColorRepresentation` to `MenuPanelOptions`, default `0xd9ffca`. Ignore ids that are not interactive. Clear the hover when the hovered cell is rebuilt or goes off-page.
- `dispose` disposes every label, clears and detaches the root, and makes later calls no-ops.
- No `update` method, no animation, no scrolling, no backplate behind the rows.
- Throw on duplicate cell ids in `createMenuPanel` and `setRows`: a silent duplicate would make `setLabel` and `activate` hit the wrong cell.

## Tests

- Layout: three single rows sit at `y = -0.0475, -0.1575, -0.2675` with the defaults; `height` is 0.315; a two-cell row gives widths 0.22 at `x = ∓0.13`; weights `[1, 3, 1]` at width 0.48 give widths `0.08, 0.24, 0.08` with 0.04 gaps (assert positions and `userData.labelWidth`).
- Control ids and names; `cellAt` on a cell mesh and on a child of it; null for a text cell and for an object outside the panel.
- `activate` calls the handler once and returns true; false for text and unknown ids.
- `setLabel` changes `userData.labelText`; a same-text call does not call `updateScalableLabel` again (spy on the mocked module).
- Paging: 2 pinned rows, 14 paged rows, `pageSize` 6 → `pageCount` 3; page 0 shows paged rows 0–5; off-page rows are hidden and `cellAt` returns null for them; `activate('next')` goes to page 1 and updates the next label to end `2/3`; `setPage(-1)` wraps to the last page; the pager row's `y` is the same on every page; with 4 paged rows there is no pager row.
- `setSelected` moves the selected background from one cell to another, keeping names and positions.
- `setRows` disposes the old labels (spy on `disposeScalableLabel`) and resets the page.
- `setHovered` tints the cell's material colour and restores the previous cell to white; a custom `hoverColor` is used.
- Duplicate ids throw. `dispose` is idempotent.

## Done when

`bunx vitest run tests/menu-panel.test.ts` passes, `bunx tsc --noEmit -p .` reports no errors in `menu-panel.ts`, and `bunx biome check` is clean on both files.
