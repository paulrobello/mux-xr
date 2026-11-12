import { describe, expect, it } from 'vitest';
import { layoutWidgetPanel, type PanelRect } from '../src/xr/widget-panel-layout';

const overlaps = (a: PanelRect, b: PanelRect): boolean =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-9 &&
  Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 1e-9;

// Spawn poses from scene.ts: the input panel at eye + (0, -0.2, -1.15) scaled 0.38, the XR HUD at
// eye + (0, -0.65, -1.35) scaled 0.62. HUD-local points project through the eye onto the panel plane.
const projectHud = (rect: PanelRect): PanelRect => {
  const depthRatio = 1.15 / 1.35;
  const y = ((-0.65 + 0.62 * rect.y) * depthRatio + 0.2) / 0.38;
  const scale = (0.62 * depthRatio) / 0.38;
  return { x: rect.x * scale, y, width: rect.width * scale, height: rect.height * scale };
};
// The bar with Exit, then the clickable overlay lines above it: notice, its dismiss, Reload.
const hudBar = projectHud({ x: 0, y: 0, width: 1.6, height: 0.09 });
const hudBarTopInPanel = hudBar.y + hudBar.height / 2;
const clickableOverlays = [
  projectHud({ x: 0, y: 0.3, width: 1.4, height: 0.075 }),
  projectHud({ x: 0.78, y: 0.3, width: 0.075, height: 0.075 }),
  projectHud({ x: 0, y: 0.16, width: 0.42, height: 0.09 }),
];
const overlayTopInPanel = Math.max(...clickableOverlays.map((rect) => rect.y + rect.height / 2));
const BACKDROP_MARGIN = 0.06;

describe('Widgets panel layout', () => {
  for (const count of [7, 9, 10, 11, 12, 15, 30]) {
    it(`keeps every control apart and clear of the HUD bar for ${count} entries`, () => {
      const first = layoutWidgetPanel(count);
      let laidOut = 0;
      for (let page = 0; page < first.pages; page++) {
        const layout = layoutWidgetPanel(count, page);
        expect(layout.first).toBe(laidOut);
        laidOut += layout.buttons.length;
        const rects = [
          layout.title,
          layout.close,
          ...layout.buttons,
          ...(layout.pager ? Object.values(layout.pager) : []),
        ];
        for (const [i, a] of rects.entries())
          for (const b of rects.slice(i + 1))
            expect(overlaps(a, b), JSON.stringify([a, b])).toBe(false);
        for (const rect of [layout.close, ...layout.buttons]) {
          expect(rect.width).toBeGreaterThanOrEqual(0.12);
          expect(rect.height).toBeGreaterThanOrEqual(0.09);
        }
        for (const button of layout.buttons) expect(button.height).toBeGreaterThanOrEqual(0.14);
        // Close sits in the header row, above every widget button.
        expect(layout.close.y).toBeCloseTo(layout.title.y);
        for (const button of layout.buttons)
          expect(button.y + button.height / 2).toBeLessThan(
            layout.close.y - layout.close.height / 2,
          );
        expect(layout.bottom - BACKDROP_MARGIN).toBeGreaterThan(hudBarTopInPanel);
        expect(layout.bottom - BACKDROP_MARGIN).toBeGreaterThanOrEqual(overlayTopInPanel + 0.05);
        for (const rect of rects)
          for (const overlay of clickableOverlays) expect(overlaps(rect, overlay)).toBe(false);
      }
      expect(laidOut).toBe(count);
    });
  }

  it('fits up to 10 entries on one page and pages beyond that', () => {
    expect(layoutWidgetPanel(9).pages).toBe(1);
    expect(layoutWidgetPanel(10).pages).toBe(1);
    expect(layoutWidgetPanel(10).pager).toBeNull();
    const paged = layoutWidgetPanel(12, 1);
    expect(paged.pages).toBe(2);
    expect(paged.buttons).toHaveLength(4);
    expect(paged.pager).not.toBeNull();
    expect(layoutWidgetPanel(12, 9).page).toBe(1);
    expect(layoutWidgetPanel(12, -3).page).toBe(0);
  });
});
