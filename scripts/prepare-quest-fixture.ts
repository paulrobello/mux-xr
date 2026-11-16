import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function absoluteImport(
  source: string,
  sourceFile: string,
  replacements: Map<string, string>,
): string {
  return source.replace(
    /(from\s*|import\s*(?:\(\s*)?)(["'])(\.\.?\/[^"']+)\2/g,
    (_match, prefix: string, quote: string, specifier: string) => {
      const replacement = replacements.get(specifier) ?? resolve(dirname(sourceFile), specifier);
      return `${prefix}${quote}${replacement}${quote}`;
    },
  );
}

function threeShimSource(): string {
  const threePath = join(repoRoot, 'node_modules/three/build/three.module.js');
  return `import * as RealThree from ${JSON.stringify(threePath)};
export * from ${JSON.stringify(threePath)};
const controllers = [new RealThree.Group(), new RealThree.Group()];
const hands = controllers.map((controller) => {
  const hand = new RealThree.Group();
  hand.joints = {};
  hand.inputState = { pinching: false };
  hand.visible = false;
  controller.addEventListener('connected', (event) => {
    hand.visible = Boolean(event.data?.hand);
    for (const joint of event.data?.hand?.values() ?? []) {
      const node = new RealThree.Group();
      node.jointRadius = 0.008;
      node.visible = false;
      hand.joints[joint.jointName] = node;
      hand.add(node);
    }
    hand.dispatchEvent({ type: event.type, data: event.data });
  });
  controller.addEventListener('disconnected', (event) => {
    hand.visible = false;
    hand.dispatchEvent({ type: event.type, data: event.data });
  });
  return hand;
});
const headCamera = new RealThree.PerspectiveCamera(58, 1, 0.01, 100);
headCamera.position.set(0, 1.6, 0.1);
headCamera.lookAt(0, 1.5, -1.5);
const listeners = new Map();
let activeXR = null;
const session = {
  addEventListener(type, listener) { const list = listeners.get(type) ?? []; list.push(listener); listeners.set(type, list); },
  removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)); },
  requestReferenceSpace: async () => ({}),
  end: async () => { if (activeXR) activeXR.isPresenting = false; for (const listener of listeners.get('end') ?? []) listener(); },
};
Object.defineProperty(navigator, 'xr', { configurable: true, value: { requestSession: async () => session } });
window.__questThree = RealThree;
window.__questHands = hands;
const OriginalRenderer = RealThree.WebGLRenderer;
export class WebGLRenderer extends OriginalRenderer {
  constructor(parameters) {
    super(parameters);
    const renderer = this;
    window.__questRenderer = renderer;
    const originalXR = renderer.xr;
    const originalRender = renderer.render.bind(renderer);
    const originalSetSize = renderer.setSize.bind(renderer);
    let animationFrame = 0;
    const fakeXR = {
      enabled: true,
      isPresenting: false,
      getCamera: () => headCamera,
      getController: (index) => controllers[index] ?? controllers[0],
      getHand: (index) => hands[index],
      setReferenceSpaceType: (...args) => originalXR.setReferenceSpaceType(...args),
      setSession: async (nextSession) => { activeXR = fakeXR; fakeXR.isPresenting = true; await nextSession.requestReferenceSpace?.('local-floor'); },
    };
    renderer.xr = fakeXR;
    renderer.setAnimationLoop = (callback) => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (!callback) return;
      const tick = (time) => { const start = performance.now(); callback(time); window.__questAfterFrame?.(time, performance.now() - start); animationFrame = requestAnimationFrame(tick); };
      animationFrame = requestAnimationFrame(tick);
    };
    renderer.setSize = (width, height, updateStyle) => { headCamera.aspect = width / Math.max(1, height); headCamera.updateProjectionMatrix(); return originalSetSize(width, height, updateStyle); };
    renderer.render = (scene, camera) => { window.__questScene = scene; window.__questControllers = controllers; window.__questCamera = headCamera; renderer.xr = originalXR; originalRender(scene, fakeXR.isPresenting ? headCamera : camera); renderer.xr = fakeXR; };
  }
}
`;
}

export function prepareQuestFixture(testRoot: string): void {
  const root = resolve(testRoot);
  mkdirSync(root, { recursive: true });
  const sceneSourcePath = join(repoRoot, 'src/xr/scene.ts');
  const mainSourcePath = join(repoRoot, 'src/main.ts');
  const shimPath = join(root, 'quest-three-shim.js');
  const sceneCopyPath = join(root, 'quest-scene.ts');
  const entryPath = join(root, 'xr-entry.ts');
  const mainCopyPath = join(root, 'quest-main.ts');
  writeFileSync(shimPath, threeShimSource());
  const sceneSource = readFileSync(sceneSourcePath, 'utf8')
    .replace(/from\s+(["'])three\1/, `from ${JSON.stringify(shimPath)}`)
    // The copy lives outside the repo, so bare imports cannot resolve from it; three goes through
    // the shim and the workspace package through its entry file.
    .replace(
      /from\s+(["'])@par\/xr-workspace\1/g,
      `from ${JSON.stringify(join(repoRoot, 'packages/xr-workspace/src/index.ts'))}`,
    )
    .replace(
      /from\s+(["'])(three\/[^"']+)\1/g,
      (_match, _quote: string, specifier: string) =>
        `from ${JSON.stringify(join(repoRoot, 'node_modules', specifier))}`,
    );
  writeFileSync(sceneCopyPath, absoluteImport(sceneSource, sceneSourcePath, new Map()));
  writeFileSync(
    entryPath,
    `export { createWorkspaceScene } from ${JSON.stringify(sceneCopyPath)};\n`,
  );
  // ARC-009 moved composition into src/app.ts, so the shimmed scene copy must replace the module
  // the app actually loads: rewrite './xr' in a quest-app.ts copy, then point quest-main.ts at it.
  const appSourcePath = join(repoRoot, 'src/app.ts');
  const appCopyPath = join(root, 'quest-app.ts');
  writeFileSync(
    appCopyPath,
    absoluteImport(
      readFileSync(appSourcePath, 'utf8'),
      appSourcePath,
      new Map([['./xr', entryPath]]),
    ),
  );
  // Glue runs before createApp() in the copied main module, so it is prepended, and it fills the
  // lets the checks append references to (scene, surfaces, speechInput, selectPane,
  // createDemoSurface) from the app.ts seam hook.
  const glue = `let scene;
let surfaces;
let speechInput;
let selectPane;
let createDemoSurface;
window.__muxXrFixtureHook = (seam) => {
  scene = seam.scene;
  surfaces = seam.surfaces;
  speechInput = seam.speechInput;
  selectPane = seam.selectPane;
  createDemoSurface = seam.createDemoSurface;
};
`;
  writeFileSync(
    mainCopyPath,
    glue +
      absoluteImport(
        readFileSync(mainSourcePath, 'utf8'),
        mainSourcePath,
        new Map([['./app', appCopyPath]]),
      ),
  );
  const bun = 'bun';
  try {
    execFileSync(bun, ['build', mainCopyPath, '--target', 'browser', '--outdir', root], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'stdout' in error
        ? `${String(error.stdout)}\n${String((error as { stderr?: unknown }).stderr ?? '')}`
        : String(error);
    throw new Error(`Bun quest fixture build failed:\n${detail}`);
  }
  const stylesheet = join(root, 'quest-main.css');
  if (!existsSync(stylesheet)) throw new Error('Quest fixture stylesheet was not emitted');
  writeFileSync(
    join(root, '__quest-controls.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./quest-main.css"></head><body><main id="app"></main><script type="module" src="./quest-main.js"></script></body></html>',
  );
}
