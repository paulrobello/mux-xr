import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUIEnvironment,
  createUIEnvironment,
  isSharedUIEnvironment,
  UI_ENV_MAP_INTENSITY,
} from '../src/xr/ui-environment';

interface FakeRenderer {
  xr: { enabled: boolean };
  autoClear: boolean;
  toneMapping: THREE.ToneMapping;
  getRenderTarget: () => THREE.WebGLRenderTarget | null;
  getActiveCubeFace: () => number;
  getActiveMipmapLevel: () => number;
  setRenderTarget: ReturnType<typeof vi.fn>;
  compile: ReturnType<typeof vi.fn>;
}

function fakeRenderer(): FakeRenderer {
  return {
    xr: { enabled: true },
    autoClear: true,
    toneMapping: THREE.NoToneMapping,
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn(),
    compile: vi.fn(),
  };
}

const asRenderer = (renderer: FakeRenderer): THREE.WebGLRenderer =>
  renderer as unknown as THREE.WebGLRenderer;

describe('shared UI environment', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives no env map and skips warm-up without a renderer', () => {
    const fromScene = vi.spyOn(THREE.PMREMGenerator.prototype, 'fromScene');
    const environment = createUIEnvironment(null);
    expect(environment.texture).toBeNull();
    const material = applyUIEnvironment(
      new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      environment.texture,
    );
    expect(material.envMap).toBeNull();
    expect(material.envMapIntensity).toBe(1);
    expect(() =>
      environment.warmPrograms(new THREE.Scene(), new THREE.PerspectiveCamera()),
    ).not.toThrow();
    expect(fromScene).not.toHaveBeenCalled();
    environment.dispose();
  });

  it('builds one tagged texture eagerly and disposes the generator', () => {
    const target = new THREE.WebGLRenderTarget(4, 4);
    const fromScene = vi
      .spyOn(THREE.PMREMGenerator.prototype, 'fromScene')
      .mockImplementation(() => target);
    const generatorDispose = vi
      .spyOn(THREE.PMREMGenerator.prototype, 'dispose')
      .mockImplementation(() => undefined);
    const renderer = fakeRenderer();
    const environment = createUIEnvironment(asRenderer(renderer));
    expect(fromScene).toHaveBeenCalledOnce();
    expect(fromScene.mock.calls[0]?.[0]).toBeInstanceOf(THREE.Scene);
    expect(generatorDispose).toHaveBeenCalledOnce();
    expect(environment.texture).toBe(target.texture);
    expect(environment.texture).toBe(environment.texture);
    expect(fromScene).toHaveBeenCalledOnce();
    expect(isSharedUIEnvironment(environment.texture)).toBe(true);
    expect(isSharedUIEnvironment(new THREE.Texture())).toBe(false);
    expect(isSharedUIEnvironment(null)).toBe(false);
    expect(renderer.xr.enabled).toBe(true);

    const material = applyUIEnvironment(new THREE.MeshStandardMaterial(), environment.texture);
    expect(material.envMap).toBe(target.texture);
    expect(material.envMapIntensity).toBe(UI_ENV_MAP_INTENSITY);
    expect(UI_ENV_MAP_INTENSITY).toBeGreaterThanOrEqual(0.3);
    expect(UI_ENV_MAP_INTENSITY).toBeLessThanOrEqual(0.5);

    const targetDispose = vi.spyOn(target, 'dispose');
    environment.dispose();
    expect(targetDispose).toHaveBeenCalledOnce();
    expect(environment.texture).toBeNull();
  });

  it('restores XR and render-target state and warns when generation fails', () => {
    const previousTarget = new THREE.WebGLRenderTarget(2, 2);
    const renderer = fakeRenderer();
    renderer.getRenderTarget = () => previousTarget;
    renderer.getActiveCubeFace = () => 3;
    renderer.getActiveMipmapLevel = () => 1;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    vi.spyOn(THREE.PMREMGenerator.prototype, 'fromScene').mockImplementation(function (
      this: THREE.PMREMGenerator,
    ) {
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      renderer.toneMapping = THREE.NoToneMapping;
      throw new Error('context lost');
    });
    const generatorDispose = vi
      .spyOn(THREE.PMREMGenerator.prototype, 'dispose')
      .mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const environment = createUIEnvironment(asRenderer(renderer));
    expect(environment.texture).toBeNull();
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(previousTarget, 3, 1);
    expect(generatorDispose).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    environment.warmPrograms(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(renderer.compile).not.toHaveBeenCalled();
    expect(createUIEnvironment({} as THREE.WebGLRenderer).texture).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('warms each env-lit program variant once and keeps the materials until dispose', () => {
    const target = new THREE.WebGLRenderTarget(4, 4);
    vi.spyOn(THREE.PMREMGenerator.prototype, 'fromScene').mockImplementation(() => target);
    vi.spyOn(THREE.PMREMGenerator.prototype, 'dispose').mockImplementation(() => undefined);
    const renderer = fakeRenderer();
    const environment = createUIEnvironment(asRenderer(renderer));
    const geometryDispose = vi.spyOn(THREE.BoxGeometry.prototype, 'dispose');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    let warmed: THREE.MeshStandardMaterial[] = [];
    renderer.compile.mockImplementation((group: THREE.Object3D) => {
      warmed = group.children.map(
        (child) => (child as THREE.Mesh).material as THREE.MeshStandardMaterial,
      );
    });
    environment.warmPrograms(scene, camera);
    environment.warmPrograms(scene, camera);
    expect(renderer.compile).toHaveBeenCalledOnce();
    expect(renderer.compile.mock.calls[0]?.[1]).toBe(camera);
    expect(renderer.compile.mock.calls[0]?.[2]).toBe(scene);
    expect(warmed).toHaveLength(3);
    for (const material of warmed) expect(material.envMap).toBe(target.texture);
    expect(warmed.some((material) => material.flatShading)).toBe(true);
    expect(warmed.some((material) => material.side === THREE.DoubleSide)).toBe(true);
    expect(geometryDispose).toHaveBeenCalledOnce();
    const materialDisposals = warmed.map((material) => vi.spyOn(material, 'dispose'));
    for (const spy of materialDisposals) expect(spy).not.toHaveBeenCalled();
    environment.dispose();
    for (const spy of materialDisposals) expect(spy).toHaveBeenCalledOnce();
  });
});
