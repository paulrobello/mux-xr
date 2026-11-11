import * as THREE from 'three';
import { createSpaceBackground } from '../space-background';

export interface HangarDeckEnvironment {
  root: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
  floorY: number;
}

export const HANGAR_DECK_FLOOR_Y = 0.035;
/** Panes anywhere within this horizontal radius of the origin stay inside the deck walls. */
export const HANGAR_DECK_PANE_SAFE_RADIUS = 6.5;

const HALF = 7.2;
const FAR_Z = -HALF;
const REAR_Z = HALF;
const CEILING_Y = 3.6;
const RIB_SPACING = 1.2;
const RIB_DEPTH = 0.3;
const COVE_INSET = HALF - 0.22;
const LOW_COVE_Y = 0.14;
const HIGH_COVE_Y = CEILING_Y - 0.28;
// Side windows sit between ribs, beyond 50 degrees of the forward pane field.
const WINDOW_NEAR_Z = -1.2;
const WINDOW_FAR_Z = -6;
const WINDOW_BOTTOM = 0.8;
const WINDOW_TOP = 2.6;
// A thin unbroken band on the far wall, about 10-13 degrees above eye level and +-32 degrees
// wide, so it clears the top edge of a pane at 1.8 m (about +9.5 degrees) instead of hiding
// behind it.
const BAND_HALF_WIDTH = 4.5;
const BAND_BOTTOM = 2.9;
const BAND_TOP = 3.28;
const SIDE_GLASS_OPACITY = 0.22;
const BAND_GLASS_OPACITY = 0.4;
const MAX_UPDATE_DELTA = 0.25;

type Rgb = readonly [number, number, number];

// Linear albedo; sRGB output lifts these, so the deck stays well below pane text brightness.
const HULL: Rgb = [0.034, 0.04, 0.048];
const HULL_DARK: Rgb = [0.018, 0.021, 0.026];
const PLATE: Rgb = [0.03, 0.034, 0.04];
const SUBFLOOR: Rgb = [0.0035, 0.004, 0.005];
const FRAME: Rgb = [0.024, 0.028, 0.034];
const SEAM: Rgb = [0.006, 0.007, 0.009];
const COVE_GLOW: Rgb = [0.035, 0.14, 0.17];
const SILL_GLOW: Rgb = [0.012, 0.045, 0.06];
const GUIDE_AMBER: Rgb = [0.05, 0.022, 0.006];
const STATUS_AMBER: Rgb = [0.2, 0.085, 0.02];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Baked indirect light: hidden coves along both side walls and a cool spill from the windows. */
function deckLight(point: THREE.Vector3, normal: THREE.Vector3): Rgb {
  let red = 0.2;
  let green = 0.21;
  let blue = 0.24;
  const windowSpan =
    smoothstep(WINDOW_FAR_Z - 1.2, WINDOW_FAR_Z + 0.6, point.z) *
    (1 - smoothstep(WINDOW_NEAR_Z - 0.6, WINDOW_NEAR_Z + 1.2, point.z));
  for (const side of [-1, 1]) {
    const dx = point.x - side * COVE_INSET;
    const facing = 0.55 + 0.45 * Math.max(0, -side * normal.x + normal.y * 0.4);
    const low = Math.exp(-(dx * dx + (point.y - LOW_COVE_Y) ** 2) / 0.9) * 0.9 * facing;
    const high = Math.exp(-(dx * dx + (point.y - HIGH_COVE_Y) ** 2) / 1.3) * 0.7 * facing;
    red += (low + high) * 0.35;
    green += (low + high) * 1.05;
    blue += (low + high) * 1.2;
    const wallDistance = HALF - side * point.x;
    const spill =
      Math.exp(-(wallDistance * wallDistance) / 5) *
      windowSpan *
      (0.4 + 0.6 * Math.max(0, -side * normal.x));
    red += spill * 0.3;
    green += spill * 0.5;
    blue += spill * 0.75;
  }
  const overhead = 1 - 0.25 * smoothstep(2.2, 3.2, point.y);
  return [red * overhead, green * overhead, blue * overhead];
}

const AXIS = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  py: new THREE.Vector3(0, 1, 0),
  ny: new THREE.Vector3(0, -1, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
} as const;

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Cell size that keeps Gouraud interpolation finer than the cove falloff. */
const segments = (length: number, cell = 0.5): number => Math.max(1, Math.ceil(length / cell));

class DeckBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];
  private readonly point = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  /** Adds a subdivided quad whose front face points along `facing`. */
  quad(
    origin: THREE.Vector3,
    u: THREE.Vector3,
    v: THREE.Vector3,
    facing: THREE.Vector3,
    albedo: Rgb,
    options: { segU?: number; segV?: number; emissive?: Rgb; variation?: number } = {},
  ): void {
    const segU = options.segU ?? segments(u.length());
    const segV = options.segV ?? segments(v.length());
    this.normal.crossVectors(u, v).normalize();
    const flip = this.normal.dot(facing) < 0;
    if (flip) this.normal.negate();
    const tint = options.variation ?? 1;
    const emissive = options.emissive ?? [0, 0, 0];
    const base = this.positions.length / 3;
    for (let j = 0; j <= segV; j += 1) {
      for (let i = 0; i <= segU; i += 1) {
        this.point
          .copy(origin)
          .addScaledVector(u, i / segU)
          .addScaledVector(v, j / segV);
        this.positions.push(this.point.x, this.point.y, this.point.z);
        const light = deckLight(this.point, this.normal);
        for (let channel = 0; channel < 3; channel += 1) {
          this.colors.push(albedo[channel] * tint * light[channel] + emissive[channel]);
        }
      }
    }
    const row = segU + 1;
    for (let j = 0; j < segV; j += 1) {
      for (let i = 0; i < segU; i += 1) {
        const a = base + j * row + i;
        const b = a + 1;
        const c = a + row + 1;
        const d = a + row;
        if (flip) this.indices.push(a, d, b, b, d, c);
        else this.indices.push(a, b, d, b, c, d);
      }
    }
  }

  /** Axis-aligned box with outward faces; `skip` omits faces hidden against walls. */
  box(
    min: THREE.Vector3,
    max: THREE.Vector3,
    albedo: Rgb,
    options: { skip?: readonly string[]; emissive?: Rgb; variation?: number } = {},
  ): void {
    const size = new THREE.Vector3().subVectors(max, min);
    const skip = new Set(options.skip ?? []);
    const faceOptions = { emissive: options.emissive, variation: options.variation };
    const x = new THREE.Vector3(size.x, 0, 0);
    const y = new THREE.Vector3(0, size.y, 0);
    const z = new THREE.Vector3(0, 0, size.z);
    if (!skip.has('+x')) this.quad(v3(max.x, min.y, min.z), z, y, AXIS.px, albedo, faceOptions);
    if (!skip.has('-x')) this.quad(min.clone(), z, y, AXIS.nx, albedo, faceOptions);
    if (!skip.has('+y')) this.quad(v3(min.x, max.y, min.z), x, z, AXIS.py, albedo, faceOptions);
    if (!skip.has('-y')) this.quad(min.clone(), x, z, AXIS.ny, albedo, faceOptions);
    if (!skip.has('+z')) this.quad(v3(min.x, min.y, max.z), x, y, AXIS.pz, albedo, faceOptions);
    if (!skip.has('-z')) this.quad(min.clone(), x, y, AXIS.nz, albedo, faceOptions);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Box against a side wall, `depth` metres inward, spanning z0..z1 and y0..y1. */
function wallBox(
  deck: DeckBuilder,
  side: number,
  depth: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  albedo: Rgb,
  options: { skip?: readonly string[]; variation?: number } = {},
): void {
  const wallX = side * HALF;
  const inner = wallX - side * depth;
  deck.box(v3(Math.min(wallX, inner), y0, z0), v3(Math.max(wallX, inner), y1, z1), albedo, {
    ...options,
    skip: [side < 0 ? '-x' : '+x', ...(options.skip ?? [])],
  });
}

const inWindowSpan = (z0: number, z1: number): boolean =>
  z1 > WINDOW_FAR_Z + 1e-6 && z0 < WINDOW_NEAR_Z - 1e-6;

function addFloor(deck: DeckBuilder, random: () => number): void {
  const floorY = HANGAR_DECK_FLOOR_Y;
  const span = HALF * 2;
  deck.quad(v3(-HALF, 0, FAR_Z), v3(span, 0, 0), v3(0, 0, span), AXIS.py, SUBFLOOR, {
    segU: 1,
    segV: 1,
  });
  const tile = 1.2;
  const gap = 0.014;
  const count = Math.round(span / tile);
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      deck.quad(
        v3(-HALF + column * tile + gap, floorY, FAR_Z + row * tile + gap),
        v3(tile - gap * 2, 0, 0),
        v3(0, 0, tile - gap * 2),
        AXIS.py,
        PLATE,
        { segU: 2, segV: 2, variation: 0.86 + random() * 0.28 },
      );
    }
  }
  // Muted amber deck guides run beside and behind the user, never into the pane field.
  for (const x of [-6, 6]) {
    deck.quad(
      v3(x - 0.025, floorY + 0.003, WINDOW_NEAR_Z + 0.4),
      v3(0.05, 0, 0),
      v3(0, 0, REAR_Z - 0.6 - (WINDOW_NEAR_Z + 0.4)),
      AXIS.py,
      [0, 0, 0],
      { emissive: GUIDE_AMBER, segU: 1, segV: 4 },
    );
  }
}

function addSideWalls(deck: DeckBuilder, random: () => number): void {
  for (const side of [-1, 1]) {
    const inward = side < 0 ? AXIS.px : AXIS.nx;
    const wallX = side * HALF;
    const fullHeight = v3(0, CEILING_Y, 0);
    // Wall shell around the window opening.
    deck.quad(v3(wallX, 0, FAR_Z), v3(0, 0, WINDOW_FAR_Z - FAR_Z), fullHeight, inward, HULL);
    deck.quad(
      v3(wallX, 0, WINDOW_NEAR_Z),
      v3(0, 0, REAR_Z - WINDOW_NEAR_Z),
      fullHeight,
      inward,
      HULL,
    );
    const windowRun = v3(0, 0, WINDOW_NEAR_Z - WINDOW_FAR_Z);
    deck.quad(v3(wallX, 0, WINDOW_FAR_Z), windowRun, v3(0, WINDOW_BOTTOM, 0), inward, HULL);
    deck.quad(
      v3(wallX, WINDOW_TOP, WINDOW_FAR_Z),
      windowRun,
      v3(0, CEILING_Y - WINDOW_TOP, 0),
      inward,
      HULL,
    );
    // Recessed cove strips: the light source itself stays a thin, dim line.
    for (const y of [LOW_COVE_Y, HIGH_COVE_Y]) {
      deck.quad(
        v3(wallX - side * 0.01, y - 0.012, FAR_Z),
        v3(0, 0, HALF * 2),
        v3(0, 0.024, 0),
        inward,
        [0, 0, 0],
        { emissive: COVE_GLOW, segU: 8, segV: 1 },
      );
    }
    // Structural ribs; those across the window double as mullions.
    for (let z = FAR_Z + RIB_SPACING; z < REAR_Z - 0.2; z += RIB_SPACING) {
      wallBox(deck, side, RIB_DEPTH, HANGAR_DECK_FLOOR_Y, CEILING_Y, z - 0.11, z + 0.11, FRAME, {
        skip: ['-y', '+y'],
      });
    }
    // Window sill and header, with a very dim line under the sill lip.
    wallBox(
      deck,
      side,
      0.2,
      WINDOW_BOTTOM - 0.08,
      WINDOW_BOTTOM,
      WINDOW_FAR_Z,
      WINDOW_NEAR_Z,
      FRAME,
      {
        skip: ['-z', '+z'],
      },
    );
    wallBox(deck, side, 0.14, WINDOW_TOP, WINDOW_TOP + 0.1, WINDOW_FAR_Z, WINDOW_NEAR_Z, FRAME, {
      skip: ['-z', '+z'],
    });
    deck.quad(
      v3(wallX - side * 0.201, WINDOW_BOTTOM - 0.07, WINDOW_FAR_Z),
      windowRun,
      v3(0, 0.012, 0),
      inward,
      [0, 0, 0],
      { emissive: SILL_GLOW, segU: 4, segV: 1 },
    );
    // Handrail and a run of low lockers, kept off the window span.
    for (const [z0, z1] of [
      [FAR_Z, WINDOW_FAR_Z],
      [WINDOW_NEAR_Z, REAR_Z],
    ]) {
      wallBox(deck, side, 0.1, 1.04, 1.1, z0, z1, HULL_DARK, { skip: ['-z', '+z'] });
    }
    for (let z = FAR_Z + RIB_SPACING; z < REAR_Z - RIB_SPACING; z += RIB_SPACING) {
      const z0 = z + 0.16;
      const z1 = z + RIB_SPACING - 0.16;
      if (inWindowSpan(z0, z1) || random() < 0.35) continue;
      const height = 0.5 + random() * 0.32;
      wallBox(
        deck,
        side,
        0.42,
        HANGAR_DECK_FLOOR_Y,
        HANGAR_DECK_FLOOR_Y + height,
        z0,
        z1,
        HULL_DARK,
        {
          skip: ['-y'],
          variation: 0.8 + random() * 0.4,
        },
      );
    }
  }
}

function addCeiling(deck: DeckBuilder): void {
  const span = HALF * 2;
  deck.quad(v3(-HALF, CEILING_Y, FAR_Z), v3(span, 0, 0), v3(0, 0, span), AXIS.ny, HULL_DARK);
  for (let z = FAR_Z + RIB_SPACING; z < REAR_Z - 0.2; z += RIB_SPACING) {
    deck.box(v3(-HALF, CEILING_Y - 0.26, z - 0.11), v3(HALF, CEILING_Y, z + 0.11), FRAME, {
      skip: ['+y', '-x', '+x'],
    });
  }
}

/** The wall behind the panes: plain plates and dark seams, nothing that draws the eye. */
function addFarWall(deck: DeckBuilder, random: () => number): void {
  const z = FAR_Z;
  const panel = 2.4;
  const gap = 0.012;
  const flat = { segU: 1, segV: 1 };
  const span = v3(HALF * 2, 0, 0);
  deck.quad(v3(-HALF, 0, z), span, v3(0, BAND_BOTTOM, 0), AXIS.pz, SEAM, flat);
  deck.quad(v3(-HALF, BAND_TOP, z), span, v3(0, CEILING_Y - BAND_TOP, 0), AXIS.pz, SEAM, flat);
  // Solid wall either side of the window band.
  for (const x0 of [-HALF, BAND_HALF_WIDTH]) {
    deck.quad(
      v3(x0, BAND_BOTTOM, z + 0.01),
      v3(HALF - BAND_HALF_WIDTH, 0, 0),
      v3(0, BAND_TOP - BAND_BOTTOM, 0),
      AXIS.pz,
      HULL,
      { variation: 0.95 },
    );
  }
  // Slim dark lips frame the band; no mullions and no glow.
  for (const [y0, y1] of [
    [BAND_BOTTOM - 0.05, BAND_BOTTOM],
    [BAND_TOP, BAND_TOP + 0.05],
  ]) {
    deck.box(v3(-BAND_HALF_WIDTH, y0, z), v3(BAND_HALF_WIDTH, y1, z + 0.08), FRAME, {
      skip: ['-z', '-x', '+x'],
    });
  }
  for (let x = -HALF; x < HALF - 1e-6; x += panel) {
    for (const [y0, y1] of [
      [0, 1.1],
      [1.1, BAND_BOTTOM],
      [BAND_TOP, CEILING_Y],
    ]) {
      deck.quad(
        v3(x + gap, y0 + gap, z + 0.01),
        v3(panel - gap * 2, 0, 0),
        v3(0, y1 - y0 - gap * 2, 0),
        AXIS.pz,
        HULL,
        { variation: 0.9 + random() * 0.16 },
      );
    }
  }
}

function addRearWall(deck: DeckBuilder): void {
  const z = REAR_Z;
  deck.quad(v3(-HALF, 0, z), v3(HALF * 2, 0, 0), v3(0, CEILING_Y, 0), AXIS.nz, HULL);
  // Closed hangar door: two leaves, a frame and a pair of dim status lamps.
  deck.box(v3(-1.9, HANGAR_DECK_FLOOR_Y, z - 0.16), v3(1.9, 2.7, z), FRAME, {
    skip: ['+z', '-y'],
  });
  deck.box(v3(-1.7, HANGAR_DECK_FLOOR_Y, z - 0.2), v3(-0.02, 2.5, z - 0.16), HULL_DARK, {
    skip: ['+z', '-y'],
  });
  deck.box(v3(0.02, HANGAR_DECK_FLOOR_Y, z - 0.2), v3(1.7, 2.5, z - 0.16), HULL_DARK, {
    skip: ['+z', '-y'],
  });
  for (const x of [-2.15, 2.1]) {
    deck.box(v3(x, 2.2, z - 0.05), v3(x + 0.05, 2.32, z), [0, 0, 0], {
      skip: ['+z'],
      emissive: STATUS_AMBER,
    });
  }
}

function createDeckMesh(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const random = seededRandom(0x48414e47);
  const deck = new DeckBuilder();
  addFloor(deck, random);
  addSideWalls(deck, random);
  addCeiling(deck);
  addFarWall(deck, random);
  addRearWall(deck);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, dithering: true });
  material.name = 'hangar-deck-structure';
  const mesh = new THREE.Mesh(deck.build(), material);
  mesh.name = 'hangar-deck-structure';
  // Drawn before the sky shell so depth testing rejects sky fragments the hull covers.
  mesh.renderOrder = -2000;
  return mesh;
}

function createWindowGlass(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const glass = new DeckBuilder();
  for (const side of [-1, 1]) {
    glass.quad(
      v3(side * (HALF - 0.06), WINDOW_BOTTOM, WINDOW_FAR_Z),
      v3(0, 0, WINDOW_NEAR_Z - WINDOW_FAR_Z),
      v3(0, WINDOW_TOP - WINDOW_BOTTOM, 0),
      side < 0 ? AXIS.px : AXIS.nx,
      [0, 0, 0],
      { segU: 1, segV: 1 },
    );
  }
  const sideVertices = glass.positions.length / 3;
  glass.quad(
    v3(-BAND_HALF_WIDTH, BAND_BOTTOM, FAR_Z + 0.04),
    v3(BAND_HALF_WIDTH * 2, 0, 0),
    v3(0, BAND_TOP - BAND_BOTTOM, 0),
    AXIS.pz,
    [0, 0, 0],
    { segU: 1, segV: 1 },
  );
  const geometry = glass.build();
  // RGBA vertex colours give the band heavier tint than the side windows in one draw call.
  const vertexCount = glass.positions.length / 3;
  const tint = new Float32Array(vertexCount * 4);
  for (let index = 0; index < vertexCount; index += 1) {
    tint.set([1, 1, 1, index < sideVertices ? SIDE_GLASS_OPACITY : BAND_GLASS_OPACITY], index * 4);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(tint, 4));
  const material = new THREE.MeshBasicMaterial({
    color: 0x0b1a22,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    dithering: true,
  });
  material.name = 'hangar-deck-window-glass';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hangar-deck-window-glass';
  return mesh;
}

export function createHangarDeckEnvironment(): HangarDeckEnvironment {
  const root = new THREE.Group();
  root.name = 'hangar-deck-environment';
  const background = createSpaceBackground();
  background.root.visible = true;
  const deck = createDeckMesh();
  const glass = createWindowGlass();
  root.add(background.root, deck, glass);
  let disposed = false;
  const update = (deltaSeconds: number): void => {
    if (disposed || !root.visible || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    background.update(Math.min(deltaSeconds, MAX_UPDATE_DELTA));
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    background.dispose();
    for (const mesh of [deck, glass]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    root.removeFromParent();
  };
  return { root, update, dispose, floorY: HANGAR_DECK_FLOOR_Y };
}
