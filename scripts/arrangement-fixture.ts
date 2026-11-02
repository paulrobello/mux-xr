import * as THREE from 'three';
import type { PaneDescriptor, PanelArrangement, TerminalSurface } from '../src/contracts';
import { createDemoSurface } from '../src/demo';
import { createWorkspaceScene } from '../src/xr';
import { waitForLabelSync } from '../src/xr/labels';
import { measurePanelBounds } from '../src/xr/panel-bounds';

const patterns: readonly PanelArrangement[] = ['row', 'grid', 'arc', 'sphere'];
const host = document.querySelector<HTMLElement>('#fixture-host');
if (!host) throw new Error('fixture host is missing');

const paneSizes = [
  [80, 24],
  [120, 36],
  [160, 48],
  [52, 30],
  [100, 18],
  [64, 42],
] as const;
const manualScales = [1, 1.25, 0.3, 1.1, 0.8, 1.4] as const;
const panes: PaneDescriptor[] = Array.from({ length: paneSizes.length }, (_, index) => ({
  id: `fixture-pane-${index + 1}`,
  workspaceId: index < 3 ? 'fixture-alpha' : 'fixture-beta',
  workspaceName: index < 3 ? 'Fixture Alpha' : 'Fixture Beta',
  sessionId: `fixture-session-${index + 1}`,
  sessionName: index < 3 ? 'Development' : 'Operations',
  windowId: `fixture-window-${index + 1}`,
  windowName: index < 3 ? 'Build' : 'Agent logs',
  title: `Fixture panel ${index + 1}`,
  cols: paneSizes[index][0],
  rows: paneSizes[index][1],
}));

let resizeCalls = 0;
const surfaces: TerminalSurface[] = panes.map((pane) => {
  const surface = createDemoSurface(pane);
  const resizeGrid = surface.resizeGrid;
  surface.resizeGrid = (...args: Parameters<TerminalSurface['resizeGrid']>) => {
    resizeCalls += 1;
    return resizeGrid(...args);
  };
  return surface;
});

const scene = createWorkspaceScene(host, {
  selectPane: (id) => scene.selectTerminal(id),
  closePane: (id) => scene.removeTerminal(id),
  sendText: () => undefined,
  sendKey: () => undefined,
  runCommand: () => undefined,
  openCommands: () => scene.showInput('commands'),
  openKeyboard: () => scene.showInput('keyboard'),
});
scene.setAvailablePanes(panes);
surfaces.forEach((surface) => {
  scene.addTerminal(surface);
});
surfaces.forEach((surface, index) => {
  const panel = scene.scene.getObjectByName(`terminal-panel-${surface.pane.id}`);
  if (!panel) throw new Error(`fixture panel is missing: ${surface.pane.id}`);
  panel.scale.setScalar(manualScales[index]);
});
scene.selectTerminal(panes[0].id);
const originalCameraPosition = scene.camera.position.clone();
const originalCameraQuaternion = scene.camera.quaternion.clone();

const finite = (values: readonly number[]): boolean => values.every(Number.isFinite);
type ProjectedPoint = { x: number; y: number };
const projectedEnvelope = (root: THREE.Group): ProjectedPoint[] => {
  const bounds = measurePanelBounds(root);
  const center = bounds.center.clone().applyMatrix4(root.matrixWorld);
  const right = new THREE.Vector3(1, 0, 0).transformDirection(root.matrixWorld);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(root.matrixWorld);
  const halfWidth = bounds.size.width / 2;
  const halfHeight = bounds.size.height / 2;
  const corners = [
    center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, -halfHeight),
    center.clone().addScaledVector(right, halfWidth).addScaledVector(up, -halfHeight),
    center.clone().addScaledVector(right, halfWidth).addScaledVector(up, halfHeight),
    center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, halfHeight),
  ];
  return corners.map((corner) => {
    const cameraPoint = corner.applyMatrix4(scene.camera.matrixWorldInverse);
    if (cameraPoint.z >= 0) throw new Error('arrangement panel envelope is behind the viewer');
    return { x: cameraPoint.x / -cameraPoint.z, y: cameraPoint.y / -cameraPoint.z };
  });
};
const projectedPolygonsOverlap = (first: ProjectedPoint[], second: ProjectedPoint[]): boolean => {
  const polygons = [first, second];
  const axes: ProjectedPoint[] = [];
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      const edge = { x: end.x - start.x, y: end.y - start.y };
      const length = Math.hypot(edge.x, edge.y);
      if (length > 1e-9) axes.push({ x: -edge.y / length, y: edge.x / length });
    }
  }
  return axes.every((axis) => {
    const project = (polygon: ProjectedPoint[]): [number, number] => {
      const values = polygon.map((point) => point.x * axis.x + point.y * axis.y);
      return [Math.min(...values), Math.max(...values)];
    };
    const [firstMin, firstMax] = project(first);
    const [secondMin, secondMax] = project(second);
    return firstMin < secondMax && secondMin < firstMax;
  });
};
const assertPanelEnvelopesDoNotOverlap = (pattern: PanelArrangement): void => {
  scene.camera.updateMatrixWorld(true);
  const roots = surfaces.map((surface) => {
    const root = scene.scene.getObjectByName(`terminal-panel-${surface.pane.id}`);
    if (!(root instanceof THREE.Group))
      throw new Error(`fixture root is missing: ${surface.pane.id}`);
    root.updateWorldMatrix(true, false);
    return root;
  });
  const projected = roots.map(projectedEnvelope);
  for (let first = 0; first < roots.length; first += 1) {
    for (let second = first + 1; second < roots.length; second += 1) {
      if (projectedPolygonsOverlap(projected[first], projected[second]))
        throw new Error(`actual panel envelopes overlap after ${pattern}: ${first}/${second}`);
    }
  }
};
const snapshot = (): Record<string, unknown> => ({
  arrangement: scene.state.arrangement,
  selectedId: scene.state.selectedTerminalId,
  panels: surfaces.map((surface) => {
    const object = scene.scene.getObjectByName(`terminal-panel-${surface.pane.id}`);
    return {
      id: surface.pane.id,
      position: object?.position.toArray() ?? [],
      quaternion: object?.quaternion.toArray() ?? [],
      scale: object?.scale.x ?? Number.NaN,
      grid: `${surface.cols}x${surface.rows}`,
    };
  }),
  resizeCalls,
});

const clickHint = (pattern: PanelArrangement): boolean => {
  const hint = scene
    .getControlHints()
    .find((item) => item.inputAction === 'arrange' && item.label.toLowerCase() === pattern);
  if (!hint) return false;
  scene.canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: hint.clientX,
      clientY: hint.clientY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }),
  );
  return true;
};

const settleLabels = async (): Promise<void> => {
  const labels: Promise<void>[] = [];
  scene.scene.traverse((object) => labels.push(waitForLabelSync(object)));
  await Promise.all(labels);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const applyNativeArrangement = async (pattern: PanelArrangement): Promise<void> => {
  scene.camera.position.copy(originalCameraPosition);
  scene.camera.quaternion.copy(originalCameraQuaternion);
  scene.camera.updateMatrixWorld(true);
  scene.showInput('arrange');
  if (!clickHint(pattern)) throw new Error(`native arrange control not visible for ${pattern}`);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  scene.hideInput();
  scene.camera.position.set(0, 1.65, 3.6);
  scene.camera.lookAt(0, 1.4, -1.5);
  scene.camera.updateMatrixWorld(true);
  await settleLabels();
};

Object.assign(window, {
  __arrangementFixtureApply: applyNativeArrangement,
  __arrangementFixtureShowMenu: async (): Promise<void> => {
    scene.showInput('arrange');
    await settleLabels();
  },
});

const run = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settleLabels();
  const results: Record<string, unknown>[] = [];
  for (const pattern of patterns) {
    scene.camera.position.copy(originalCameraPosition);
    scene.camera.quaternion.copy(originalCameraQuaternion);
    scene.camera.updateMatrixWorld(true);
    const before = snapshot();
    scene.showInput('arrange');
    await settleLabels();
    const hintLabels = scene
      .getControlHints()
      .filter((item) => item.inputAction === 'arrange')
      .map((item) => item.label);
    if (!['Row', 'Grid', 'Arc', 'Sphere'].every((label) => hintLabels.includes(label)))
      throw new Error(`native Arrange menu labels incomplete: ${hintLabels.join(', ')}`);
    if (!clickHint(pattern)) throw new Error(`native arrange control not visible for ${pattern}`);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    scene.hideInput();
    const after = snapshot();
    const panels = after.panels as Array<{
      id: string;
      position: number[];
      quaternion: number[];
      scale: number;
      grid: string;
    }>;
    if (after.arrangement !== pattern)
      throw new Error(`native arrangement did not apply ${pattern}`);
    if (after.selectedId !== panes[0].id)
      throw new Error(`native arrangement changed selection for ${pattern}`);
    const beforePanels = before.panels as Array<{ id: string; scale: number }>;
    if (
      panels.map((panel) => panel.id).join('|') !== beforePanels.map((panel) => panel.id).join('|')
    )
      throw new Error(`native arrangement changed panel IDs for ${pattern}`);
    if (panels.some((panel, index) => panel.scale !== beforePanels[index]?.scale))
      throw new Error(`native arrangement changed panel scale for ${pattern}`);
    if (
      panels.some(
        (panel, index) => panel.grid !== (before.panels as Array<{ grid: string }>)[index]?.grid,
      )
    )
      throw new Error(`native arrangement changed terminal grid for ${pattern}`);
    assertPanelEnvelopesDoNotOverlap(pattern);
    scene.showInput('terminal');
    await settleLabels();
    if (scene.state.inputTargetId !== panes[0].id)
      throw new Error(`native arrangement changed input target for ${pattern}`);
    if (!scene.getControlHints().some((hint) => hint.inputAction === 'gridApply'))
      throw new Error(`terminal grid controls missing after ${pattern}`);
    scene.hideInput();
    if (
      !panels.every(
        (panel) =>
          finite(panel.position) && finite(panel.quaternion) && Number.isFinite(panel.scale),
      )
    )
      throw new Error(`non-finite pose after ${pattern}`);
    results.push({
      pattern,
      before,
      after,
      hintLabels,
      envelopesChecked: true,
      inputTargetAndGridChecked: true,
    });
  }
  const report = {
    kind: 'arrangement-fixture',
    patterns,
    paneIds: panes.map((pane) => pane.id),
    paneSizes,
    manualScales,
    selectedId: scene.state.selectedTerminalId,
    results,
    resizeCalls,
    renderer: (() => {
      const context = scene.canvas.getContext('webgl2') ?? scene.canvas.getContext('webgl');
      const extension = context?.getExtension('WEBGL_debug_renderer_info');
      return extension ? context?.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    })(),
    finiteVector: new THREE.Vector3().toArray(),
    cameraCapture: 'overview only, not headset viewpoint',
  };
  Object.assign(window, { __arrangementFixture: report, __arrangementFixtureReady: true });
  const output = document.querySelector<HTMLElement>('#fixture-result');
  if (output) output.textContent = JSON.stringify(report);
};

void run().catch((error: unknown) => {
  Object.assign(window, {
    __arrangementFixtureError: error instanceof Error ? error.message : String(error),
  });
  throw error;
});
