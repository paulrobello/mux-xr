import * as THREE from 'three';
import type { BackgroundMode } from '../src/contracts';
import { ENVIRONMENT_FACTORIES, loadObservatory } from '../src/environment';
import type { WorkspaceScene } from '../src/xr';
import { createGradientTexture } from '../src/xr/scene';

const WIDTH = 480;
const HEIGHT = 270;
const SETTLE_SECONDS = 6;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT);
document.body.append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(58, WIDTH / HEIGHT, 0.01, 200);
camera.position.set(0, 1.6, 0);
/** Degrees from facing -Z; a background whose life is above, behind or below is framed there. */
const VIEWS: Partial<Record<BackgroundMode, { yaw: number; pitch: number }>> = {
  aurora: { yaw: 180, pitch: 14 },
  rooftop: { yaw: 180, pitch: 2 },
  summit: { yaw: 175, pitch: 4 },
  koi: { yaw: 150, pitch: -24 },
};

function aim(mode: BackgroundMode): void {
  const { yaw, pitch } = VIEWS[mode] ?? { yaw: 0, pitch: 6 };
  camera.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
}

function freshScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a10);
  const key = new THREE.DirectionalLight(0xb8dfff, 1.2);
  key.position.set(-2, 4, 4);
  scene.add(new THREE.AmbientLight(0x9db5c8, 0.7), key);
  return scene;
}

function capture(scene: THREE.Scene): string {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/webp', 0.86);
}

async function renderObservatory(): Promise<string> {
  const scene = freshScene();
  const workspace = {
    scene,
    state: { background: 'observatory', xrMode: 'vr', accentColor: '', environmentAccentColor: '' },
    subscribe: () => () => undefined,
  } as unknown as WorkspaceScene;
  const dispose = await loadObservatory(workspace);
  for (let frame = 0; frame < 60 && !scene.getObjectByName('authored-observatory'); frame += 1)
    await new Promise((resolve) => setTimeout(resolve, 50));
  (scene.userData.updateEnvironment as ((delta: number) => void) | undefined)?.(SETTLE_SECONDS);
  const image = capture(scene);
  dispose();
  return image;
}

async function render(mode: BackgroundMode): Promise<string> {
  aim(mode);
  if (mode === 'observatory') return renderObservatory();
  const scene = freshScene();
  if (mode === 'black') scene.background = new THREE.Color(0x000000);
  if (mode === 'gradient') scene.background = createGradientTexture();
  const factory = ENVIRONMENT_FACTORIES[mode];
  const environment = factory?.(null);
  if (environment) {
    scene.add(environment.root);
    for (let step = 0; step < SETTLE_SECONDS * 10; step += 1) environment.update(0.1);
  }
  const image = capture(scene);
  environment?.dispose();
  if (scene.background instanceof THREE.Texture) scene.background.dispose();
  return image;
}

function rendererName(): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(
    info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
}

Object.assign(window, { __backgroundThumbnails: { render, rendererName } });
