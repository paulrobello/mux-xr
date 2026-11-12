import { mkdir, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { chromium, type Page, type WebSocketRoute } from 'playwright';
import type * as THREE from 'three';
import type { TerminalDamageStats } from '../src/contracts';
import {
  ClientMessageSchema,
  ConnectedSchema,
  DamageRangeSchema,
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
  OutputSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { prepareQuestFixture } from './prepare-quest-fixture';

const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';
const BASELINE = process.env.MUX_XR_BASELINE === '1' || process.argv.includes('--baseline');
const COUNTS = (process.env.MUX_XR_COUNTS ?? '6,12,18').split(',').map(Number);
const BACKGROUND = process.env.MUX_XR_BACKGROUND ?? 'black';
const GAZE_SWEEP = process.env.MUX_XR_GAZE_SWEEP === '1';
// Damage arm: attach the rows each chunk changes, as a core 0.77+ mux streamer does.
const DAMAGE = process.env.MUX_XR_DAMAGE === '1';
const WORKLOAD = process.env.MUX_XR_WORKLOAD ?? 'mixed';
// Gauge arm: restore the performance gauge widget before load, to measure its frame cost.
const PERF_GAUGE = process.env.MUX_XR_PERF_GAUGE === '1';
const damageGenerations = new Map<string, bigint>();
const PANE_IDS = Array.from({ length: 18 }, (_, index) => `%${index + 1}`);
const COLS = 149;
const ROWS = 54;

type WireState = {
  routes: Map<string, WebSocketRoute>;
  socketByPane: Map<string, number>;
  frames: Array<{ paneId: string; kind: string }>;
  serverFrames: Array<{ paneId: string; kind: string }>;
  outputPackets: number;
  outputBytes: number;
  sendTimes: number[];
  errors: string[];
};

type BrowserMetrics = {
  frameCpuMs: number[];
  frameTimes: number[];
  fillTextCount: number;
  imageDataBytes: number;
  textureUploadBytes: number;
  textureUploadCount: number;
};
type CapacityStream = {
  id: string;
  status: string;
  cols?: number;
  rows?: number;
  renderQuality?: string;
};
type AppState = {
  attached: string[];
  selectedId: string | null;
  streams: CapacityStream[];
  scene: { xrMode: string };
};
type FixtureWindow = Window & {
  __capacityMetrics: BrowserMetrics;
  __capacityResetMetrics: () => void;
  __questScene: THREE.Scene;
  __questThree: typeof THREE;
  __questControllers: THREE.Group[];
  __questCamera: THREE.PerspectiveCamera;
  __questRenderer: THREE.WebGLRenderer;
  __muxXR: { getState(): AppState; selectPane(id: string): void };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function wireFrame(message: ServerMessage): Buffer {
  return Buffer.concat([Buffer.from([0]), Buffer.from(toBinary(ServerMessageSchema, message))]);
}

function snapshotFrame(count: number): Buffer {
  const panes = PANE_IDS.slice(0, count).map((id, index) =>
    create(MuxTreePaneSchema, {
      id,
      title: `Capacity pane ${index + 1}`,
      active: index === 0,
      cols: COLS,
      rows: ROWS,
      x: (index % 3) * 50,
      y: Math.floor(index / 3) * 18,
    }),
  );
  const snapshot = create(MuxTreeSnapshotSchema, {
    workspaces: [
      create(MuxTreeWorkspaceSchema, {
        id: 'workspace-capacity',
        name: 'Capacity workload',
        active: true,
        sessions: [
          create(MuxTreeSessionSchema, {
            id: '$capacity',
            name: 'Terminal workload',
            active: true,
            windows: [
              create(MuxTreeWindowSchema, {
                id: '@capacity',
                name: 'Dense panes',
                active: true,
                layout: `${COLS}x${ROWS},0,0,0,0`,
                panes,
              }),
            ],
          }),
        ],
      }),
    ],
  });
  return wireFrame(
    create(ServerMessageSchema, { message: { case: 'muxTreeSnapshot', value: snapshot } }),
  );
}

function denseScreen(paneId: string): Uint8Array {
  const rows: string[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    const color = `\x1b[38;2;${40 + ((row * 17) % 190)};${80 + ((row * 11) % 150)};${120 + ((row * 7) % 120)}m`;
    const text = `${paneId} ${String(row + 1).padStart(2, '0')} ${'static full-color terminal workload '.repeat(8)}`;
    rows.push(`${color}${text.slice(0, COLS)}\x1b[0m\r\n`);
  }
  // A log pane starts with xterm's 1000-line scrollback full, so appended lines trim history
  // instead of moving baseY, which would force every paint to full-scan as a local scroll.
  const history = WORKLOAD === 'log' ? 'history\r\n'.repeat(1_000 + ROWS) : '';
  return new TextEncoder().encode(`${history}\x1b[2J\x1b[H${rows.join('')}`);
}

type PainterWindow = { id: string; damage: TerminalDamageStats | null };

async function painterStats(page: Page): Promise<PainterWindow[]> {
  return await page.evaluate(() =>
    (
      window as unknown as {
        __muxXR: { getState: () => { streams: PainterWindow[] } };
      }
    ).__muxXR
      .getState()
      .streams.map((stream) => ({ id: stream.id, damage: stream.damage })),
  );
}

function painterDelta(start: PainterWindow[], end: PainterWindow[]): PainterWindow[] {
  return end.map(({ id, damage }) => {
    const before = start.find((stream) => stream.id === id)?.damage;
    if (!damage || !before) return { id, damage };
    const reasons: Record<string, number> = {};
    for (const [reason, value] of Object.entries(damage.fullScanReasons))
      reasons[reason] = value - (before.fullScanReasons[reason] ?? 0);
    return {
      id,
      damage: {
        damageScans: damage.damageScans - before.damageScans,
        fullScans: damage.fullScans - before.fullScans,
        rowsScanned: damage.rowsScanned - before.rowsScanned,
        rejectedHints: damage.rejectedHints - before.rejectedHints,
        auditMisses: damage.auditMisses - before.auditMisses,
        fullScanReasons: reasons,
      },
    };
  });
}

function connectedFrame(paneId: string): Buffer {
  return wireFrame(
    create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, {
          cols: COLS,
          rows: ROWS,
          sessionId: `pane-${paneId.slice(1)}`,
          initialScreen: denseScreen(paneId),
        }),
      },
    }),
  );
}

function outputFrame(paneId: string, tick: number): Buffer {
  const log = WORKLOAD === 'log' || (WORKLOAD === 'mixed' && paneId === '%1' && tick % 10 === 0);
  const line = log
    ? `\x1b[38;2;255;190;70m${paneId} agent log tick=${tick} cpu queue stable\x1b[0m\r\n`
    : `\r\x1b[2K\x1b[38;2;90;220;255m${paneId} agent spinner ${'|/-\\'[tick % 4]}\x1b[0m`;
  // The seed leaves the cursor on the last row: a spinner rewrites that row, a log line scrolls.
  const generation = (damageGenerations.get(paneId) ?? 0n) + 1n;
  damageGenerations.set(paneId, generation);
  const damage = DAMAGE
    ? {
        damageGeneration: generation,
        damage: [create(DamageRangeSchema, { startRow: log ? 0 : ROWS - 1, endRow: ROWS - 1 })],
      }
    : {};
  return wireFrame(
    create(ServerMessageSchema, {
      message: {
        case: 'output',
        value: create(OutputSchema, { data: new TextEncoder().encode(line), ...damage }),
      },
    }),
  );
}

function decodeClient(message: string | Buffer): string {
  const bytes = Buffer.isBuffer(message) ? message : Buffer.from(message, 'binary');
  return (
    fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1))).message.case ?? 'unknown'
  );
}

async function waitFor(predicate: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function installSocketFixture(page: Page, state: WireState, count: number): Promise<void> {
  await page.routeWebSocket('**/ws**', (ws: WebSocketRoute) => {
    const session = new URL(ws.url()).searchParams.get('session');
    const paneId = session?.replace(/^pane-/, '%') ?? 'metadata';
    state.routes.set(paneId, ws);
    state.socketByPane.set(paneId, (state.socketByPane.get(paneId) ?? 0) + 1);
    ws.onMessage((message) => {
      const kind = decodeClient(message);
      state.frames.push({ paneId, kind });
      if (kind === 'muxTreeRequest') {
        state.serverFrames.push({ paneId, kind: 'muxTreeSnapshot' });
        ws.send(snapshotFrame(count));
      }
    });
    if (session) {
      state.serverFrames.push({ paneId, kind: 'connected' });
      ws.send(connectedFrame(paneId));
    }
  });
}

async function installInstrumentation(page: Page): Promise<void> {
  if (PERF_GAUGE)
    await page.addInitScript(() => {
      const pose = { position: [-1, 1.75, -1], quaternion: [0, 0, 0, 1], scale: 0.9 };
      localStorage.setItem(
        'mux-xr:widget-poses:v2',
        JSON.stringify({ version: 2, poses: { 'perf-gauge': pose } }),
      );
    });
  await page.addInitScript(() => {
    const w = window as unknown as {
      __capacityMetrics: BrowserMetrics;
      __questAfterFrame?: (time: number, cpuMs: number) => void;
    };
    w.__capacityMetrics = {
      frameCpuMs: [],
      frameTimes: [],
      fillTextCount: 0,
      imageDataBytes: 0,
      textureUploadBytes: 0,
      textureUploadCount: 0,
    };
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      ...args: Parameters<typeof originalFillText>
    ) {
      w.__capacityMetrics.fillTextCount += 1;
      return originalFillText.apply(this, args);
    };
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (
      ...args: Parameters<typeof originalGetImageData>
    ) {
      const image = originalGetImageData.apply(this, args);
      w.__capacityMetrics.imageDataBytes += image.data.byteLength;
      return image;
    };
    const formats: Record<number, number> = {
      6403: 1,
      6406: 1,
      6409: 1,
      6410: 2,
      33319: 2,
      6407: 3,
      6408: 4,
    };
    const formatBytes = (format: number): number => formats[format] ?? 4;
    const uploadBytes = (args: unknown[], sub: boolean): number => {
      if (!sub && args.length >= 9 && args[8] === null) return 0;
      if ((!sub && args.length === 6) || (sub && args.length === 7)) {
        const source = args[args.length - 1] as { width?: number; height?: number } | null;
        const format = Number(args[sub ? 4 : 3]);
        return source?.width && source.height
          ? source.width * source.height * formatBytes(format)
          : 0;
      }
      const width = Number(args[sub ? 4 : 3]);
      const height = Number(args[sub ? 5 : 4]);
      const format = Number(args[sub ? 6 : 6]);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
        return width * height * formatBytes(format);
      const source = args[args.length - 1] as { width?: number; height?: number } | null;
      return source?.width && source.height
        ? source.width * source.height * formatBytes(format)
        : 0;
    };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const original = proto.texImage2D;
      proto.texImage2D = function (
        this: WebGLRenderingContext | WebGL2RenderingContext,
        ...args: unknown[]
      ) {
        w.__capacityMetrics.textureUploadCount += 1;
        w.__capacityMetrics.textureUploadBytes += uploadBytes(args, false);
        return Reflect.apply(original, this, args as never);
      } as typeof proto.texImage2D;
      const subImage = proto.texSubImage2D;
      proto.texSubImage2D = function (
        this: WebGLRenderingContext | WebGL2RenderingContext,
        ...args: unknown[]
      ) {
        w.__capacityMetrics.textureUploadCount += 1;
        w.__capacityMetrics.textureUploadBytes += uploadBytes(args, true);
        return Reflect.apply(subImage, this, args as never);
      } as typeof proto.texSubImage2D;
    }
    w.__questAfterFrame = (time, cpuMs) => {
      w.__capacityMetrics.frameTimes.push(time);
      w.__capacityMetrics.frameCpuMs.push(cpuMs);
    };
    (w as unknown as { __capacityResetMetrics: () => void }).__capacityResetMetrics = () => {
      w.__capacityMetrics.frameCpuMs = [];
      w.__capacityMetrics.frameTimes = [];
      w.__capacityMetrics.fillTextCount = 0;
      w.__capacityMetrics.imageDataBytes = 0;
      w.__capacityMetrics.textureUploadBytes = 0;
      w.__capacityMetrics.textureUploadCount = 0;
    };
  });
}

async function prepareScene(page: Page, count: number): Promise<Record<string, unknown>> {
  await page.goto(`${BASE_URL}/__quest-controls.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  await page.locator('#endpoint').fill(`${BASE_URL}/stream`);
  await page.locator('[data-action="connect"]').click();
  await waitFor(
    async () => (await page.locator('[data-pane]').count()) === count,
    'metadata pane count mismatch',
  );
  await waitFor(async () => {
    const state = await page.evaluate(() =>
      (window as unknown as { __muxXR: { getState(): { attached: string[] } } }).__muxXR.getState(),
    );
    return state.attached.length === Math.min(2, count);
  }, 'autoattach did not attach initial panes');
  await page.evaluate(
    (ids) => {
      const api = (window as unknown as { __muxXR: { selectPane(id: string): void } }).__muxXR;
      for (const id of ids) api.selectPane(id);
    },
    PANE_IDS.slice(0, count),
  );
  await waitFor(async () => {
    const state = await page.evaluate(() =>
      (
        window as unknown as { __muxXR: { getState(): { streams: Array<{ status: string }> } } }
      ).__muxXR.getState(),
    );
    return (
      state.streams.length === count &&
      state.streams.every((stream) => stream.status === 'connected')
    );
  }, 'all streams did not connect');
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-background]').selectOption(BACKGROUND);
  await page.locator('[data-action="close-settings"]').click();
  await page.locator('[data-action="keyboard"]').click();
  const gaze = page.locator('[data-gaze-input]');
  if (await gaze.isChecked()) await gaze.uncheck();
  await page.locator('[data-action="close-drawer"]').click();
  await page.locator('[data-action="xr"]').click();
  await waitFor(async () => {
    const state = await page.evaluate(() =>
      (
        window as unknown as { __muxXR: { getState(): { scene: { xrMode: string } } } }
      ).__muxXR.getState(),
    );
    return state.scene.xrMode === 'vr';
  }, 'XR mode did not start');
  const arrangement = await page.evaluate(
    (ids) => {
      const w = window as unknown as {
        __questScene: THREE.Scene;
        __questThree: typeof THREE;
        __questControllers: THREE.Group[];
        __questCamera: THREE.PerspectiveCamera;
        __muxXR: FixtureWindow['__muxXR'];
      };
      const panels = new Map<string, THREE.Object3D>();
      w.__questScene.traverse((object) => {
        const id = object.userData?.terminalId;
        if (typeof id === 'string' && ids.includes(id) && object.name.startsWith('terminal-panel-'))
          panels.set(id, object);
      });
      const points = [
        [0, 1.6, -2],
        [2.5, 1.8, -3],
        [-3.5, 2.0, -6],
        [-9, 2.2, -10],
      ];
      for (const [index, id] of ids.entries()) {
        const panel = panels.get(id);
        if (!panel) throw new Error(`scene panel missing: ${id}`);
        const point = points[index] ?? [
          Math.sin(index) * 5,
          1.7 + (index % 3) * 0.5,
          -10 - (index % 4) * 2,
        ];
        panel.position.set(point[0], point[1], point[2]);
        panel.scale.setScalar(1);
        panel.lookAt(0, 1.6, 0);
      }
      const pad = {
        buttons: Array.from({ length: 6 }, () => ({ pressed: false })),
        axes: [0, 0, 0, 0],
      };
      for (const [index, controller] of w.__questControllers.entries()) {
        controller.dispatchEvent({
          type: 'connected',
          data: { gamepad: pad, handedness: index === 0 ? 'left' : 'right' },
        } as never);
        const panel = panels.get(ids[index % ids.length]);
        if (!panel) throw new Error('controller target panel missing');
        const target = panel.getWorldPosition(new w.__questThree.Vector3());
        controller.position.copy(target).add(new w.__questThree.Vector3(0, 0, 0.4));
        controller.lookAt(target);
        controller.dispatchEvent({
          type: 'selectstart',
          data: { gamepad: pad, handedness: index === 0 ? 'left' : 'right' },
        } as never);
        controller.dispatchEvent({
          type: 'selectend',
          data: { gamepad: pad, handedness: index === 0 ? 'left' : 'right' },
        } as never);
      }
      w.__muxXR.selectPane('%1');
      return {
        attached: w.__muxXR.getState().attached,
        selectedId: w.__muxXR.getState().selectedId,
        keyboardOpen: false,
      };
    },
    PANE_IDS.slice(0, count),
  );
  const verification = await page.evaluate(
    ({ ids, cols, rows }) => {
      const state = (window as unknown as FixtureWindow).__muxXR.getState();
      return {
        attached: ids.every((id: string) => state.attached.includes(id)),
        connected:
          state.streams.length === ids.length &&
          state.streams.every((stream) => stream.status === 'connected'),
        grid: state.streams.every((stream) => stream.cols === cols && stream.rows === rows),
        selectedId: state.selectedId,
      };
    },
    { ids: PANE_IDS.slice(0, count), cols: COLS, rows: ROWS },
  );
  assert(verification.attached, 'scene verification did not attach every pane');
  assert(verification.connected, 'scene verification did not connect every pane');
  assert(verification.grid, 'scene verification grid dimensions changed');
  assert(verification.selectedId === '%1', 'controller picking changed the selected pane');
  return { ...arrangement, verification };
}

async function measure(
  page: Page,
  state: WireState,
  count: number,
): Promise<Record<string, unknown>> {
  await page.waitForTimeout(2_000);
  const before = loadavg();
  assert(before[0] <= 15, `pre-run load average exceeded 15: ${before[0]}`);
  await page.evaluate(() =>
    (window as unknown as { __capacityResetMetrics: () => void }).__capacityResetMetrics(),
  );
  const painterStart = await painterStats(page);
  const started = Date.now();
  const timers = PANE_IDS.slice(0, count).map((paneId, index) => {
    let tick = index;
    return setInterval(() => {
      const route = state.routes.get(paneId);
      if (!route) return;
      const payload = outputFrame(paneId, tick++);
      route.send(payload);
      state.serverFrames.push({ paneId, kind: 'output' });
      state.outputPackets += 1;
      state.outputBytes += payload.byteLength;
      state.sendTimes.push(Date.now());
    }, 100);
  });
  try {
    if (GAZE_SWEEP) {
      for (let step = 0; step < 16; step += 1) {
        await page.evaluate(
          (id) => {
            const w = window as unknown as FixtureWindow;
            const screen = w.__questScene
              .getObjectByName(`terminal-panel-${id}`)
              ?.getObjectByName('terminal-surface');
            if (!screen) throw new Error(`Missing gaze-sweep screen: ${id}`);
            w.__questCamera.lookAt(screen.getWorldPosition(new w.__questThree.Vector3()));
            w.__questCamera.updateMatrixWorld(true);
          },
          PANE_IDS[step % count],
        );
        await page.waitForTimeout(500);
      }
    } else await page.waitForTimeout(8_000);
  } finally {
    timers.forEach(clearInterval);
  }
  const painterWindow = painterDelta(painterStart, await painterStats(page));
  if (DAMAGE)
    for (const { id, damage } of painterWindow)
      assert(damage && damage.damageScans > 0, `${id} never painted from damage hints`);

  const after = loadavg();
  const metrics = await page.evaluate(() => {
    const w = window as unknown as {
      __capacityMetrics: BrowserMetrics;
      __questRenderer: THREE.WebGLRenderer;
      __questCamera: THREE.PerspectiveCamera;
      __questScene: THREE.Scene;
      __muxXR: FixtureWindow['__muxXR'];
    };
    const gl = w.__questRenderer.getContext();
    w.__questRenderer.render(w.__questScene, w.__questCamera);
    const width = Math.min(128, gl.drawingBufferWidth);
    const height = Math.min(128, gl.drawingBufferHeight);
    const x = Math.max(0, Math.floor((gl.drawingBufferWidth - width) / 2));
    const y = Math.max(0, Math.floor((gl.drawingBufferHeight - height) / 2));
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlack = 0;
    let digest = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== 0 || pixels[index + 1] !== 0 || pixels[index + 2] !== 0) nonBlack += 1;
      digest = Math.imul(digest ^ pixels[index], 16777619);
      digest = Math.imul(digest ^ pixels[index + 1], 16777619);
      digest = Math.imul(digest ^ pixels[index + 2], 16777619);
    }
    const info = w.__questRenderer.info;
    const state = w.__muxXR.getState();
    return {
      ...w.__capacityMetrics,
      nonBlackPixels: nonBlack,
      pixelDigest: digest >>> 0,
      renderer: (() => {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      })(),
      rendererInfo: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? 0,
        textures: info.memory?.textures ?? 0,
      },
      terminalCanvasBytes: [
        ...document.querySelectorAll<HTMLCanvasElement>('canvas[aria-label$="terminal output"]'),
      ].reduce((total, canvas) => total + canvas.width * canvas.height * 4, 0),
      streams: state.streams,
      selectedId: state.selectedId,
    };
  });
  const times = metrics.frameTimes
    .slice(1)
    .map((time, index) => time - metrics.frameTimes[index])
    .sort((a, b) => a - b);
  const cpu = metrics.frameCpuMs.slice().sort((a, b) => a - b);
  const percentile = (values: number[], p: number): number =>
    values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
  const farPane = await page.evaluate(async () => {
    const w = window as unknown as {
      __questCamera: THREE.PerspectiveCamera;
      __questScene: THREE.Scene;
      __questThree: typeof THREE;
      __muxXR: FixtureWindow['__muxXR'];
    };
    // The scene's gaze ray promotes the first terminal screen it hits, so the probe must be a
    // far pane no other pane hides from the head: the farthest unoccluded non-selected one.
    const three = w.__questThree;
    const eye = w.__questCamera.getWorldPosition(new three.Vector3());
    const caster = new three.Raycaster();
    caster.far = w.__questCamera.far;
    // Matches the scene's isControlVisible: every ancestor visible and none focus-hidden.
    const shown = (object: THREE.Object3D): boolean => {
      for (let current: THREE.Object3D | null = object; current; current = current.parent)
        if (!current.visible || current.userData.focusHidden) return false;
      return true;
    };
    const firstScreen = (target: THREE.Vector3) => {
      caster.set(eye, target.clone().sub(eye).normalize());
      const hit = caster
        .intersectObject(w.__questScene, true)
        .find((entry) => entry.object.name === 'terminal-surface' && shown(entry.object));
      return hit ? { id: String(hit.object.parent?.userData.terminalId) } : null;
    };
    const selectedId = w.__muxXR.getState().selectedId;
    const candidates = w.__muxXR
      .getState()
      .streams.map((stream) => {
        const root = w.__questScene.getObjectByName(`terminal-panel-${stream.id}`);
        const screen = root?.getObjectByName('terminal-surface');
        if (!root || !screen || stream.id === selectedId || !shown(screen)) return null;
        // A partly hidden pane is still gazeable on its visible part, so sample its screen.
        const mesh = screen as THREE.Mesh;
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox as THREE.Box3;
        let point: THREE.Vector3 | null = null;
        for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9])
          for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
            if (point) break;
            const local = new three.Vector3(
              box.min.x + (box.max.x - box.min.x) * fx,
              box.min.y + (box.max.y - box.min.y) * fy,
              (box.min.z + box.max.z) / 2,
            );
            const candidate = screen.localToWorld(local);
            if (firstScreen(candidate)?.id === stream.id) point = candidate;
          }
        if (!point) return null;
        // The scene's LOD distance: panel origin to eye over the panel's world scale.
        const scale = Math.max(0.01, Math.abs(root.getWorldScale(new three.Vector3()).y));
        const distance = root.getWorldPosition(new three.Vector3()).distanceTo(eye) / scale;
        return { id: stream.id, point, distance };
      })
      .filter((entry) => entry !== null)
      .sort((a, b) => b.distance - a.distance);
    const far = candidates[0];
    if (!far) return { selectedId, visible: false, candidates: 0 };
    w.__questCamera.lookAt(far.point);
    w.__questCamera.updateMatrixWorld(true);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const renderer = (window as unknown as FixtureWindow).__questRenderer;
    renderer.render(w.__questScene, w.__questCamera);
    const gl = renderer.getContext();
    const width = Math.min(64, gl.drawingBufferWidth);
    const height = Math.min(64, gl.drawingBufferHeight);
    const x = Math.max(0, Math.floor((gl.drawingBufferWidth - width) / 2));
    const y = Math.max(0, Math.floor((gl.drawingBufferHeight - height) / 2));
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const quality = (id: string) =>
      w.__muxXR.getState().streams.find((stream) => stream.id === id)?.renderQuality;
    // Gaze promotes one pane: other far panes must stay below full, or LOD is not active at all.
    const otherFar = candidates
      .slice(1)
      .filter((entry) => entry.distance > 3.9)
      .map((entry) => ({ id: entry.id, renderQuality: quality(entry.id) }));
    return {
      presenting: (window as unknown as FixtureWindow).__questRenderer.xr.isPresenting,
      otherFar,
      selectedId: w.__muxXR.getState().selectedId,
      visible: true,
      paneId: far.id,
      distance: Number(far.distance.toFixed(2)),
      candidates: candidates.length,
      renderQuality: w.__muxXR.getState().streams.find((stream) => stream.id === far.id)
        ?.renderQuality,
      nonBlackPixels: pixels.some((value, index) => index % 4 !== 3 && value !== 0),
    };
  });
  assert(farPane.visible, 'no unoccluded non-selected pane to gaze at');
  assert(
    farPane.presenting,
    `far-pane probe ran outside an XR session: ${JSON.stringify(farPane)}`,
  );
  assert(
    (farPane.otherFar ?? []).every((entry) => entry.renderQuality !== 'full'),
    `a far pane the probe did not gaze at rendered full: ${JSON.stringify(farPane)}`,
  );
  // Beyond 3.9 m distance LOD alone would leave the pane medium, so full proves gaze promotion.
  // With 6 panes the farthest unoccluded non-selected pane sits inside that radius, so there is
  // nothing to prove there.
  const gazeProbe = (farPane.distance ?? 0) > 3.9;
  assert(
    gazeProbe || count < 12,
    `nearest-visible far pane is within full-quality range: ${JSON.stringify(farPane)}`,
  );
  assert(farPane.selectedId === metrics.selectedId, 'far-pane gaze retargeted selected pane');
  assert(
    !gazeProbe || farPane.renderQuality === 'full',
    `far pane was not promoted to full quality: ${JSON.stringify(farPane)}`,
  );
  assert(farPane.nonBlackPixels, 'far pane center sample remained black');
  const perfGauge = await page.evaluate(() => {
    const scene = (window as unknown as FixtureWindow).__questScene;
    return {
      present: Boolean(scene.getObjectByName('perf-gauge-fps')),
      fps: scene.getObjectByName('perf-gauge-fps')?.userData.labelText ?? null,
      worst: scene.getObjectByName('perf-gauge-worst')?.userData.labelText ?? null,
      panes: scene.getObjectByName('perf-gauge-panes')?.userData.labelText ?? null,
    };
  });
  assert(perfGauge.present === PERF_GAUGE, `perf gauge arm mismatch: ${JSON.stringify(perfGauge)}`);
  return {
    count,
    perfGauge,
    painterWindow,
    durationMs: Date.now() - started,
    hostLoad: { before, after, valid: before[0] <= 15 && after[0] <= 15 },
    outputPackets: state.outputPackets,
    outputBytes: state.outputBytes,
    serverFrameCounts: Object.fromEntries(
      [...new Set(state.serverFrames.map((frame) => frame.kind))].map((kind) => [
        kind,
        state.serverFrames.filter((frame) => frame.kind === kind).length,
      ]),
    ),
    sendIntervalMs: percentile(
      state.sendTimes
        .slice(1)
        .map((time, index) => time - state.sendTimes[index])
        .sort((a, b) => a - b),
      0.95,
    ),
    metrics: {
      ...metrics,
      frameCpuMeanMs: cpu.reduce((sum, value) => sum + value, 0) / Math.max(1, cpu.length),
      frameCpuP50Ms: percentile(cpu, 0.5),
      frameCpuP95Ms: percentile(cpu, 0.95),
      pacingP95Ms: percentile(times, 0.95),
    },
    farPane: { ...farPane, gazeProbe },
    errors: state.errors,
  };
}

async function runCount(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  count: number,
): Promise<Record<string, unknown>> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const state: WireState = {
    routes: new Map(),
    socketByPane: new Map(),
    frames: [],
    serverFrames: [],
    outputPackets: 0,
    outputBytes: 0,
    sendTimes: [],
    errors: [],
  };
  page.on('pageerror', (error) => state.errors.push(error.message));
  await installInstrumentation(page);
  await installSocketFixture(page, state, count);
  try {
    const scene = await prepareScene(page, count);
    const result = await measure(page, state, count);
    return {
      ...result,
      scene,
      connectedSockets: Object.fromEntries(state.socketByPane),
      baseline: BASELINE,
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  assert(
    BASE_URL && TEST_ROOT && PRIVATE_TEST,
    'MUX_XR_BASE_URL, MUX_XR_TEST_ROOT, and MUX_XR_PRIVATE_TEST=1 are required',
  );
  assert(
    ['127.0.0.1', 'localhost', '::1'].includes(new URL(BASE_URL).hostname),
    'MUX_XR_BASE_URL must be loopback',
  );
  assert(
    COUNTS.length > 0 && COUNTS.every((count) => count === 6 || count === 12 || count === 18),
    `MUX_XR_COUNTS must contain only 6,12,18: ${COUNTS.join(',')}`,
  );
  prepareQuestFixture(TEST_ROOT);
  const evidence = join(process.cwd(), '.local', 'evidence');
  await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const results: Record<string, unknown>[] = [];
    for (const count of COUNTS) results.push(await runCount(browser, count));
    const report = {
      kind: 'terminal-capacity-check',
      baseline: BASELINE,
      baseUrl: new URL(BASE_URL).origin,
      testRoot: TEST_ROOT,
      background: BACKGROUND,
      damage: DAMAGE,
      perfGauge: PERF_GAUGE,
      workloadKind: WORKLOAD,
      counts: COUNTS,
      viewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
      grid: { cols: COLS, rows: ROWS },
      workload: {
        panes:
          WORKLOAD === 'spinner'
            ? 'every pane rewrites its spinner row at 10Hz'
            : WORKLOAD === 'log'
              ? 'every pane appends a scrolling log line at 10Hz'
              : 'one line at 10Hz plus appended log line at 1Hz',
        durationMs: 8_000,
        gazeSweep: GAZE_SWEEP,
      },
      results,
    };
    const arm = `${BASELINE ? 'baseline' : 'candidate'}-${WORKLOAD}${DAMAGE ? '-damage' : ''}${PERF_GAUGE ? '-perf-gauge' : ''}`;
    const path = join(evidence, `terminal-capacity-${arm}.json`);
    await writeFile(path, JSON.stringify(report, null, 2));
    const invalid = results.find(
      (result) => (result.hostLoad as { valid: boolean }).valid === false,
    );
    if (invalid)
      throw new Error(`post-run host load exceeded 15; invalid evidence written to ${path}`);
    console.log(JSON.stringify({ ...report, evidencePath: path }));
  } finally {
    await browser.close();
  }
}

await main();
