import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { chromium, type Page, type WebSocketRoute } from 'playwright';
import {
  ClientMessageSchema,
  ConnectedSchema,
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '../src/terminal/vendor/terminal_pb';
import { prepareQuestFixture } from './prepare-quest-fixture';

const BASE_URL = process.env.MUX_XR_BASE_URL;
const TEST_ROOT = process.env.MUX_XR_TEST_ROOT;
if (!BASE_URL || !TEST_ROOT || process.env.MUX_XR_PRIVATE_TEST !== '1')
  throw new Error('Set MUX_XR_PRIVATE_TEST=1, MUX_XR_BASE_URL, and MUX_XR_TEST_ROOT');
const baseUrl = BASE_URL as string;
const testRoot = TEST_ROOT as string;
const xrMode = process.env.MUX_XR_MODE === 'ar' ? 'ar' : 'vr';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseUrl).hostname))
  throw new Error('Loopback only');

type FixtureWindow = Window & {
  __questThree: typeof import('three');
  __questScene: import('three').Scene;
  __questCamera: import('three').PerspectiveCamera;
  __questRenderer: import('three').WebGLRenderer;
  __questControllers: import('three').Group[];
  __questHands: Array<import('three').Group & { joints: Record<string, import('three').Group> }>;
};
const frame = (message: ServerMessage): Buffer =>
  Buffer.from([0, ...toBinary(ServerMessageSchema, message)]);
const snapshot = (): Buffer => {
  const pane = (id: string) =>
    create(MuxTreePaneSchema, {
      id,
      title: `Pane ${id}`,
      active: id === '%1',
      cols: 80,
      rows: 24,
      x: 0,
      y: 0,
    });
  return frame(
    create(ServerMessageSchema, {
      message: {
        case: 'muxTreeSnapshot',
        value: create(MuxTreeSnapshotSchema, {
          workspaces: [
            create(MuxTreeWorkspaceSchema, {
              id: 'w',
              name: 'Workspace',
              active: true,
              sessions: [
                create(MuxTreeSessionSchema, {
                  id: '$1',
                  name: 'Session',
                  active: true,
                  windows: [
                    create(MuxTreeWindowSchema, {
                      id: '@1',
                      name: 'Window',
                      active: true,
                      layout: '80x24,0,0,1,2',
                      panes: [pane('%1'), pane('%2')],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      },
    }),
  );
};
const connected = (id: string): Buffer =>
  frame(
    create(ServerMessageSchema, {
      message: {
        case: 'connected',
        value: create(ConnectedSchema, {
          cols: 80,
          rows: 24,
          sessionId: id,
          initialScreen: new TextEncoder().encode(`${id} connected\r\n`),
        }),
      },
    }),
  );
async function wait(
  _page: Page,
  predicate: () => Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

async function main(): Promise<void> {
  await mkdir(testRoot, { recursive: true });
  prepareQuestFixture(testRoot);
  const fixtureHtml = join(testRoot, '__quest-controls.html');
  const originalHtml = await readFile(fixtureHtml, 'utf8');
  const initialBuild = '1'.repeat(64);
  let servedBuild = initialBuild;
  await writeFile(
    fixtureHtml,
    originalHtml.replace(
      '<head>',
      `<head><meta name="build-fingerprint" content="${initialBuild}">`,
    ),
  );
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const capturedHands = JSON.parse(
    await readFile(new URL('../tests/fixtures/quest-hand-poses.json', import.meta.url), 'utf8'),
  );
  const capturedGesturePoses = JSON.parse(
    await readFile(new URL('../tests/fixtures/quest-gesture-poses.json', import.meta.url), 'utf8'),
  );
  const neutralHands = JSON.parse(
    await readFile(new URL('../tests/fixtures/quest-neutral-hands.json', import.meta.url), 'utf8'),
  );
  await page.addInitScript(
    (capture) => Object.assign(window, { __neutralHandPoses: capture }),
    neutralHands,
  );
  await page.addInitScript(
    (capture) => Object.assign(window, { __recordedHandPoses: capture }),
    capturedHands,
  );
  await page.addInitScript(
    (capture) => Object.assign(window, { __capturedGesturePoses: capture }),
    capturedGesturePoses,
  );
  await page.route('**/version.json', (route) =>
    route.fulfill({ json: { buildId: servedBuild, version: 'test' } }),
  );
  const errors: string[] = [];
  const inputs: string[] = [];
  let resizes = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Shader Error|GL_INVALID|Failure loading font|Creating a worker/i.test(message.text()))
      errors.push(message.text());
  });
  await page.routeWebSocket(/.*/, (ws: WebSocketRoute) => {
    const id = new URL(ws.url()).searchParams.get('session') ?? 'metadata';
    ws.onMessage((raw) => {
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'binary');
      if (bytes.length < 2) return;
      const message = fromBinary(ClientMessageSchema, new Uint8Array(bytes.subarray(1)));
      if (message.message.case === 'input') inputs.push(id);
      if (message.message.case === 'resize') resizes += 1;
      if (message.message.case === 'muxTreeRequest') ws.send(snapshot());
    });
    if (id !== 'metadata') ws.send(connected(id));
  });
  const report: Record<string, unknown> = { errors, inputs, screenshots: [] as string[] };
  try {
    await page.goto(`${baseUrl}/__quest-controls.html?server=${encodeURIComponent(baseUrl)}`, {
      waitUntil: 'domcontentloaded',
    });
    await wait(
      page,
      async () =>
        page.evaluate(
          () =>
            (
              window as unknown as { __muxXR?: { getState(): { attached: string[] } } }
            ).__muxXR?.getState().attached.length === 2,
        ),
      'Panes did not attach',
    );
    await page.evaluate(() => {
      const xr = navigator.xr;
      if (!xr) throw new Error('XR fixture unavailable');
      const request = xr.requestSession.bind(xr);
      xr.requestSession = (mode, options) => {
        Object.assign(window, { __handXRRequest: mode });
        return request(mode, options);
      };
    });
    if (xrMode === 'ar') {
      await page.locator('[data-action="settings"]').click();
      await page.locator('[data-action="passthrough"]').click();
      await page.locator('[data-action="close-settings"]').click();
    } else await page.locator('[data-action="xr"]').click();
    await wait(
      page,
      async () =>
        page.evaluate(
          (mode) =>
            (
              window as unknown as { __muxXR?: { getState(): { scene: { xrMode: string } } } }
            ).__muxXR?.getState().scene.xrMode === mode,
          xrMode,
        ),
      'XR did not start',
    );
    report.xr = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow & { __handXRRequest: string };
      return {
        requested: w.__handXRRequest,
        transparent: w.__questScene.background === null,
        clearAlpha: w.__questRenderer.getClearAlpha(),
      };
    });
    const xr = report.xr as { requested: string; transparent: boolean; clearAlpha: number };
    if (
      xr.requested !== (xrMode === 'ar' ? 'immersive-ar' : 'immersive-vr') ||
      (xrMode === 'ar' && (!xr.transparent || xr.clearAlpha !== 0))
    )
      throw new Error(`XR presentation failed: ${JSON.stringify(xr)}`);
    await wait(
      page,
      async () =>
        page.evaluate(() => {
          const hands = (window as unknown as FixtureWindow).__questScene.children.filter(
            (root) => root.name === 'xr-cartoon-hand',
          );
          return hands.length === 2 && hands.every((root) => root.userData.handAsset === 'loaded');
        }),
      'Authored hand rigs did not load',
    );
    report.renderer = await page.evaluate(() => {
      const gl = (window as unknown as FixtureWindow).__questRenderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    });
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const T = w.__questThree;
      const rest: Array<Record<string, number[]>> = [];
      const names = [
        'wrist',
        'thumb-metacarpal',
        'thumb-phalanx-proximal',
        'thumb-phalanx-distal',
        'thumb-tip',
        ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap((finger) => [
          `${finger}-metacarpal`,
          `${finger}-phalanx-proximal`,
          `${finger}-phalanx-intermediate`,
          `${finger}-phalanx-distal`,
          `${finger}-tip`,
        ]),
      ];
      for (let i = 0; i < 2; i += 1) {
        const controller = w.__questControllers[i];
        controller.dispatchEvent({
          type: 'connected',
          data: {
            handedness: i ? 'left' : 'right',
            hand: new Map(names.map((jointName) => [jointName, { jointName }])),
          },
        } as never);
        const hand = w.__questHands[i];
        hand.visible = true;
        const capture = (
          window as unknown as {
            __neutralHandPoses: {
              hands: Array<{ side: string; joints: Record<string, { matrix: number[] }> }>;
            };
          }
        ).__neutralHandPoses.hands.find((pose) => pose.side === (i ? 'left' : 'right'));
        if (!capture) throw new Error('Neutral hand capture missing');
        const point = (name: string): import('three').Vector3 =>
          new T.Vector3().setFromMatrixPosition(
            new T.Matrix4().fromArray(capture.joints[name].matrix),
          );
        const forward = point('middle-finger-phalanx-proximal').normalize();
        const across = point('index-finger-phalanx-proximal').sub(
          point('pinky-finger-phalanx-proximal'),
        );
        across.addScaledVector(forward, -across.dot(forward)).normalize();
        const normal = new T.Vector3().crossVectors(across, forward).normalize();
        const sourceBasis = new T.Matrix4().makeBasis(across, forward, normal);
        const placement = new T.Matrix4()
          .makeBasis(
            new T.Vector3(i ? 1 : -1, 0, 0),
            new T.Vector3(0, 1, 0),
            new T.Vector3(0, 0, i ? 1 : -1),
          )
          .multiply(sourceBasis.invert());
        placement.setPosition(i ? -0.24 : 0.24, 1.38, -0.55);
        for (const [name, joint] of Object.entries(hand.joints)) {
          joint.visible = true;
          joint.matrix.multiplyMatrices(
            placement,
            new T.Matrix4().fromArray(capture.joints[name].matrix),
          );
          joint.matrix.decompose(joint.position, joint.quaternion, joint.scale);
        }
        rest.push(
          Object.fromEntries(
            Object.entries(hand.joints).map(([name, node]) => [name, node.matrix.toArray()]),
          ),
        );
        controller.position.set(5 + i, 5, 0);
      }
      Object.assign(window, { __cartoonRest: rest });
    });

    for (const [name, action] of [
      ['open', 'open'],
      ['thumb-base', 'thumb-base'],
      ['index-pinch', 'index-pinch'],
      ['upturned', 'upturned'],
      ['side-on', 'side-on'],
      ['quest-pose', 'quest-pose'],
      ['captured-pinch', 'captured-pinch'],
      ['captured-close', 'captured-close'],
      ['captured-pinch-side', 'captured-pinch-side'],
      ['captured-close-side', 'captured-close-side'],
      ['captured-pinch-opposite', 'captured-pinch-opposite'],
      ['captured-close-opposite', 'captured-close-opposite'],
      ['captured-fist', 'captured-fist'],
      ['captured-fist-side', 'captured-fist-side'],
      ['captured-fist-opposite', 'captured-fist-opposite'],
      ['tracking-loss', 'tracking-loss'],
    ] as const) {
      await page.evaluate((kind) => {
        const w = window as unknown as FixtureWindow;
        const hand = w.__questHands[0];
        const T = w.__questThree;
        const rest = (window as unknown as { __cartoonRest: Array<Record<string, number[]>> })
          .__cartoonRest[0];
        for (const [name, point] of Object.entries(rest)) {
          hand.joints[name].matrix.fromArray(point);
          hand.joints[name].matrix.decompose(
            hand.joints[name].position,
            hand.joints[name].quaternion,
            hand.joints[name].scale,
          );
          hand.joints[name].visible = true;
        }
        if (kind === 'thumb-base') {
          const pivot = hand.joints['thumb-phalanx-proximal'].position.clone();
          const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -0.7);
          for (const name of ['thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']) {
            const joint = hand.joints[name];
            joint.position.sub(pivot).applyQuaternion(turn).add(pivot);
            joint.quaternion.premultiply(turn);
          }
        }
        if (kind === 'index-pinch') {
          const wrist = hand.joints.wrist.position;
          const pinch: Record<string, [number, number, number]> = {
            'thumb-metacarpal': [0.035, 0.018, 0],
            'thumb-phalanx-proximal': [0.055, 0.04, 0.008],
            'thumb-phalanx-distal': [0.075, 0.075, 0.022],
            'thumb-tip': [0.075, 0.1, 0.03],
            'index-finger-phalanx-proximal': [0.03, 0.075, 0],
            'index-finger-phalanx-intermediate': [0.04, 0.108, 0.02],
            'index-finger-phalanx-distal': [0.055, 0.124, 0.03],
            'index-finger-tip': [0.065, 0.112, 0.03],
          };
          for (const [name, [x, y, z]] of Object.entries(pinch))
            hand.joints[name].position.copy(wrist).add(new T.Vector3(-x, y, -z));
          for (const chain of [
            ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
            [
              'index-finger-phalanx-proximal',
              'index-finger-phalanx-intermediate',
              'index-finger-phalanx-distal',
              'index-finger-tip',
            ],
          ]) {
            for (let part = 0; part < 3; part++) {
              const start = chain[part],
                end = chain[part + 1];
              const from = new T.Vector3()
                .setFromMatrixPosition(new T.Matrix4().fromArray(rest[end]))
                .sub(new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(rest[start])))
                .normalize();
              const to = hand.joints[end].position
                .clone()
                .sub(hand.joints[start].position)
                .normalize();
              hand.joints[start].quaternion.premultiply(
                new T.Quaternion().setFromUnitVectors(from, to),
              );
            }
            hand.joints[chain[3]].quaternion.copy(hand.joints[chain[2]].quaternion);
          }
        }
        if (kind === 'upturned' || kind === 'side-on') {
          const wrist = hand.joints.wrist.position.clone();
          const rotation = new T.Quaternion().setFromAxisAngle(
            kind === 'side-on' ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0),
            kind === 'side-on' ? Math.PI / 2 : Math.PI / 6,
          );
          for (const joint of Object.values(hand.joints)) {
            joint.position
              .sub(wrist)
              .applyQuaternion(rotation)
              .add(wrist)
              .add(new T.Vector3(0.1, 0.05, -0.15));
            joint.quaternion.premultiply(rotation);
          }
        }
        if (kind === 'tracking-loss') hand.joints['middle-finger-tip'].visible = false;
        if (kind === 'quest-pose' || kind.startsWith('captured-')) {
          const captures = window as unknown as {
            __recordedHandPoses: {
              hands: Array<{ side: string; joints: Record<string, { matrix: number[] }> }>;
            };
            __capturedGesturePoses: {
              sets: Record<
                string,
                { hands: Array<{ side: string; joints: Record<string, { matrix: number[] }> }> }
              >;
            };
          };
          const captureSet = kind.replace(/-(side|opposite)$/, '');
          const poses =
            kind === 'quest-pose'
              ? captures.__recordedHandPoses
              : captures.__capturedGesturePoses.sets[captureSet];
          for (const pose of poses.hands) {
            const right = pose.side === 'right';
            const source = w.__questHands[right ? 0 : 1];
            const point = (name: string) =>
              new T.Vector3().setFromMatrixPosition(
                new T.Matrix4().fromArray(pose.joints[name].matrix),
              );
            const forward = point('middle-finger-phalanx-proximal').normalize();
            const across = point('index-finger-phalanx-proximal').sub(
              point('pinky-finger-phalanx-proximal'),
            );
            across.addScaledVector(forward, -across.dot(forward)).normalize();
            const normal = new T.Vector3().crossVectors(across, forward).normalize();
            const sourceBasis = new T.Matrix4().makeBasis(across, forward, normal);
            const placement = new T.Matrix4()
              .makeBasis(
                new T.Vector3(right ? -1 : 1, 0, 0),
                new T.Vector3(0, 1, 0),
                new T.Vector3(0, 0, right ? -1 : 1),
              )
              .multiply(sourceBasis.invert());
            placement.setPosition(right ? 0.24 : -0.24, 1.38, -0.55);
            for (const [name, capturedJoint] of Object.entries(pose.joints)) {
              const joint = source.joints[name];
              joint.matrix.multiplyMatrices(
                placement,
                new T.Matrix4().fromArray(capturedJoint.matrix),
              );
              joint.matrix.decompose(joint.position, joint.quaternion, joint.scale);
              joint.visible = true;
            }
            if (kind.endsWith('-side') || kind.endsWith('-opposite')) {
              const wrist = source.joints.wrist.position.clone();
              const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 3);
              if (kind.endsWith('-opposite'))
                turn.setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.PI / 3);
              for (const joint of Object.values(source.joints)) {
                joint.position.sub(wrist).applyQuaternion(turn).add(wrist);
                joint.quaternion.premultiply(turn);
              }
            }
          }
        }
        w.__questScene.updateMatrixWorld(true);
      }, action);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const rigid = await page.evaluate(() => {
        const w = window as unknown as FixtureWindow;
        let maxStretch = 0;
        for (const root of w.__questScene.children) {
          if (root.name !== 'xr-cartoon-hand' || !root.visible) continue;
          const skin = root.getObjectByName('authored-hand-skin') as import('three').SkinnedMesh;
          for (const bone of skin.skeleton.bones) {
            for (const axis of [0, 1, 2]) {
              const size = new w.__questThree.Vector3()
                .setFromMatrixColumn(bone.matrixWorld, axis)
                .length();
              maxStretch = Math.max(maxStretch, Math.abs(size - 1));
            }
          }
        }
        return maxStretch;
      });
      if (rigid > 1e-5) throw new Error(`Hand bone stretched in ${name}: ${rigid}`);
      if (name.startsWith('captured-pinch')) {
        const metrics = await page.evaluate(() => {
          const w = window as unknown as FixtureWindow & {
            __capturedGesturePoses: {
              sets: Record<
                string,
                { hands: Array<{ side: string; rawTrackedThumbIndexDistance: number }> }
              >;
            };
          };
          return w.__questScene.children
            .filter((root) => root.name === 'xr-cartoon-hand')
            .map((root) => {
              const skin = root.getObjectByName(
                'authored-hand-skin',
              ) as import('three').SkinnedMesh;
              const index = skin.skeleton.getBoneByName('index_03') as import('three').Bone;
              const thumb = skin.skeleton.getBoneByName('thumb_03') as import('three').Bone;
              const indexEnd = index.localToWorld(
                new w.__questThree.Vector3(0, index.userData.restLength, 0),
              );
              const thumbEnd = thumb.localToWorld(
                new w.__questThree.Vector3(0, thumb.userData.restLength, 0),
              );
              const side = String(root.userData.handedness);
              const raw = w.__capturedGesturePoses.sets['captured-pinch'].hands.find(
                (hand) => hand.side === side,
              );
              if (!raw) throw new Error(`Captured pinch metadata missing for ${side}`);
              return {
                side,
                rawTrackedThumbIndexDistance: raw.rawTrackedThumbIndexDistance,
                renderedBoneEndDistance: thumbEnd.distanceTo(indexEnd),
              };
            });
        });
        report[`${name}Metrics`] = metrics;
        if (
          metrics.some(
            (metric) =>
              metric.rawTrackedThumbIndexDistance >= 0.01 || metric.renderedBoneEndDistance >= 0.03,
          )
        )
          throw new Error(`Captured pinch closure failed: ${JSON.stringify(metrics)}`);
      }
      if (name === 'open') {
        report.open = await page.evaluate(() => {
          const w = window as unknown as FixtureWindow;
          return w.__questScene.children
            .filter((root) => root.name === 'xr-cartoon-hand')
            .map((root) => {
              const arm = root.getObjectByName('elastic-hand-arm') as import('three').Mesh;
              const points = arm.geometry.getAttribute('position');
              const endpoint = new w.__questThree.Vector3().fromBufferAttribute(
                points,
                points.count - 1,
              );
              const anchor = root.userData.armAnchor as import('three').Vector3;
              const wrist = root.userData.wristPosition as import('three').Vector3;
              const model = root.getObjectByName('authored-hand-root');
              if (
                !model ||
                Math.abs(model.scale.x - model.scale.y) > 1e-6 ||
                Math.abs(model.scale.z - model.scale.y) > 1e-6
              )
                throw new Error('Tracked hand proportions are scaled unevenly');
              const skin = root.getObjectByName(
                'authored-hand-skin',
              ) as import('three').SkinnedMesh;
              const index = skin.skeleton.getBoneByName('index_03') as import('three').Bone;
              const thumb = skin.skeleton.getBoneByName('thumb_03') as import('three').Bone;
              const indexEnd = index.localToWorld(
                new w.__questThree.Vector3(0, index.userData.restLength, 0),
              );
              const thumbEnd = thumb.localToWorld(
                new w.__questThree.Vector3(0, thumb.userData.restLength, 0),
              );
              const middle = new w.__questThree.Vector3();
              for (let i = 0; i < 10; i++)
                middle.add(new w.__questThree.Vector3().fromBufferAttribute(points, 120 + i));
              middle.multiplyScalar(0.1);
              return {
                side: root.userData.handedness,
                visible: root.visible,
                endpointError: endpoint.distanceTo(wrist),
                sag: (anchor.y + wrist.y) / 2 - middle.y,
                indexError: indexEnd.distanceTo(root.userData.indexTip),
                thumbError: thumbEnd.distanceTo(root.userData.thumbTip),
                modelScale: model.scale.toArray(),
              };
            });
        });
        const open = report.open as Array<{
          visible: boolean;
          endpointError: number;
          sag: number;
          indexError: number;
          thumbError: number;
        }>;
        if (
          open.length !== 2 ||
          open.some((hand) => !hand.visible || hand.endpointError > 1e-5 || hand.sag <= 0)
        )
          throw new Error(`Open hand geometry failed: ${JSON.stringify(open)}`);
      }
      await page.screenshot({ path: join(testRoot, `hand-${name}.png`), fullPage: true });
      (report.screenshots as string[]).push(`hand-${name}.png`);
    }
    report.meshes = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const roots = w.__questScene.children.filter((o) => o.name === 'xr-cartoon-hand');
      return {
        count: roots.length,
        visibility: roots.map((root) => root.visible),
        details: roots.map((root) => ({
          handedness: root.userData.handedness,
          authored: root.userData.handAsset,
          bones: (root.getObjectByName('authored-hand-skin') as import('three').SkinnedMesh)
            .skeleton.bones.length,
          finite: root.children.every((child) => {
            const g = (child as import('three').Mesh).geometry;
            const p = g?.getAttribute?.('position');
            return !p || Array.from(p.array).every(Number.isFinite);
          }),
        })),
      };
    });
    await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const pads = [0, 1].map(() => ({
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })),
      }));
      for (let i = 0; i < 2; i++) {
        w.__questControllers[i].position.set(i ? -0.24 : 0.24, 1.4, -0.55);
        w.__questControllers[i].quaternion.identity();
        w.__questControllers[i].dispatchEvent({
          type: 'connected',
          data: { handedness: i ? 'left' : 'right', gamepad: pads[i] },
        } as never);
      }
      Object.assign(window, { __cartoonPads: pads });
    });
    const controllerTips: Record<string, number[]> = {};
    const controllerRigs: Record<
      string,
      Array<{ side: string; index: number[]; bounds: number[] }>
    > = {};
    for (const [pose, button] of [
      ['open', -1],
      ['trigger', 0],
      ['grip', 1],
      ['button', 4],
    ] as const) {
      await page.evaluate(async (button) => {
        const pads = (
          window as unknown as {
            __cartoonPads: Array<{ buttons: Array<{ pressed: boolean; value: number }> }>;
          }
        ).__cartoonPads;
        for (const pad of pads)
          for (const state of pad.buttons) {
            state.pressed = false;
            state.value = 0;
          }
        if (button >= 0) {
          pads[0].buttons[button].pressed = true;
          pads[0].buttons[button].value = 1;
        }
        for (let i = 0; i < 18; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }, button);
      controllerTips[pose] = await page.evaluate(() => {
        const root = (window as unknown as FixtureWindow).__questScene.children.find(
          (root) => root.name === 'xr-cartoon-hand' && root.userData.handedness === 'right',
        );
        if (!root) throw new Error('Right controller hand missing');
        return (root.userData.indexTip as import('three').Vector3).toArray();
      });
      controllerRigs[pose] = await page.evaluate(() => {
        const w = window as unknown as FixtureWindow;
        return w.__questScene.children
          .filter((root) => root.name === 'xr-cartoon-hand')
          .map((root) => {
            const skin = root.getObjectByName('authored-hand-skin') as import('three').SkinnedMesh;
            const index = skin.skeleton.bones.find((bone) => bone.name === 'index_01');
            if (!index) throw new Error('Authored index bone missing');
            const box = new w.__questThree.Box3();
            const point = new w.__questThree.Vector3();
            for (let vertex = 0; vertex < skin.geometry.getAttribute('position').count; vertex++) {
              skin.getVertexPosition(vertex, point);
              if (!point.toArray().every(Number.isFinite))
                throw new Error('Non-finite deformed hand vertex');
              box.expandByPoint(point);
            }
            return {
              side: String(root.userData.handedness),
              index: index.quaternion.toArray(),
              bounds: box.getSize(point).toArray(),
            };
          });
      });
      await page.screenshot({ path: join(testRoot, `controller-${pose}.png`) });
    }
    const distance = (a: number[], b: number[]): number =>
      Math.hypot(...a.map((value, index) => value - b[index]));
    if (
      distance(controllerTips.open, controllerTips.trigger) < 0.03 ||
      distance(controllerTips.open, controllerTips.grip) > 0.002 ||
      distance(controllerTips.open, controllerTips.button) > 0.002
    )
      throw new Error(`Controller finger isolation failed: ${JSON.stringify(controllerTips)}`);
    report.controllerTips = controllerTips;
    report.watchTime = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const face = w.__questScene
        .getObjectByName('xr-wrist-menu-watch')
        ?.children.find((node) => node.userData.inputAction === 'wristMenu');
      const expected = [Date.now(), Date.now() - 1000].map((stamp) => {
        const date = new Date(stamp);
        return `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}\n${date.getHours() >= 12 ? 'PM' : 'AM'}`;
      });
      const actual = String(face?.userData.labelText);
      if (!expected.includes(actual)) throw new Error(`Watch time mismatch: ${actual}`);
      return actual;
    });
    report.controllerRigs = controllerRigs;
    for (const side of ['left', 'right']) {
      const neutral = controllerRigs.open.find((hand) => hand.side === side);
      const trigger = controllerRigs.trigger.find((hand) => hand.side === side);
      if (!neutral || !trigger) throw new Error('Authored controller hand missing');
      const changed = distance(neutral.index, trigger.index);
      if (side === 'right' ? changed < 0.05 : changed > 0.001)
        throw new Error(`Authored index deformation failed on ${side}: ${changed}`);
      if (neutral.bounds.some((size) => size < 0.01 || size > 0.3))
        throw new Error(`Authored hand bounds invalid: ${neutral.bounds}`);
    }
    report.watch = await page.evaluate(async () => {
      const w = window as unknown as FixtureWindow;
      const state = window as unknown as {
        __cartoonPads: Array<{ buttons: Array<{ pressed: boolean; value: number }> }>;
        __muxXR: { getState(): { scene: { radialOpen: boolean } } };
      };
      const tick = async (n = 2): Promise<void> => {
        for (let i = 0; i < n; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      };
      state.__cartoonPads[0].buttons[4].pressed = false;
      state.__cartoonPads[0].buttons[4].value = 0;
      await tick();
      if (state.__muxXR.getState().scene.radialOpen) {
        state.__cartoonPads[0].buttons[4].pressed = true;
        state.__cartoonPads[0].buttons[4].value = 1;
        await tick();
        state.__cartoonPads[0].buttons[4].pressed = false;
        state.__cartoonPads[0].buttons[4].value = 0;
        await tick(12);
      }
      const face = w.__questScene
        .getObjectByName('xr-wrist-menu-watch')
        ?.children.find((node) => node.userData.inputAction === 'wristMenu');
      if (!face) throw new Error('Wrist Menu face missing');
      const left = w.__questControllers[1];
      const q = face.getWorldQuaternion(new w.__questThree.Quaternion());
      left.position
        .copy(face.getWorldPosition(new w.__questThree.Vector3()))
        .add(new w.__questThree.Vector3(0, 0, 0.25).applyQuaternion(q));
      left.quaternion.copy(q);
      w.__questScene.updateMatrixWorld(true);
      left.dispatchEvent({ type: 'selectstart' } as never);
      await tick(45);
      const opened = state.__muxXR.getState().scene.radialOpen;
      left.dispatchEvent({ type: 'select' } as never);
      left.dispatchEvent({ type: 'selectend' } as never);
      await tick();
      return { opened, remainsOpen: state.__muxXR.getState().scene.radialOpen };
    });
    if (
      !(report.watch as { opened: boolean; remainsOpen: boolean }).opened ||
      !(report.watch as { remainsOpen: boolean }).remainsOpen
    )
      throw new Error(`Watch failed: ${JSON.stringify(report.watch)}`);
    await page.screenshot({ path: join(testRoot, 'hand-watch-menu.png') });
    const reloadVisible = (): Promise<boolean> =>
      page.evaluate(() => {
        const w = window as unknown as FixtureWindow;
        return Boolean(w.__questScene.getObjectByName('radial-menu-reload-update')?.visible);
      });
    if (await reloadVisible()) throw new Error('Watch offered Reload without an update');
    if (
      await page.evaluate(
        () =>
          (window as unknown as FixtureWindow).__questScene.getObjectByName(
            'xr-wrist-menu-update-indicator',
          )?.visible,
      )
    )
      throw new Error('Watch indicator visible without an update');
    servedBuild = '2'.repeat(64);
    await page.evaluate(() =>
      (
        window as unknown as { __muxXR: { checkForUpdate(): Promise<void> } }
      ).__muxXR.checkForUpdate(),
    );
    await wait(page, reloadVisible, 'Watch did not offer Reload for the available update');
    report.watchUpdateIndicator = await page.evaluate(
      () =>
        (window as unknown as FixtureWindow).__questScene.getObjectByName(
          'xr-wrist-menu-update-indicator',
        )?.visible,
    );
    if (!report.watchUpdateIndicator) throw new Error('Watch update indicator missing');
    await page.screenshot({ path: join(testRoot, 'hand-watch-reload.png') });
    const watchClip = await page.evaluate(() => {
      const w = window as unknown as FixtureWindow;
      const watch = w.__questScene.getObjectByName('xr-wrist-menu-watch');
      if (!watch) throw new Error('Watch missing');
      const point = watch.getWorldPosition(new w.__questThree.Vector3()).project(w.__questCamera);
      const rect = w.__questRenderer.domElement.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(innerWidth - 180, rect.x + ((point.x + 1) * rect.width) / 2 - 90)),
        y: Math.max(
          0,
          Math.min(innerHeight - 120, rect.y + ((1 - point.y) * rect.height) / 2 - 60),
        ),
        width: 180,
        height: 120,
      };
    });
    await page.screenshot({ path: join(testRoot, 'watch-update-close.png'), clip: watchClip });
    await writeFile(
      fixtureHtml,
      originalHtml.replace(
        '<head>',
        `<head><meta name="build-fingerprint" content="${servedBuild}">`,
      ),
    );
    await Promise.all([
      page.waitForURL((url) => url.searchParams.has('_reload')),
      page.evaluate(() => {
        const w = window as unknown as FixtureWindow;
        const button = w.__questScene.getObjectByName('radial-menu-reload-update');
        if (!button) throw new Error('Watch Reload button missing');
        const controller = w.__questControllers[0];
        const rotation = button.getWorldQuaternion(new w.__questThree.Quaternion());
        controller.position
          .copy(button.getWorldPosition(new w.__questThree.Vector3()))
          .add(new w.__questThree.Vector3(0, 0, 0.3).applyQuaternion(rotation));
        controller.quaternion.copy(rotation);
        w.__questScene.updateMatrixWorld(true);
        controller.dispatchEvent({ type: 'selectstart' } as never);
      }),
    ]);
    await page.waitForFunction(
      (expected) =>
        (window as unknown as { __muxXR?: { getState(): { buildId: string } } }).__muxXR?.getState()
          .buildId === expected,
      servedBuild,
    );
    report.watchReload = true;
    report.resizes = resizes;
    const meshReport = report.meshes as {
      count: number;
      visibility: boolean[];
      details: Array<{ authored: string; bones: number; finite: boolean }>;
    };
    report.ok =
      errors.length === 0 &&
      inputs.length === 0 &&
      resizes === 0 &&
      meshReport.count === 2 &&
      meshReport.visibility[0] === false &&
      meshReport.visibility[1] === true &&
      meshReport.details.every(
        (item) => item.authored === 'loaded' && item.bones === 16 && item.finite,
      ) &&
      /Apple.*M4|Metal/i.test(String(report.renderer)) &&
      !/SwiftShader/i.test(String(report.renderer));
    if (!report.ok) throw new Error(`Hand visual assertions failed: ${JSON.stringify(report)}`);
  } finally {
    await writeFile(join(testRoot, 'hand-visual-report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
await main();
