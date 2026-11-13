import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { linearLuminance, tintToLuminance } from '../src/xr/accent-colors';
import {
  AURORA_TUNDRA_FLOOR_Y,
  AURORA_TUNDRA_FOLD_AMPLITUDE,
  AURORA_TUNDRA_PERIOD,
  AURORA_TUNDRA_PRIMARY,
  AURORA_TUNDRA_SECONDARY,
  AURORA_TUNDRA_SNOW_COUNT,
  AURORA_TUNDRA_SNOW_FRONT_CLEARANCE,
  createAuroraTundraEnvironment,
} from '../src/xr/environments/aurora-tundra';

const CAMERA_FAR = 100;
const EYE_HEIGHT = 1.6;
// The desert-night moon disc, the brightest emitter any environment may show.
const MOON_DISC = new THREE.Color().setRGB(160 / 255, 157 / 255, 147 / 255, THREE.SRGBColorSpace);

type Environment = ReturnType<typeof createAuroraTundraEnvironment>;
type Drawable = THREE.Mesh | THREE.Points;

function drawables(root: THREE.Object3D): Drawable[] {
  const found: Drawable[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) found.push(object);
  });
  return found;
}

function worldPositions(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const values: number[] = [];
  const vertex = new THREE.Vector3();
  for (const object of drawables(root)) {
    const attribute = object.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1) {
      vertex.fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld);
      values.push(vertex.x, vertex.y, vertex.z);
    }
  }
  return values;
}

function azimuthDegrees(x: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(x, -z));
}

function elevationDegrees(x: number, y: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(y - EYE_HEIGHT, Math.hypot(x, z)));
}

function aurora(environment: Environment): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  return environment.root.getObjectByName('aurora-tundra-aurora') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
}

function snowPositions(environment: Environment): Float32Array {
  const snow = environment.root.getObjectByName('aurora-tundra-snow') as THREE.Points;
  return Float32Array.from(snow.geometry.getAttribute('position').array as Float32Array);
}

function auroraTime(environment: Environment): number {
  return aurora(environment).userData.auroraTime as number;
}

function ownedResources(root: THREE.Object3D): {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
} {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const object of drawables(root)) {
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      if (material instanceof THREE.ShaderMaterial)
        for (const uniform of Object.values(material.uniforms))
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
    }
  }
  return { geometries, materials, textures };
}

describe('aurora tundra environment', () => {
  it('names every part, is deterministic, finite and inside the camera far plane', () => {
    const first = createAuroraTundraEnvironment();
    const second = createAuroraTundraEnvironment();
    expect(first.root.name).toBe('aurora-tundra-environment');
    for (const name of [
      'aurora-tundra-sky',
      'aurora-tundra-stars',
      'aurora-tundra-aurora',
      'aurora-tundra-hills',
      'aurora-tundra-floor',
      'aurora-tundra-snow',
    ])
      expect(first.root.getObjectByName(name)).toBeDefined();
    const values = worldPositions(first.root);
    expect(values).toEqual(worldPositions(second.root));
    expect(values.every(Number.isFinite)).toBe(true);
    let maximum = 0;
    for (let index = 0; index < values.length; index += 3)
      maximum = Math.max(maximum, Math.hypot(values[index], values[index + 1], values[index + 2]));
    expect(maximum + AURORA_TUNDRA_FOLD_AMPLITUDE).toBeLessThan(CAMERA_FAR * 0.9);
    first.dispose();
    second.dispose();
  });

  it('stays within the draw-call budget with procedural textures only', () => {
    const environment = createAuroraTundraEnvironment();
    expect(drawables(environment.root).length).toBeLessThanOrEqual(6);
    const { textures } = ownedResources(environment.root);
    expect(textures.size).toBeGreaterThan(0);
    for (const texture of textures) expect(texture).toBeInstanceOf(THREE.DataTexture);
    environment.dispose();
  });

  it('places the walkable snow at floorY', () => {
    const environment = createAuroraTundraEnvironment();
    expect(environment.floorY).toBe(0.035);
    expect(AURORA_TUNDRA_FLOOR_Y).toBe(0.035);
    const floor = environment.root.getObjectByName('aurora-tundra-floor') as THREE.Mesh;
    const position = floor.geometry.getAttribute('position');
    let near = 0;
    for (let index = 0; index < position.count; index += 1) {
      if (Math.hypot(position.getX(index), position.getZ(index)) > 15) continue;
      near += 1;
      expect(position.getY(index)).toBeCloseTo(environment.floorY, 6);
    }
    expect(near).toBeGreaterThan(0);
    environment.dispose();
  });

  it('keeps the snow floor muted rather than white', () => {
    const environment = createAuroraTundraEnvironment();
    const floor = environment.root.getObjectByName('aurora-tundra-floor') as THREE.Mesh;
    const colors = floor.geometry.getAttribute('color');
    const color = new THREE.Color();
    for (let index = 0; index < colors.count; index += 1) {
      color.fromBufferAttribute(colors, index);
      expect(linearLuminance(color)).toBeLessThan(0.04);
      expect(color.b).toBeGreaterThan(color.r);
    }
    environment.dispose();
  });

  it('keeps hills low inside the pane sector', () => {
    const environment = createAuroraTundraEnvironment();
    const hills = environment.root.getObjectByName('aurora-tundra-hills') as THREE.Mesh;
    const position = hills.geometry.getAttribute('position');
    let sampled = 0;
    let frontMaximum = Number.NEGATIVE_INFINITY;
    let overallMaximum = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      const elevation = elevationDegrees(x, y, z);
      overallMaximum = Math.max(overallMaximum, elevation);
      if (Math.abs(azimuthDegrees(x, z)) > 60) continue;
      sampled += 1;
      frontMaximum = Math.max(frontMaximum, elevation);
    }
    expect(sampled).toBeGreaterThan(100);
    expect(frontMaximum).toBeLessThan(2);
    expect(overallMaximum).toBeLessThan(8);
    environment.dispose();
  });

  it('keeps the aurora above the panes in the front ±75°, low enough to see, and the snow beyond them', () => {
    const environment = createAuroraTundraEnvironment();
    const position = aurora(environment).geometry.getAttribute('position');
    let front = 0;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      // A fold moves a vertex radially by up to the amplitude; test the worst case outward.
      const scale = (Math.hypot(x, z) + AURORA_TUNDRA_FOLD_AMPLITUDE) / Math.hypot(x, z);
      const elevation = elevationDegrees(x * scale, y, z * scale);
      expect(elevation).toBeGreaterThan(12);
      if (Math.abs(azimuthDegrees(x, z)) >= 75) continue;
      front += 1;
      expect(elevation).toBeGreaterThan(24);
    }
    expect(front).toBeGreaterThan(0);
    for (let frame = 0; frame < 720; frame += 1) {
      environment.update(0.25);
      const snow = snowPositions(environment);
      for (let index = 0; index < snow.length; index += 3) {
        const x = snow[index];
        const z = snow[index + 2];
        const radius = Math.hypot(x, z);
        expect(radius).toBeGreaterThan(1.5);
        expect(radius).toBeLessThan(12);
        if (Math.abs(azimuthDegrees(x, z)) < 75)
          expect(radius).toBeGreaterThan(AURORA_TUNDRA_SNOW_FRONT_CLEARANCE);
      }
    }
    environment.dispose();
  });

  it('caps aurora brightness under the desert moon even where a fold overlaps itself', () => {
    const moon = linearLuminance(MOON_DISC);
    for (const accent of [null, new THREE.Color(0xff2020), new THREE.Color(0x2040ff)]) {
      const environment = createAuroraTundraEnvironment(accent);
      const uniforms = aurora(environment).material.uniforms;
      for (const band of [
        uniforms.uPrimary.value,
        uniforms.uSecondary.value,
        uniforms.uCrown.value,
      ])
        expect(linearLuminance(band as THREE.Color) * 2).toBeLessThanOrEqual(moon);
      environment.update(0.25);
      const breath = uniforms.uBreath.value as THREE.Vector3;
      for (const value of [breath.x, breath.y, breath.z]) expect(value).toBeLessThanOrEqual(1);
      environment.dispose();
    }
  });

  it('retints only the primary band with the accent and keeps its luminance', () => {
    const authored = createAuroraTundraEnvironment(null);
    const authoredUniforms = aurora(authored).material.uniforms;
    expect((authoredUniforms.uPrimary.value as THREE.Color).getHex()).toBe(
      AURORA_TUNDRA_PRIMARY.getHex(),
    );
    expect((authoredUniforms.uSecondary.value as THREE.Color).getHex()).toBe(
      AURORA_TUNDRA_SECONDARY.getHex(),
    );
    const red = new THREE.Color(0xff3030);
    const tinted = createAuroraTundraEnvironment(red);
    const uniforms = aurora(tinted).material.uniforms;
    const primary = uniforms.uPrimary.value as THREE.Color;
    const expected = tintToLuminance(new THREE.Color(), AURORA_TUNDRA_PRIMARY, red);
    expect(primary.r).toBeCloseTo(expected.r, 10);
    expect(primary.g).toBeCloseTo(expected.g, 10);
    expect(primary.b).toBeCloseTo(expected.b, 10);
    expect(primary.r).toBeGreaterThan(primary.g);
    expect(linearLuminance(primary)).toBeCloseTo(linearLuminance(AURORA_TUNDRA_PRIMARY), 6);
    expect((uniforms.uSecondary.value as THREE.Color).getHex()).toBe(
      AURORA_TUNDRA_SECONDARY.getHex(),
    );
    expect(AURORA_TUNDRA_PRIMARY.getHex()).toBe(0x1d7f4f);
    authored.dispose();
    tinted.dispose();
  });

  it('ships fp16-safe, dithered shaders with ordered smoothstep edges', () => {
    const environment = createAuroraTundraEnvironment();
    const material = aurora(environment).material;
    expect(material.dithering).toBe(true);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    const fragment = material.fragmentShader;
    const both = `${material.vertexShader}\n${fragment}`;
    expect(fragment).toMatch(/#include <common>\s*\n#include <dithering_pars_fragment>/);
    expect(fragment).toContain('#include <colorspace_fragment>');
    expect(fragment).toContain('#include <dithering_fragment>');
    expect(both).not.toMatch(/\b(for|while)\s*\(/);
    expect(both).not.toMatch(/uniform\s+float\s+uTime/);
    for (const match of both.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g))
      expect(Number(match[1])).toBeLessThan(Number(match[2]));
    for (const name of both.matchAll(/uniform\s+\w+\s+(\w+);/g))
      expect(material.uniforms[name[1]]).toBeDefined();
    for (const name of Object.keys(material.uniforms)) expect(both).toContain(name);
    for (const object of drawables(environment.root)) {
      const each = object.material as THREE.Material;
      if (each instanceof THREE.MeshBasicMaterial) {
        expect(each.fog).toBe(false);
        expect(each.dithering).toBe(true);
      }
    }
    environment.dispose();
  });

  it('advances the aurora and snow, wraps the period and keeps phases bounded', () => {
    const environment = createAuroraTundraEnvironment();
    const uniforms = aurora(environment).material.uniforms;
    const foldA = uniforms.uFoldA.value as THREE.Vector2;
    const startSnow = snowPositions(environment);
    environment.update(0.2);
    expect(auroraTime(environment)).toBeCloseTo(0.2, 10);
    const phase = (Math.PI * 2 * 0.2) / AURORA_TUNDRA_PERIOD;
    expect(foldA.x).toBeCloseTo(Math.cos(phase * 3), 10);
    expect(foldA.y).toBeCloseTo(Math.sin(phase * 3), 10);
    const movedSnow = snowPositions(environment);
    let fell = 0;
    for (let index = 1; index < movedSnow.length; index += 3) {
      const drop = startSnow[index] - movedSnow[index];
      if (drop < 0) continue;
      fell += 1;
      expect(drop / 0.2).toBeGreaterThanOrEqual(0.3 - 1e-4);
      expect(drop / 0.2).toBeLessThanOrEqual(0.6 + 1e-4);
    }
    expect(fell).toBeGreaterThan(AURORA_TUNDRA_SNOW_COUNT * 0.9);
    for (let index = 0; index < AURORA_TUNDRA_PERIOD * 4 * 3; index += 1) environment.update(0.25);
    const wrapped = auroraTime(environment);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(AURORA_TUNDRA_PERIOD);
    expect(wrapped).toBeCloseTo(0.2, 6);
    for (const name of ['uFoldA', 'uFoldB', 'uRays']) {
      const value = uniforms[name].value as THREE.Vector2;
      expect(value.length()).toBeCloseTo(1, 6);
    }
    const breath = uniforms.uBreath.value as THREE.Vector3;
    for (const value of [breath.x, breath.y, breath.z]) {
      expect(value).toBeGreaterThanOrEqual(0.6);
      expect(value).toBeLessThanOrEqual(1);
    }
    const snow = snowPositions(environment);
    for (let index = 1; index < snow.length; index += 3) {
      expect(snow[index]).toBeGreaterThanOrEqual(AURORA_TUNDRA_FLOOR_Y);
      expect(snow[index]).toBeLessThan(8);
    }
    environment.dispose();
  });

  it('ignores bad deltas, clamps large ones and pauses while hidden', () => {
    const environment = createAuroraTundraEnvironment();
    const before = snowPositions(environment);
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) environment.update(delta);
    expect(auroraTime(environment)).toBe(0);
    expect(snowPositions(environment)).toEqual(before);
    environment.root.visible = false;
    environment.update(0.1);
    expect(auroraTime(environment)).toBe(0);
    environment.root.visible = true;
    environment.update(1e9);
    expect(auroraTime(environment)).toBeCloseTo(0.25, 10);
    environment.dispose();
  });

  it('disposes every geometry, material and texture once, detaches, and stops updating', () => {
    const environment = createAuroraTundraEnvironment();
    const parent = new THREE.Group();
    parent.add(environment.root);
    const { geometries, materials, textures } = ownedResources(environment.root);
    expect(geometries.size).toBe(6);
    expect(materials.size).toBe(6);
    expect(textures.size).toBe(2);
    const spies = [...geometries, ...materials, ...textures].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    environment.dispose();
    environment.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(environment.root.parent).toBeNull();
    environment.update(0.1);
    expect(auroraTime(environment)).toBe(0);
  });
});
