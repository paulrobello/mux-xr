import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { linearLuminance } from '../src/xr/accent-colors';
import {
  createRainRooftopEnvironment,
  RAIN_ROOFTOP_BEACON_COUNT,
  RAIN_ROOFTOP_BEACON_PERIOD,
  RAIN_ROOFTOP_CANOPY_HALF,
  RAIN_ROOFTOP_DYNAMIC_FRACTION,
  RAIN_ROOFTOP_FLOOR_HALF,
  RAIN_ROOFTOP_FLOOR_Y,
  RAIN_ROOFTOP_PERIOD,
  RAIN_ROOFTOP_PILLARS,
  RAIN_ROOFTOP_RAIN_COUNT,
  RAIN_ROOFTOP_RAIN_MARGIN,
  RAIN_ROOFTOP_RAIN_MIN_RADIUS,
  RAIN_ROOFTOP_TRIM_COLOR,
  RAIN_ROOFTOP_WINDOW_COLUMN,
  RAIN_ROOFTOP_WINDOW_FLOOR,
  rainRooftopTowers,
} from '../src/xr/environments/rain-rooftop';

const CAMERA_FAR = 100;
const EYE_HEIGHT = 1.6;
// The desert moon disc, sRGB (160, 157, 147), is the brightest emitter any environment may show.
const MOON_LUMINANCE = linearLuminance(
  new THREE.Color().setRGB(160 / 255, 157 / 255, 147 / 255, THREE.SRGBColorSpace),
);

type Drawable = THREE.Mesh | THREE.Points | THREE.LineSegments;
type Environment = ReturnType<typeof createRainRooftopEnvironment>;

function drawables(root: THREE.Object3D): Drawable[] {
  const found: Drawable[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.LineSegments
    )
      found.push(object);
  });
  return found;
}

function named<T extends Drawable>(environment: Environment, name: string): T {
  const object = environment.root.getObjectByName(name);
  expect(object, name).toBeDefined();
  return object as T;
}

function worldPoints(object: Drawable): THREE.Vector3[] {
  object.updateWorldMatrix(true, false);
  const attribute = object.geometry.getAttribute('position');
  return Array.from({ length: attribute.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld),
  );
}

function azimuthDegrees(x: number, z: number): number {
  return THREE.MathUtils.radToDeg(Math.atan2(x, -z));
}

function shader(environment: Environment, name: string): THREE.ShaderMaterial {
  return named<THREE.Mesh>(environment, name).material as THREE.ShaderMaterial;
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

const NAMES = [
  'rain-rooftop-sky',
  'rain-rooftop-city-ground',
  'rain-rooftop-skyline',
  'rain-rooftop-beacons',
  'rain-rooftop-traffic',
  'rain-rooftop-rain',
  'rain-rooftop-floor',
  'rain-rooftop-structure',
  'rain-rooftop-neon-trim',
];

describe('rain rooftop environment', () => {
  it('builds every named part deterministically within the camera far plane', () => {
    const first = createRainRooftopEnvironment();
    const second = createRainRooftopEnvironment();
    expect(first.root.name).toBe('rain-rooftop-environment');
    for (const name of NAMES) named(first, name);
    const flatten = (environment: Environment): number[] =>
      drawables(environment.root).flatMap((object) =>
        worldPoints(object).flatMap((point) => point.toArray()),
      );
    const values = flatten(first);
    expect(values).toEqual(flatten(second));
    expect(values.every(Number.isFinite)).toBe(true);
    let maximum = 0;
    for (let index = 0; index < values.length; index += 3)
      maximum = Math.max(maximum, Math.hypot(values[index], values[index + 1], values[index + 2]));
    expect(maximum).toBeLessThan(CAMERA_FAR * 0.9);
    first.dispose();
    second.dispose();
  });

  it('stays within the draw-call budget with only generated textures', () => {
    const environment = createRainRooftopEnvironment();
    expect(drawables(environment.root).length).toBeLessThanOrEqual(10);
    for (const texture of ownedResources(environment.root).textures)
      expect(texture).toBeInstanceOf(THREE.DataTexture);
    environment.dispose();
  });

  it('places the terrace floor at floorY and about 7 m across', () => {
    const environment = createRainRooftopEnvironment();
    expect(environment.floorY).toBe(0.035);
    expect(RAIN_ROOFTOP_FLOOR_Y).toBe(0.035);
    const bounds = new THREE.Box3().setFromObject(named(environment, 'rain-rooftop-floor'));
    expect(bounds.min.y).toBeCloseTo(environment.floorY, 6);
    expect(bounds.max.y).toBeCloseTo(environment.floorY, 6);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(RAIN_ROOFTOP_FLOOR_HALF * 2, 6);
    expect(RAIN_ROOFTOP_FLOOR_HALF * 2).toBeGreaterThan(6);
    expect(RAIN_ROOFTOP_FLOOR_HALF * 2).toBeLessThan(8);
    environment.dispose();
  });

  it('keeps pillars out of the pane spread and the canopy overhead', () => {
    const environment = createRainRooftopEnvironment();
    for (const [x, z] of RAIN_ROOFTOP_PILLARS)
      expect(Math.abs(azimuthDegrees(x, z))).toBeGreaterThan(80);
    // Any triangle spanning from rail height to above 3 m is a pillar face.
    const points = worldPoints(named(environment, 'rain-rooftop-structure'));
    let checked = 0;
    for (let index = 0; index < points.length; index += 3) {
      const triangle = points.slice(index, index + 3);
      const low = Math.min(...triangle.map((point) => point.y));
      const high = Math.max(...triangle.map((point) => point.y));
      if (low > 1.2 || high < 3) continue;
      checked += 1;
      for (const point of triangle)
        expect(Math.abs(azimuthDegrees(point.x, point.z))).toBeGreaterThan(80);
    }
    expect(checked).toBe(RAIN_ROOFTOP_PILLARS.length * 8);
    const canopy = new THREE.Box3().setFromObject(named(environment, 'rain-rooftop-structure'));
    expect(canopy.max.y).toBeGreaterThan(3.3);
    expect(canopy.max.y).toBeLessThan(3.7);
    environment.dispose();
  });

  it('keeps towers in the pane sector low and dim, and beacons out of it', () => {
    const towers = rainRooftopTowers();
    const front = towers.filter((tower) => Math.abs(azimuthDegrees(tower.x, tower.z)) < 60);
    const rest = towers.filter((tower) => Math.abs(azimuthDegrees(tower.x, tower.z)) > 110);
    expect(front.length).toBeGreaterThan(5);
    for (const tower of front) {
      const distance = Math.hypot(tower.x, tower.z) - Math.max(tower.halfWidth, tower.halfDepth);
      const elevation = THREE.MathUtils.radToDeg(Math.atan2(tower.top - EYE_HEIGHT, distance));
      expect(elevation).toBeLessThan(2.5);
    }
    const tallest = (list: typeof towers): number => Math.max(...list.map((tower) => tower.top));
    expect(tallest(rest)).toBeGreaterThan(tallest(front) + 10);
    const environment = createRainRooftopEnvironment();
    const skyline = named<THREE.Mesh>(environment, 'rain-rooftop-skyline');
    const dims = skyline.geometry.getAttribute('aDim');
    const points = worldPoints(skyline);
    for (let index = 0; index < points.length; index += 1) {
      if (Math.abs(azimuthDegrees(points[index].x, points[index].z)) < 50)
        expect(dims.getX(index)).toBeLessThan(0.5);
    }
    const beacons = worldPoints(named(environment, 'rain-rooftop-beacons'));
    expect(beacons.length).toBeGreaterThan(0);
    for (const point of beacons)
      expect(Math.abs(azimuthDegrees(point.x, point.z))).toBeGreaterThan(90);
    environment.dispose();
  });

  it('keeps rain outside the covered area and past 5 m', () => {
    const environment = createRainRooftopEnvironment();
    const rain = named<THREE.LineSegments>(environment, 'rain-rooftop-rain');
    const points = worldPoints(rain);
    expect(points).toHaveLength(RAIN_ROOFTOP_RAIN_COUNT * 2);
    for (const point of points) {
      expect(Math.hypot(point.x, point.z)).toBeGreaterThanOrEqual(
        RAIN_ROOFTOP_RAIN_MIN_RADIUS - 1e-6,
      );
      expect(Math.max(Math.abs(point.x), Math.abs(point.z))).toBeGreaterThanOrEqual(
        RAIN_ROOFTOP_CANOPY_HALF + RAIN_ROOFTOP_RAIN_MARGIN - 1e-6,
      );
    }
    const strength = rain.geometry.getAttribute('aRain');
    let front = 0;
    let side = 0;
    let frontCount = 0;
    let sideCount = 0;
    for (let index = 0; index < points.length; index += 1) {
      const azimuth = Math.abs(azimuthDegrees(points[index].x, points[index].z));
      if (azimuth < 45) {
        front += strength.getZ(index);
        frontCount += 1;
      } else if (azimuth > 120) {
        side += strength.getZ(index);
        sideCount += 1;
      }
    }
    expect(front / frontCount).toBeLessThan((side / sideCount) * 0.4);
    environment.dispose();
  });

  it('switches only a few windows per second across the skyline', () => {
    let cells = 0;
    for (const tower of rainRooftopTowers()) {
      const floors = Math.floor((tower.top + 12 - 4) / RAIN_ROOFTOP_WINDOW_FLOOR);
      const columns =
        2 * Math.floor((tower.halfWidth * 2) / RAIN_ROOFTOP_WINDOW_COLUMN) +
        2 * Math.floor((tower.halfDepth * 2) / RAIN_ROOFTOP_WINDOW_COLUMN);
      cells += Math.max(0, floors) * columns;
    }
    const changesPerSecond = (cells * RAIN_ROOFTOP_DYNAMIC_FRACTION * 2) / RAIN_ROOFTOP_PERIOD;
    expect(changesPerSecond).toBeGreaterThan(2);
    expect(changesPerSecond).toBeLessThan(6);
  });

  it('ships dithered, loop-free shaders whose uniforms all exist and stay below the moon', () => {
    const environment = createRainRooftopEnvironment();
    const shaders = drawables(environment.root)
      .map((object) => object.material)
      .filter(
        (material): material is THREE.ShaderMaterial => material instanceof THREE.ShaderMaterial,
      );
    expect(shaders).toHaveLength(4);
    for (const material of shaders) {
      const source = `${material.vertexShader}\n${material.fragmentShader}`;
      expect(material.dithering).toBe(true);
      expect(material.fragmentShader).toMatch(
        /#include <common>\s*\n#include <dithering_pars_fragment>/,
      );
      expect(material.fragmentShader).toContain('#include <dithering_fragment>');
      expect(source).not.toMatch(/\b(for|while)\s*\(/);
      expect(source).not.toMatch(/\b(sin|cos)\s*\(\s*u[A-Z]/);
      for (const match of source.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g))
        expect(Number(match[1])).toBeLessThan(Number(match[2]));
      for (const name of source.matchAll(/uniform\s+\w+\s+(\w+);/g))
        expect(material.uniforms[name[1]], name[1]).toBeDefined();
      for (const name of Object.keys(material.uniforms)) expect(source).toContain(name);
      for (const uniform of Object.values(material.uniforms))
        if (uniform.value instanceof THREE.Color)
          expect(linearLuminance(uniform.value)).toBeLessThan(MOON_LUMINANCE);
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

  it('advances and wraps the shared clock, driving every animated uniform', () => {
    const environment = createRainRooftopEnvironment();
    const time = (): number => environment.root.userData.time as number;
    const windows = shader(environment, 'rain-rooftop-skyline').uniforms.uWindowPhase;
    const fall = shader(environment, 'rain-rooftop-rain').uniforms.uFall;
    const flow = shader(environment, 'rain-rooftop-traffic').uniforms.uFlow.value as THREE.Vector2;
    const pulse = shader(environment, 'rain-rooftop-beacons').uniforms.uPulse
      .value as THREE.Vector2;
    environment.root.visible = false;
    environment.update(1);
    expect(time()).toBe(0);
    environment.root.visible = true;
    environment.update(0.1);
    expect(time()).toBeCloseTo(0.1, 10);
    expect(windows.value).toBeGreaterThan(0);
    expect(fall.value).toBeGreaterThan(0);
    expect(flow.x).toBeGreaterThan(0);
    expect(flow.y).toBeGreaterThan(0);
    const beat = (Math.PI * 2 * 0.1) / RAIN_ROOFTOP_BEACON_PERIOD;
    expect(pulse.x).toBeCloseTo(Math.cos(beat), 10);
    expect(pulse.y).toBeCloseTo(Math.sin(beat), 10);
    environment.update(1e9);
    expect(time()).toBeCloseTo(0.35, 10);
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, -5, 0]) environment.update(bad);
    expect(time()).toBeCloseTo(0.35, 10);
    for (let index = 0; index < RAIN_ROOFTOP_PERIOD * 8; index += 1) environment.update(0.25);
    expect(time()).toBeGreaterThanOrEqual(0);
    expect(time()).toBeLessThan(RAIN_ROOFTOP_PERIOD);
    expect(time()).toBeCloseTo(0.35, 6);
    for (const value of [windows.value, fall.value, flow.x, flow.y]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(Math.hypot(pulse.x, pulse.y)).toBeCloseTo(1, 10);
    environment.dispose();
  });

  it('retints only the neon trim to the authored luminance and keeps it with null', () => {
    const authored = createRainRooftopEnvironment(null);
    const trim = (environment: Environment): THREE.MeshBasicMaterial =>
      named<THREE.Mesh>(environment, 'rain-rooftop-neon-trim').material as THREE.MeshBasicMaterial;
    expect(trim(authored).color.getHex()).toBe(RAIN_ROOFTOP_TRIM_COLOR);
    const red = createRainRooftopEnvironment(new THREE.Color(0xff2020));
    const tinted = trim(red).color;
    expect(tinted.r).toBeGreaterThan(tinted.g * 3);
    expect(linearLuminance(tinted)).toBeCloseTo(
      linearLuminance(new THREE.Color(RAIN_ROOFTOP_TRIM_COLOR)),
      6,
    );
    expect(linearLuminance(tinted)).toBeLessThan(MOON_LUMINANCE);
    const structure = (environment: Environment): THREE.MeshBasicMaterial =>
      named<THREE.Mesh>(environment, 'rain-rooftop-structure').material as THREE.MeshBasicMaterial;
    expect(structure(red).color.getHex()).toBe(structure(authored).color.getHex());
    authored.dispose();
    red.dispose();
  });

  it('places one beacon per chosen tower top', () => {
    const environment = createRainRooftopEnvironment();
    const beacons = named<THREE.Mesh>(environment, 'rain-rooftop-beacons');
    const offsets = beacons.geometry.getAttribute('aOffset');
    const distinct = new Set<string>();
    for (let index = 0; index < offsets.count; index += 1)
      distinct.add(`${offsets.getX(index).toFixed(6)},${offsets.getY(index).toFixed(6)}`);
    expect(distinct.size).toBeGreaterThan(1);
    expect(distinct.size).toBeLessThanOrEqual(RAIN_ROOFTOP_BEACON_COUNT);
    environment.dispose();
  });

  it('disposes every geometry, material and texture once, detaches, and stops updating', () => {
    const environment = createRainRooftopEnvironment();
    const parent = new THREE.Group();
    parent.add(environment.root);
    const { geometries, materials, textures } = ownedResources(environment.root);
    expect(geometries.size).toBe(NAMES.length);
    expect(materials.size).toBe(NAMES.length);
    expect(textures.size).toBeGreaterThan(0);
    const spies = [...geometries, ...materials, ...textures].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    environment.dispose();
    environment.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(environment.root.parent).toBeNull();
    environment.root.visible = true;
    environment.update(0.1);
    expect(environment.root.userData.time).toBe(0);
  });
});
