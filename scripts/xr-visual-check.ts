import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page, type Route } from 'playwright';
import type { PaneDescriptor } from '../src/contracts';

type VisualThree = typeof import('three');

type VisualMetrics = {
  keyboard: {
    width: number;
    height: number;
    depth: number;
    visibleKeys: number;
    projectedWidth: number;
    projectedHeight: number;
    allCornersInView: boolean;
  };
  renderer: string;
  controllerRayDistance: number;
  highlightedColor: string;
  xrTransformButtons: string[];
  pairGrip: { scaleBefore: number; scaleAfter: number; moved: number };
};

type FixtureWindow = Window & {
  __muxXRVisualFixture?: {
    metrics: () => VisualMetrics;
    highlightController: () => void;
    simulatePairGrip: () => void;
    releasePairGrip: () => void;
  };
};

const BASE_URL = process.env.MUX_XR_BASE_URL ?? 'http://127.0.0.1:4241';
const REVIEW_DIR = join(process.cwd(), '.impeccable', 'review');
const KEYBOARD_SCREENSHOT = join(REVIEW_DIR, 'quest-keyboard-native.png');
const HIGHLIGHT_SCREENSHOT = join(REVIEW_DIR, 'quest-keyboard-native-highlight.png');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixtureThreeSource(realThreeUrl: string): string {
  return `
import * as RealThree from ${JSON.stringify(realThreeUrl)};
export * from ${JSON.stringify(realThreeUrl)};

const controllerGroups = [new RealThree.Group(), new RealThree.Group()];
const xrCamera = new RealThree.PerspectiveCamera(58, 1, 0.01, 100);
xrCamera.position.set(0, 1.6, 0);
xrCamera.lookAt(0, 1.6, -1);
const originalConstruct = RealThree.WebGLRenderer;

export class WebGLRenderer extends originalConstruct {
  constructor(parameters) {
    super(parameters);
    const renderer = this;
    const originalXR = renderer.xr;
    const originalRender = renderer.render.bind(renderer);
    const originalSetSize = renderer.setSize.bind(renderer);
    let animationFrame = 0;
    const fixtureXR = {
      enabled: true,
      isPresenting: true,
      getCamera: () => xrCamera,
      getController: (index) => controllerGroups[index] ?? controllerGroups[0],
      setReferenceSpaceType: (...args) => originalXR.setReferenceSpaceType(...args),
      setSession: (...args) => originalXR.setSession(...args),
    };
    renderer.xr = fixtureXR;
    renderer.setAnimationLoop = (callback) => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (!callback) return;
      const tick = (time) => {
        callback(time);
        animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
    };
    renderer.setSize = (width, height, updateStyle) => {
      xrCamera.aspect = width / Math.max(1, height);
      xrCamera.updateProjectionMatrix();
      originalSetSize(width, height, updateStyle);
    };
    renderer.render = (scene, camera) => {
      renderer.xr = originalXR;
      originalRender(scene, xrCamera);
      renderer.xr = fixtureXR;
    };
    const fixtureWindow = window;
    fixtureWindow.__muxXRVisualRenderer = renderer;
    fixtureWindow.__muxXRVisualControllers = controllerGroups;
    fixtureWindow.__muxXRVisualCamera = xrCamera;
    fixtureWindow.__muxXRVisualThree = RealThree;
    return renderer;
  }
}
`;
}

async function rewriteSceneImport(route: Route): Promise<void> {
  const response = await route.fetch();
  const source = await response.text();
  const importMatch = source.match(/from\s+["']([^"']*three[^"']*)["']/);
  assert(importMatch, 'Could not locate the Vite-resolved Three.js import in scene.ts');
  const realThreeUrl = new URL(importMatch[1], route.request().url()).href;
  const fixtureUrl = new URL('/__xr-three-visual-fixture.js', route.request().url()).href;
  const rewritten = source.replace(importMatch[0], `from ${JSON.stringify(fixtureUrl)}`);
  (globalThis as { __xrVisualThreeSource?: string }).__xrVisualThreeSource =
    fixtureThreeSource(realThreeUrl);
  await route.fulfill({
    response,
    contentType: 'application/javascript',
    body: rewritten,
  });
}

async function installModuleRoutes(page: Page): Promise<void> {
  await page.route('**/__xr-native-fixture.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><main id="fixture-root"></main></body></html>',
    });
  });
  await page.route('**/src/xr/scene.ts*', rewriteSceneImport);
  await page.route('**/__xr-three-visual-fixture.js', async (route) => {
    const source = (globalThis as { __xrVisualThreeSource?: string }).__xrVisualThreeSource;
    assert(source, 'Three.js fixture source was not prepared before it was requested');
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: source,
    });
  });
}

async function createFixture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sceneModuleUrl = '/src/xr/scene.ts?xr-visual-fixture=1';
    const module = await import(/* @vite-ignore */ sceneModuleUrl);
    const host = document.createElement('div');
    host.id = 'xr-visual-fixture-host';
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      width: '1280px',
      height: '900px',
      background: '#05090d',
    });
    document.body.append(host);

    const events: string[] = [];
    const pane = (id: string, title: string): PaneDescriptor => ({
      id,
      workspaceId: 'fixture-workspace',
      workspaceName: 'Visual fixture workspace',
      sessionId: 'fixture-session',
      sessionName: 'Visual fixture session',
      windowId: 'fixture-window',
      windowName: 'Visual fixture window',
      title,
      cols: 80,
      rows: 24,
    });
    const surfaces = [
      pane('%fixture-a', 'Build monitor'),
      pane('%fixture-b', 'Agent activity'),
    ].map((descriptor, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 420;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = index === 0 ? '#0a1520' : '#111827';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#6fe4ff';
        context.font = 'bold 24px ui-monospace, monospace';
        context.fillText(descriptor.title, 32, 54);
        context.fillStyle = '#9bb0bc';
        context.font = '18px ui-monospace, monospace';
        context.fillText('fixture stream ready', 32, 98);
        for (let row = 0; row < 8; row += 1) {
          context.fillStyle = row % 2 ? '#73909f' : '#aec4cc';
          context.fillText(
            `$ ${['make checkall', 'git status', 'watching workspace'][row % 3]}`,
            32,
            150 + row * 30,
          );
        }
      }
      const listeners = new Set<() => void>();
      return {
        canvas,
        pane: descriptor,
        revision: 1,
        cols: 80,
        rows: 24,
        status: 'connected' as const,
        connect: () => undefined,
        sendText: (text: string) => {
          events.push(`${descriptor.id}:text:${text}`);
          return true;
        },
        sendKey: (key: string) => {
          events.push(`${descriptor.id}:key:${key}`);
          return true;
        },
        paste: (text: string) => {
          events.push(`${descriptor.id}:paste:${text}`);
          return true;
        },
        focus: () => undefined,
        resizeGrid: () => undefined,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        dispose: () => listeners.clear(),
      };
    });
    const scene = module.createWorkspaceScene(host, {
      selectPane: (id: string) => scene.selectTerminal(id),
      closePane: () => undefined,
      sendText: (text: string) => events.push(`action:text:${text}`),
      sendKey: (key: string) => events.push(`action:key:${key}`),
      runCommand: () => undefined,
      openKeyboard: () => undefined,
      openCommands: () => undefined,
    });
    for (const surface of surfaces) scene.addTerminal(surface);
    scene.setAvailablePanes(surfaces.map((surface) => surface.pane));
    scene.selectTerminal('%fixture-a');
    scene.showInput('keyboard');

    let pairStartPosition: import('three').Vector3 | null = null;
    let pairStartScale = 0;
    const fixtureWindow = window as FixtureWindow;
    fixtureWindow.__muxXRVisualFixture = {
      metrics: () => {
        const THREE = (window as unknown as { __muxXRVisualThree: VisualThree }).__muxXRVisualThree;
        const keyboard = scene.scene.getObjectByName('xr-keyboard-controls');
        if (!keyboard) throw new Error('Actual scene did not create xr-keyboard-controls');
        keyboard.updateMatrixWorld(true);
        const viewCamera = (
          window as unknown as {
            __muxXRVisualCamera: InstanceType<VisualThree['PerspectiveCamera']>;
          }
        ).__muxXRVisualCamera;
        viewCamera.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(keyboard);
        const corners = [
          [bounds.min.x, bounds.min.y, bounds.min.z],
          [bounds.min.x, bounds.min.y, bounds.max.z],
          [bounds.min.x, bounds.max.y, bounds.min.z],
          [bounds.min.x, bounds.max.y, bounds.max.z],
          [bounds.max.x, bounds.min.y, bounds.min.z],
          [bounds.max.x, bounds.min.y, bounds.max.z],
          [bounds.max.x, bounds.max.y, bounds.min.z],
          [bounds.max.x, bounds.max.y, bounds.max.z],
        ].map(([x, y, z]) => new THREE.Vector3(x, y, z).project(viewCamera));
        let visibleKeys = 0;
        keyboard.traverse((object: import('three').Object3D) => {
          if (object.userData.inputAction === 'key' && object.visible) visibleKeys += 1;
        });
        const renderer = (
          window as unknown as { __muxXRVisualRenderer?: { getContext(): WebGLRenderingContext } }
        ).__muxXRVisualRenderer;
        const context = renderer?.getContext();
        const debug = context?.getExtension('WEBGL_debug_renderer_info');
        const rendererName = debug
          ? String(context?.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? 'unknown')
          : 'unknown';
        const controllers = (
          window as unknown as {
            __muxXRVisualControllers: Array<InstanceType<VisualThree['Group']>>;
          }
        ).__muxXRVisualControllers;
        const controller = controllers[0];
        const xrTransformButtons: string[] = [];
        scene.scene.traverse((object: import('three').Object3D) => {
          if (
            object.name.startsWith('xr-') &&
            ['inputScale', 'inputReset', 'selectedScale', 'resetLayout'].includes(
              String(object.userData.inputAction),
            )
          ) {
            xrTransformButtons.push(String(object.userData.inputAction));
          }
        });
        const highlightedKey = (() => {
          let result: import('three').Object3D | undefined;
          keyboard.traverse((object: import('three').Object3D) => {
            if (!result && object.userData.key === 'a') result = object;
          });
          return result;
        })();
        const highlightedMaterial =
          highlightedKey && 'material' in highlightedKey
            ? (highlightedKey as import('three').Mesh).material
            : undefined;
        const highlightedColor =
          highlightedMaterial && !Array.isArray(highlightedMaterial)
            ? (highlightedMaterial as import('three').MeshBasicMaterial).color.getHexString()
            : 'unknown';
        return {
          keyboard: {
            width: bounds.max.x - bounds.min.x,
            height: bounds.max.y - bounds.min.y,
            depth: bounds.max.z - bounds.min.z,
            visibleKeys,
            projectedWidth:
              Math.max(...corners.map((corner) => corner.x)) -
              Math.min(...corners.map((corner) => corner.x)),
            projectedHeight:
              Math.max(...corners.map((corner) => corner.y)) -
              Math.min(...corners.map((corner) => corner.y)),
            allCornersInView: corners.every(
              (corner) =>
                corner.x >= -1 &&
                corner.x <= 1 &&
                corner.y >= -1 &&
                corner.y <= 1 &&
                corner.z >= -1 &&
                corner.z <= 1,
            ),
          },
          renderer: rendererName,
          controllerRayDistance: Number(controller.userData.rayDistance ?? 0),
          highlightedColor,
          xrTransformButtons,
          pairGrip: {
            scaleBefore: pairStartScale,
            scaleAfter: keyboard.scale.x,
            moved: pairStartPosition ? keyboard.position.distanceTo(pairStartPosition) : 0,
          },
        };
      },
      highlightController: () => {
        const THREE = (window as unknown as { __muxXRVisualThree: VisualThree }).__muxXRVisualThree;
        const controllers = (
          window as unknown as {
            __muxXRVisualControllers: Array<InstanceType<VisualThree['Group']>>;
          }
        ).__muxXRVisualControllers;
        const controller = controllers[0];
        const keyboard = scene.scene.getObjectByName('xr-keyboard-controls');
        if (!keyboard) throw new Error('Actual scene did not create xr-keyboard-controls');
        let keyA: import('three').Object3D | undefined;
        keyboard.traverse((object: import('three').Object3D) => {
          if (!keyA && object.userData.key === 'a') keyA = object;
        });
        if (!keyA) throw new Error('Actual scene did not create keyboard key A');
        keyboard.updateMatrixWorld(true);
        const target = keyA.getWorldPosition(new THREE.Vector3());
        const orientation = keyA.getWorldQuaternion(new THREE.Quaternion());
        const origin = target
          .clone()
          .add(new THREE.Vector3(0, 0, 0.7).applyQuaternion(orientation));
        controller.position.copy(origin);
        controller.quaternion.copy(orientation);
        controller.updateMatrixWorld(true);
        controller.dispatchEvent({ type: 'connected' } as never);
      },
      simulatePairGrip: () => {
        const THREE = (window as unknown as { __muxXRVisualThree: VisualThree }).__muxXRVisualThree;
        const controllers = (
          window as unknown as {
            __muxXRVisualControllers: Array<InstanceType<VisualThree['Group']>>;
          }
        ).__muxXRVisualControllers;
        const keyboard = scene.scene.getObjectByName('xr-keyboard-controls');
        if (!keyboard) throw new Error('Actual scene did not create xr-keyboard-controls');
        const targets: import('three').Object3D[] = [];
        keyboard.traverse((object: import('three').Object3D) => {
          if (object.userData.key === 'a' || object.userData.key === 'Shift') targets.push(object);
        });
        if (targets.length < 2) throw new Error('Keyboard grip targets missing');
        keyboard.updateMatrixWorld(true);
        targets.sort(
          (a, b) =>
            a.getWorldPosition(new THREE.Vector3()).x - b.getWorldPosition(new THREE.Vector3()).x,
        );
        const aim = (
          controller: InstanceType<VisualThree['Group']>,
          target: import('three').Object3D,
        ): void => {
          const orientation = target.getWorldQuaternion(new THREE.Quaternion());
          controller.position.copy(
            target
              .getWorldPosition(new THREE.Vector3())
              .add(new THREE.Vector3(0, 0, 0.3).applyQuaternion(orientation)),
          );
          controller.quaternion.copy(orientation);
        };
        aim(controllers[0], targets[0]);
        aim(controllers[1], targets[1]);
        controllers[0].dispatchEvent({ type: 'connected' } as never);
        controllers[1].dispatchEvent({ type: 'connected' } as never);
        controllers[0].dispatchEvent({ type: 'squeezestart' } as never);
        pairStartScale = keyboard.scale.x;
        pairStartPosition = keyboard.position.clone();
        controllers[1].dispatchEvent({ type: 'squeezestart' } as never);
        controllers[0].position.x -= 0.15;
        controllers[1].position.x += 0.15;
        controllers[1].position.y += 0.12;
      },
      releasePairGrip: () => {
        const controllers = (
          window as unknown as {
            __muxXRVisualControllers: Array<InstanceType<VisualThree['Group']>>;
          }
        ).__muxXRVisualControllers;
        controllers[0].dispatchEvent({ type: 'squeezeend' } as never);
        controllers[1].dispatchEvent({ type: 'squeezeend' } as never);
        scene.resetLayout();
      },
    };
  });
}

async function main(): Promise<void> {
  await mkdir(REVIEW_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await installModuleRoutes(page);
    await page.goto(`${BASE_URL}/__xr-native-fixture.html`, { waitUntil: 'domcontentloaded' });
    await createFixture(page);
    await page.waitForTimeout(500);
    const metrics = await page.evaluate(() => {
      const fixture = (window as FixtureWindow).__muxXRVisualFixture;
      if (!fixture) throw new Error('XR visual fixture did not initialize');
      return fixture.metrics();
    });
    await page.evaluate(() => {
      const fixture = (window as FixtureWindow).__muxXRVisualFixture;
      if (!fixture) throw new Error('XR visual fixture did not initialize');
      fixture.simulatePairGrip();
    });
    await page.waitForFunction(
      () => {
        const metric = (window as FixtureWindow).__muxXRVisualFixture?.metrics();
        return (
          metric &&
          metric.pairGrip.scaleAfter > metric.pairGrip.scaleBefore &&
          metric.pairGrip.moved > 0.01
        );
      },
      undefined,
      { timeout: 5000 },
    );
    const gripped = await page.evaluate(() => {
      const fixture = (window as FixtureWindow).__muxXRVisualFixture;
      if (!fixture) throw new Error('XR visual fixture did not initialize');
      return fixture.metrics();
    });
    assert(
      metrics.keyboard.visibleKeys >= 40,
      `Expected all keyboard keys, got ${metrics.keyboard.visibleKeys}`,
    );
    assert(
      metrics.keyboard.width <= 1.1,
      `Keyboard world width exceeds 1.1m: ${metrics.keyboard.width}`,
    );
    assert(
      metrics.keyboard.allCornersInView,
      'Keyboard bounds are not fully inside the XR camera frustum',
    );
    assert(
      metrics.keyboard.projectedHeight > 0.2 && metrics.keyboard.projectedHeight < 1.8,
      'Keyboard is not a bounded in-view height',
    );
    assert(
      metrics.xrTransformButtons.length === 0,
      `XR transform buttons remain: ${metrics.xrTransformButtons.join(', ')}`,
    );
    assert(
      gripped.pairGrip.scaleAfter > gripped.pairGrip.scaleBefore,
      'Pair grip did not scale keyboard',
    );
    assert(gripped.pairGrip.moved > 0.01, 'Pair grip did not move keyboard');
    assert(metrics.renderer !== 'unknown', 'WebGL debug renderer information is unavailable');
    assert(
      !/swiftshader/i.test(metrics.renderer),
      `SwiftShader renderer detected: ${metrics.renderer}`,
    );
    await page.screenshot({ path: join(REVIEW_DIR, 'quest-keyboard-gripped.png') });
    await page.evaluate(() => (window as FixtureWindow).__muxXRVisualFixture?.releasePairGrip());
    await page.waitForTimeout(100);
    await page.screenshot({ path: KEYBOARD_SCREENSHOT });
    await page.evaluate(() => {
      const fixture = (window as FixtureWindow).__muxXRVisualFixture;
      if (!fixture) throw new Error('XR visual fixture did not initialize');
      fixture.highlightController();
    });
    await page.waitForTimeout(250);
    const highlighted = await page.evaluate(() => {
      const fixture = (window as FixtureWindow).__muxXRVisualFixture;
      if (!fixture) throw new Error('XR visual fixture did not initialize');
      return fixture.metrics();
    });
    assert(
      highlighted.controllerRayDistance > 0.5 && highlighted.controllerRayDistance < 0.9,
      `Controller ray did not contact key A: ${highlighted.controllerRayDistance}`,
    );
    assert(
      highlighted.highlightedColor.toLowerCase() === '9deaff',
      `Key A was not highlighted: ${highlighted.highlightedColor}`,
    );
    await page.screenshot({ path: HIGHLIGHT_SCREENSHOT });
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join('; ')}`);
    console.log(
      JSON.stringify(
        {
          kind: 'xr-visual-check',
          simulatedXR: true,
          baseUrl: BASE_URL,
          renderer: metrics.renderer,
          keyboard: metrics.keyboard,
          highlighted: {
            controllerRayDistance: highlighted.controllerRayDistance,
            highlightedColor: highlighted.highlightedColor,
          },
          pairGrip: gripped.pairGrip,
          xrTransformButtons: metrics.xrTransformButtons,
          screenshotPaths: [KEYBOARD_SCREENSHOT, HIGHLIGHT_SCREENSHOT],
          pageErrors,
          limitations: [
            'Uses the real scene and native GPU WebGL rendering with a local XR camera/controller fixture.',
            'Does not create an immersive WebXR session and cannot replace headset comfort, tracking, or passthrough acceptance.',
            'Terminal surfaces and commands are private synthetic fixtures with no WebSocket or host process access.',
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      'XR fixture state:',
      await page
        .evaluate(() => (window as FixtureWindow).__muxXRVisualFixture?.metrics())
        .catch(() => null),
    );
    await page
      .screenshot({ path: join(REVIEW_DIR, 'quest-keyboard-failure.png') })
      .catch(() => undefined);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
