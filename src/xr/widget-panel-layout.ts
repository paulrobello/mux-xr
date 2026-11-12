/** A centred rectangle in input-panel units. */
export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetPanelLayout {
  /** The clamped page shown. */
  page: number;
  pages: number;
  /** Registry index of the first entry on this page. */
  first: number;
  title: PanelRect;
  close: PanelRect;
  /** One rect per entry on this page, in registry order. */
  buttons: PanelRect[];
  pager: { prev: PanelRect; caption: PanelRect; next: PanelRect } | null;
  /** Lowest edge of any control, before the backdrop's margin. */
  bottom: number;
}

/** Matches the shared title label the input panel draws for every non-typing mode. */
export const WIDGET_PANEL_TITLE: PanelRect = { x: 0, y: 0.56, width: 0.9, height: 0.12 };
const CLOSE_SIZE = { width: 0.3, height: 0.09 };
const COLUMNS = 2;
const BUTTON_WIDTH = 0.8;
const BUTTON_HEIGHT = 0.14;
const COLUMN_GAP = 0.06;
const ROW_GAP = 0.03;
/**
 * Lowest control edge. At the spawn poses the HUD's clickable notice line (drawn without depth
 * testing, over this panel) projects onto the panel plane from y -0.46 down and the HUD bar from
 * -0.87 down, so with the backdrop's 0.06 margin the panel ends 0.05 above the notice.
 */
export const WIDGET_PANEL_MIN_BOTTOM = -0.35;

const PITCH = BUTTON_HEIGHT + ROW_GAP;
const COLUMN_X = (BUTTON_WIDTH + COLUMN_GAP) / 2;
const FIRST_ROW_Y =
  WIDGET_PANEL_TITLE.y - WIDGET_PANEL_TITLE.height / 2 - ROW_GAP - BUTTON_HEIGHT / 2;
const rowY = (row: number): number => FIRST_ROW_Y - row * PITCH;
const MAX_ROWS =
  Math.floor((FIRST_ROW_Y - BUTTON_HEIGHT / 2 - WIDGET_PANEL_MIN_BOTTOM) / PITCH + 1e-9) + 1;

export function layoutWidgetPanel(count: number, page = 0): WidgetPanelLayout {
  const fitsOnePage = count <= MAX_ROWS * COLUMNS;
  const perPage = (fitsOnePage ? MAX_ROWS : MAX_ROWS - 1) * COLUMNS;
  const pages = Math.max(1, Math.ceil(count / perPage));
  const shown = Math.max(0, Math.min(pages - 1, page));
  const first = shown * perPage;
  const buttons = Array.from({ length: Math.min(perPage, count - first) }, (_, index) => ({
    x: (index % COLUMNS ? 1 : -1) * COLUMN_X,
    y: rowY(Math.floor(index / COLUMNS)),
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
  }));
  const close: PanelRect = {
    x: COLUMN_X + BUTTON_WIDTH / 2 - CLOSE_SIZE.width / 2,
    y: WIDGET_PANEL_TITLE.y,
    ...CLOSE_SIZE,
  };
  let pager: WidgetPanelLayout['pager'] = null;
  if (pages > 1) {
    const y = rowY(MAX_ROWS - 1);
    pager = {
      prev: { x: -COLUMN_X, y, width: 0.34, height: BUTTON_HEIGHT },
      caption: { x: 0, y, width: 0.3, height: 0.09 },
      next: { x: COLUMN_X, y, width: 0.34, height: BUTTON_HEIGHT },
    };
  }
  const rects = [WIDGET_PANEL_TITLE, close, ...buttons, ...(pager ? Object.values(pager) : [])];
  const bottom = Math.min(...rects.map((rect) => rect.y - rect.height / 2));
  return { page: shown, pages, first, title: WIDGET_PANEL_TITLE, close, buttons, pager, bottom };
}
