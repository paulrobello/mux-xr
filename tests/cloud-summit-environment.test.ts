import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { linearLuminance } from '../src/xr/accent-colors';
import {
  CLOUD_SUMMIT_BIRD_ARC_DEGREES,
  CLOUD_SUMMIT_BIRD_COUNT,
  CLOUD_SUMMIT_CLOUD_PERIOD,
  CLOUD_SUMMIT_FLOOR_Y,
  CLOUD_SUMMIT_SUN_AZIMUTH_DEGREES,
  type CloudSummitFlockState,
  createCloudSummitEnvironment,
} from '../src/xr/environments/cloud-summit';

const CAMERA_FAR = 100;
const EYE_HEIGHT = 1.6;
// Desert moon disc peak, the brightest authored element of any environment.
const MOON_PEAK_LINEAR = new THREE.Color(0xa09d93);

type Environment = ReturnType<typeof createCloudSummitEnvironment>;

function drawables(root: THREE.Object3D): (THREE.Mesh | THREE.Points)[] {
  const found: (THREE.Mesh | THREE.Points)[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) found.push(object);
  });
  return found;
}

function named<T extends THREE.Object3D>(environment: Environment, name: string): T {
  const object = environment.root.getObjectByName(name);
  expect(object, name).toBeDefined();
  return object as T;
}

function worldVertices(object: THREE.Mesh | THREE.Points): THREE.Vector3[] {
  object.updateMatrixWorld(true);
  const attribute = object.geometry.getAttribute('position');
  return Array.from({ length: attribute.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld),
  );
}

function azimuthDegrees(x: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(x, -z));
}

function cloudMaterial(environment: Environment): THREE.ShaderMaterial {
  return named<THREE.Mesh>(environment, 'cloud-summit-cloud-sea').material as THREE.ShaderMaterial;
}

function cloudTime(environment: Environment): number {
  return named<THREE.Mesh>(environment, 'cloud-summit-cloud-sea').userData.cloudTime as number;
}

function flock(environment: Environment): CloudSummitFlockState {
  return named<THREE.InstancedMesh>(environment, 'cloud-summit-birds').userData
    .flock as CloudSummitFlockState;
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

describe('cloud summit environment', () => {
  it('names and contains every part', () => {
    const environment = createCloudSummitEnvironment();
    expect(environment.root.name).toBe('cloud-summit-environment');
    for (const name of [
      'cloud-summit-sky',
      'cloud-summit-stars',
      'cloud-summit-cloud-sea',
      'cloud-summit-peaks',
      'cloud-summit-floor',
      'cloud-summit-rock',
      'cloud-summit-accents',
      'cloud-summit-birds',
    ])
      named(environment, name);
    environment.dispose();
  });

  it('is deterministic, finite, and stays within the camera far plane', () => {
    const first = createCloudSummitEnvironment();
    const second = createCloudSummitEnvironment();
    const a = drawables(first.root).flatMap(worldVertices);
    const b = drawables(second.root).flatMap(worldVertices);
    expect(a.map((v) => v.toArray())).toEqual(b.map((v) => v.toArray()));
    let maximum = 0;
    for (const vertex of a) {
      expect(Number.isFinite(vertex.x + vertex.y + vertex.z)).toBe(true);
      maximum = Math.max(maximum, vertex.length());
    }
    expect(maximum).toBeLessThan(CAMERA_FAR * 0.9);
    first.dispose();
    second.dispose();
  });

  it('keeps the draw-call budget and uses only generated textures', () => {
    const environment = createCloudSummitEnvironment();
    const drawn = drawables(environment.root);
    expect(drawn.length).toBeLessThanOrEqual(12);
    expect(drawn.length).toBe(8);
    const lines: THREE.Object3D[] = [];
    environment.root.traverse((object) => {
      if (object instanceof THREE.Line) lines.push(object);
    });
    expect(lines).toHaveLength(0);
    const birds = named<THREE.InstancedMesh>(environment, 'cloud-summit-birds');
    expect(birds).toBeInstanceOf(THREE.InstancedMesh);
    expect(birds.instanceMatrix.count).toBe(CLOUD_SUMMIT_BIRD_COUNT);
    for (const texture of ownedResources(environment.root).textures)
      expect(texture).toBeInstanceOf(THREE.DataTexture);
    environment.dispose();
  });

  it('places the floor surface at floorY', () => {
    const environment = createCloudSummitEnvironment();
    expect(environment.floorY).toBe(0.035);
    expect(CLOUD_SUMMIT_FLOOR_Y).toBe(0.035);
    const floor = named<THREE.Mesh>(environment, 'cloud-summit-floor');
    environment.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(floor);
    expect(bounds.max.y).toBeCloseTo(0.035, 6);
    expect(bounds.min.y).toBeCloseTo(0.035, 6);
    const radius = Math.max(bounds.max.x, -bounds.min.x, bounds.max.z, -bounds.min.z);
    expect(radius).toBeGreaterThan(4);
    expect(radius).toBeLessThan(5.2);
    environment.dispose();
  });

  it('keeps the pane sector low: rim stones short, peaks below the horizon, no accents', () => {
    const environment = createCloudSummitEnvironment();
    let frontRock = 0;
    for (const vertex of worldVertices(named(environment, 'cloud-summit-rock'))) {
      if (Math.abs(azimuthDegrees(vertex.x, vertex.z)) >= 75) continue;
      frontRock += 1;
      expect(vertex.y).toBeLessThan(0.3);
    }
    expect(frontRock).toBeGreaterThan(0);
    let frontPeaks = 0;
    for (const vertex of worldVertices(named(environment, 'cloud-summit-peaks'))) {
      const flat = Math.hypot(vertex.x, vertex.z);
      const elevation = THREE.MathUtils.radToDeg(Math.atan2(vertex.y - EYE_HEIGHT, flat));
      expect(elevation).toBeLessThan(5);
      if (Math.abs(azimuthDegrees(vertex.x, vertex.z)) >= 75) continue;
      frontPeaks += 1;
      expect(elevation).toBeLessThan(-4);
    }
    expect(frontPeaks).toBeGreaterThan(0);
    for (const vertex of worldVertices(named(environment, 'cloud-summit-accents')))
      expect(Math.abs(azimuthDegrees(vertex.x, vertex.z))).toBeGreaterThan(65);
    environment.dispose();
  });

  it('seats every rim light on a rim stone instead of in midair', () => {
    const environment = createCloudSummitEnvironment();
    const rock = worldVertices(named(environment, 'cloud-summit-rock'));
    const studs = worldVertices(named(environment, 'cloud-summit-accents')).filter(
      (vertex) => vertex.y > CLOUD_SUMMIT_FLOOR_Y + 0.02,
    );
    expect(studs.length).toBeGreaterThan(0);
    for (const vertex of studs) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const corner of rock) nearest = Math.min(nearest, corner.distanceTo(vertex));
      expect(nearest).toBeLessThan(0.05);
    }
    environment.dispose();
  });

  it('puts the sun behind the user and keeps stars near the zenith', () => {
    expect(Math.abs(CLOUD_SUMMIT_SUN_AZIMUTH_DEGREES)).toBeGreaterThan(90);
    const environment = createCloudSummitEnvironment();
    const sunDir = cloudMaterial(environment).uniforms.uSunDir.value as THREE.Vector3;
    expect(Math.abs(azimuthDegrees(sunDir.x, sunDir.z))).toBeGreaterThan(90);
    expect(sunDir.y).toBeLessThanOrEqual(0);
    const stars = named<THREE.Points>(environment, 'cloud-summit-stars');
    const vertices = worldVertices(stars);
    expect(vertices.length).toBeGreaterThan(50);
    expect(vertices.length).toBeLessThan(200);
    for (const vertex of vertices) expect(vertex.y / vertex.length()).toBeGreaterThan(0.75);
    const colors = stars.geometry.getAttribute('color');
    for (let index = 0; index < colors.count; index += 1)
      expect(Math.max(colors.getX(index), colors.getY(index), colors.getZ(index))).toBeLessThan(
        0.7,
      );
    environment.dispose();
  });

  it('authors no glow brighter than the desert moon', () => {
    const environment = createCloudSummitEnvironment();
    const limit = linearLuminance(MOON_PEAK_LINEAR);
    const sky = named<THREE.Mesh>(environment, 'cloud-summit-sky').material as THREE.ShaderMaterial;
    const warm = sky.uniforms.uWarm.value as THREE.Color;
    const glow = sky.uniforms.uGlow.value as THREE.Color;
    expect(linearLuminance(warm.clone().add(glow.clone().multiplyScalar(1.2)))).toBeLessThan(limit);
    const clouds = cloudMaterial(environment);
    const cloudPeak = (clouds.uniforms.uBody.value as THREE.Color)
      .clone()
      .add(clouds.uniforms.uLit.value as THREE.Color);
    expect(linearLuminance(cloudPeak)).toBeLessThan(limit);
    const accents = named<THREE.Mesh>(environment, 'cloud-summit-accents')
      .material as THREE.MeshBasicMaterial;
    expect(linearLuminance(accents.color)).toBeLessThan(limit * 0.3);
    environment.dispose();
  });

  it('ships fp16-safe, dithered, loop-free shaders with ordered smoothstep edges', () => {
    const environment = createCloudSummitEnvironment();
    const shaders = drawables(environment.root)
      .map((object) => object.material)
      .filter(
        (material): material is THREE.ShaderMaterial => material instanceof THREE.ShaderMaterial,
      );
    expect(shaders).toHaveLength(2);
    for (const material of shaders) {
      const source = material.fragmentShader;
      expect(material.dithering).toBe(true);
      expect(source).toMatch(/#include <common>\s*\n#include <dithering_pars_fragment>/);
      expect(source).toContain('#include <colorspace_fragment>');
      expect(source).toContain('#include <dithering_fragment>');
      expect(source).not.toMatch(/\b(for|while)\s*\(/);
      expect(source).not.toMatch(/uTime|fract\(\s*sin/);
      for (const match of source.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g))
        expect(Number(match[1])).toBeLessThan(Number(match[2]));
      for (const name of source.matchAll(/uniform\s+\w+\s+(\w+);/g))
        expect(material.uniforms[name[1]], name[1]).toBeDefined();
    }
    for (const object of drawables(environment.root)) {
      const material = object.material as THREE.Material;
      if (material instanceof THREE.MeshBasicMaterial) {
        expect(material.fog).toBe(false);
        expect(material.dithering).toBe(true);
      }
    }
    environment.dispose();
  });

  it('rolls the clouds, wraps the period, and clamps hostile deltas', () => {
    const environment = createCloudSummitEnvironment();
    environment.update(0.1);
    expect(cloudTime(environment)).toBeCloseTo(0.1, 10);
    environment.update(1e9);
    expect(cloudTime(environment)).toBeCloseTo(0.35, 10);
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, -5, 0]) environment.update(bad);
    expect(cloudTime(environment)).toBeCloseTo(0.35, 10);
    const uniforms = cloudMaterial(environment).uniforms;
    const before = (uniforms.uOffsetA.value as THREE.Vector2).clone();
    environment.update(0.25);
    expect((uniforms.uOffsetA.value as THREE.Vector2).equals(before)).toBe(false);
    for (let index = 0; index < CLOUD_SUMMIT_CLOUD_PERIOD * 8; index += 1) environment.update(0.25);
    const wrapped = cloudTime(environment);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(CLOUD_SUMMIT_CLOUD_PERIOD);
    expect(wrapped).toBeCloseTo(0.6, 6);
    for (const name of ['uOffsetA', 'uOffsetB', 'uOffsetC']) {
      const offset = uniforms[name].value as THREE.Vector2;
      for (const value of [offset.x, offset.y]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
    environment.root.visible = false;
    environment.update(0.25);
    expect(cloudTime(environment)).toBeCloseTo(0.6, 6);
    environment.dispose();
  });

  it('sends a slow flock of 3-5 birds through the rear arc every 30-90 s', () => {
    const environment = createCloudSummitEnvironment();
    const birds = named<THREE.InstancedMesh>(environment, 'cloud-summit-birds');
    expect(birds.visible).toBe(false);
    const starts: number[] = [];
    let seen = 0;
    let previousFlights = 0;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const lastAzimuth = new Map<number, number>();
    const step = 0.25;
    for (let tick = 0; tick < 600 / step; tick += 1) {
      environment.update(step);
      const state = flock(environment);
      if (state.flights !== previousFlights) {
        previousFlights = state.flights;
        starts.push(tick * step);
        lastAzimuth.clear();
        expect(state.size).toBeGreaterThanOrEqual(3);
        expect(state.size).toBeLessThanOrEqual(5);
      }
      expect(birds.visible).toBe(state.active);
      if (!state.active) continue;
      expect(birds.count).toBe(state.size);
      for (let index = 0; index < birds.count; index += 1) {
        birds.getMatrixAt(index, matrix);
        position.setFromMatrixPosition(matrix);
        const azimuth = azimuthDegrees(position.x, position.z);
        const rear = azimuth < 0 ? azimuth + 360 : azimuth;
        expect(rear).toBeGreaterThan(CLOUD_SUMMIT_BIRD_ARC_DEGREES[0] - 8);
        expect(rear).toBeLessThan(CLOUD_SUMMIT_BIRD_ARC_DEGREES[1] + 8);
        const elevation = THREE.MathUtils.radToDeg(
          Math.atan2(position.y - EYE_HEIGHT, Math.hypot(position.x, position.z)),
        );
        expect(elevation).toBeGreaterThan(0);
        expect(elevation).toBeLessThan(10);
        const previous = lastAzimuth.get(index);
        if (previous !== undefined) expect(Math.abs(rear - previous) / step).toBeLessThan(3);
        lastAzimuth.set(index, rear);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(starts.length).toBeGreaterThanOrEqual(6);
    expect(starts[0]).toBeLessThan(30);
    for (let index = 1; index < starts.length; index += 1) {
      const interval = starts[index] - starts[index - 1];
      expect(interval).toBeGreaterThanOrEqual(30 - step);
      expect(interval).toBeLessThanOrEqual(90 + step);
    }
    const replay = createCloudSummitEnvironment();
    for (let tick = 0; tick < 600 / step; tick += 1) replay.update(step);
    expect(flock(replay)).toEqual(flock(environment));
    replay.dispose();
    environment.dispose();
  });

  it('retints the accents to the authored luminance and keeps the cyan for null', () => {
    const plain = createCloudSummitEnvironment(null);
    const authored = (
      named<THREE.Mesh>(plain, 'cloud-summit-accents').material as THREE.MeshBasicMaterial
    ).color;
    expect(authored.getHex()).toBe(0x2a4c56);
    const red = createCloudSummitEnvironment(new THREE.Color(1, 0, 0));
    const tinted = (
      named<THREE.Mesh>(red, 'cloud-summit-accents').material as THREE.MeshBasicMaterial
    ).color;
    expect(tinted.r).toBeGreaterThan(0);
    expect(tinted.g).toBe(0);
    expect(tinted.b).toBe(0);
    expect(linearLuminance(tinted)).toBeCloseTo(linearLuminance(authored), 6);
    plain.dispose();
    red.dispose();
  });

  it('disposes every geometry, material, and texture once and stops updating', () => {
    const environment = createCloudSummitEnvironment();
    const parent = new THREE.Group();
    parent.add(environment.root);
    const { geometries, materials, textures } = ownedResources(environment.root);
    expect(geometries.size).toBe(8);
    expect(textures.size).toBe(3);
    const birds = named<THREE.InstancedMesh>(environment, 'cloud-summit-birds');
    const spies = [...geometries, ...materials, ...textures].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    const birdSpy = vi.spyOn(birds, 'dispose');
    environment.dispose();
    environment.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(birdSpy).toHaveBeenCalledTimes(1);
    expect(environment.root.parent).toBeNull();
    environment.update(0.1);
    expect(cloudTime(environment)).toBe(0);
  });
});
