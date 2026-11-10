import * as THREE from 'three';
import {
  createCurvedTerminalGeometry,
  createTerminalFrameAccentGeometry,
  createTerminalFrameGeometry,
  type TerminalWarpSpan,
} from '../src/xr/terminal-warp';
import { applyUIEnvironment, createUIEnvironment } from '../src/xr/ui-environment';

interface FrameShot {
  width: number;
  height: number;
  degrees: number;
  chin: boolean;
  opacity?: number;
  /** Camera yaw around the pane in degrees, and where to aim, in pane units. */
  yaw?: number;
  pitch?: number;
  zoom?: 'pane' | 'corner' | 'chin';
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
document.body.append(renderer.domElement);
const environment = createUIEnvironment(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050a10);
scene.add(new THREE.AmbientLight(0x9db5c8, 0.7));
const key = new THREE.DirectionalLight(0xb8dfff, 1.2);
key.position.set(-2, 4, 4);
scene.add(key);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
let pane: THREE.Group | null = null;

const screenTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2d context missing');
  context.fillStyle = '#0b1118';
  context.fillRect(0, 0, 1024, 512);
  context.font = '20px monospace';
  for (let row = 0; row < 22; row += 1) {
    context.fillStyle = row % 5 === 0 ? '#68d6ff' : '#9fb3c8';
    context.fillText(`$ line ${String(row).padStart(2, '0')} ${'x'.repeat(70)}`, 2, 22 + row * 22);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};
const texture = screenTexture();

const show = (shot: FrameShot): void => {
  if (pane) {
    scene.remove(pane);
    pane.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }
  const span: TerminalWarpSpan = {
    width: shot.width,
    height: shot.height,
    radians: THREE.MathUtils.degToRad(shot.degrees),
  };
  const opacity = shot.opacity ?? 1;
  pane = new THREE.Group();
  const screen = new THREE.Mesh(
    span.radians
      ? createCurvedTerminalGeometry(span)
      : new THREE.PlaneGeometry(span.width, span.height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: opacity < 1, opacity }),
  );
  pane.add(screen);
  const frame = new THREE.Mesh(
    createTerminalFrameGeometry(span, { chin: shot.chin }),
    applyUIEnvironment(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.35,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        depthWrite: opacity >= 1,
        opacity,
      }),
      environment.texture,
    ),
  );
  frame.position.z = -0.025;
  const accent = new THREE.Mesh(
    createTerminalFrameAccentGeometry(span, { chin: shot.chin }),
    new THREE.MeshBasicMaterial({
      color: 0x68d6ff,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
    }),
  );
  frame.add(accent);
  pane.add(frame);
  scene.add(pane);
  const aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = aspect;
  const zoom = shot.zoom ?? 'pane';
  const target = new THREE.Vector3();
  let distance: number;
  if (zoom === 'pane') {
    // Curved panes bring their edges toward the camera, so fit every vertex.
    const tanV = Math.tan(THREE.MathUtils.degToRad(20));
    const position = frame.geometry.getAttribute('position');
    const point = new THREE.Vector3();
    distance = 0;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index);
      const reach = Math.max(Math.abs(point.y + 0.02) / tanV, Math.abs(point.x) / (tanV * aspect));
      distance = Math.max(distance, point.z + reach * 1.08);
    }
    target.set(0, -0.02, 0);
  } else {
    frame.geometry.computeBoundingBox();
    const box = frame.geometry.boundingBox as THREE.Box3;
    target.set(box.min.x + 0.07, zoom === 'corner' ? box.max.y - 0.05 : box.min.y + 0.05, 0);
    // The frame's left edge sits forward of the centre on a curved pane.
    const edge = new THREE.Vector3();
    const position = frame.geometry.getAttribute('position');
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < position.count; index += 1) {
      edge.fromBufferAttribute(position, index);
      const gap = Math.abs(edge.x - target.x) + Math.abs(edge.y - target.y);
      if (gap < best) {
        best = gap;
        target.z = edge.z - 0.025;
      }
    }
    distance = 0.42;
  }
  const yaw = THREE.MathUtils.degToRad(shot.yaw ?? 0);
  const pitch = THREE.MathUtils.degToRad(shot.pitch ?? 0);
  camera.position.set(
    target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    target.y + Math.sin(pitch) * distance,
    target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
};

const rendererName = (): string => {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
};

Object.assign(window, { __frameSheet: { show, rendererName } });
