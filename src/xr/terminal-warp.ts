import {
  clampSurfaceCurvatureRadians as clampTerminalCurvatureRadians,
  createCurvedSurfaceGeometry as createCurvedTerminalGeometry,
  MAX_SURFACE_CURVATURE_RADIANS as MAX_TERMINAL_CURVATURE_RADIANS,
  type CurvedSurfaceOptions as TerminalWarpOptions,
  type CurvedSurfaceSpan as TerminalWarpSpan,
  curvedSurfacePoint as terminalWarpPoint,
  validateSpan,
} from '@par/xr-workspace/internal/curved-surface';
import * as THREE from 'three';

export {
  clampTerminalCurvatureRadians,
  createCurvedTerminalGeometry,
  MAX_TERMINAL_CURVATURE_RADIANS,
  type TerminalWarpOptions,
  type TerminalWarpSpan,
  terminalWarpPoint,
};

export interface TerminalWarpBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}

export interface TerminalSelectionOptions extends TerminalWarpOptions {
  /** Border thickness in local screen units. Defaults to 0.025. */
  border?: number;
  /** Original screen width when the outline includes outer padding. */
  surfaceWidth?: number;
}

/** Create a curved outline mesh suitable for a Basic/line-like selection material. */
export function createCurvedTerminalSelection(
  options: TerminalSelectionOptions,
): THREE.BufferGeometry {
  validateSpan(options);
  const segmentCount = Math.max(4, Math.floor(options.segments ?? 32));
  const border = Math.min(options.border ?? 0.025, options.width / 2, options.height / 2);
  const surfaceWidth = options.surfaceWidth ?? options.width;
  const surface = { width: surfaceWidth, height: options.height, radians: options.radians };
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const addVertex = (x: number, y: number, u: number, v: number): number => {
    const point = terminalWarpPoint(x, surface);
    positions.push(point.x, y, point.z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  const addQuad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, d, b, c, d);
  };

  const samples = [
    ...new Set([
      ...Array.from(
        { length: segmentCount + 1 },
        (_, column) => (column / segmentCount - 0.5) * surfaceWidth,
      ),
      -options.width / 2,
      options.width / 2,
      -options.width / 2 + border,
      options.width / 2 - border,
    ]),
  ].sort((a, b) => a - b);
  for (let column = 0; column < samples.length - 1; column += 1) {
    const x0 = samples[column];
    const x1 = samples[column + 1];
    const u0 = x0 / options.width + 0.5;
    const u1 = x1 / options.width + 0.5;
    addQuad(
      addVertex(x0, options.height / 2 - border, u0, 1),
      addVertex(x1, options.height / 2 - border, u1, 1),
      addVertex(x1, options.height / 2, u1, 1),
      addVertex(x0, options.height / 2, u0, 1),
    );
    addQuad(
      addVertex(x0, -options.height / 2, u0, 0),
      addVertex(x1, -options.height / 2, u1, 0),
      addVertex(x1, -options.height / 2 + border, u1, 0),
      addVertex(x0, -options.height / 2 + border, u0, 0),
    );
  }
  const left = -options.width / 2;
  const right = options.width / 2;
  addQuad(
    addVertex(left, -options.height / 2 + border, 0, 0),
    addVertex(left + border, -options.height / 2 + border, 0, 0),
    addVertex(left + border, options.height / 2 - border, 0, 1),
    addVertex(left, options.height / 2 - border, 0, 1),
  );
  addQuad(
    addVertex(right - border, -options.height / 2 + border, 1, 0),
    addVertex(right, -options.height / 2 + border, 1, 0),
    addVertex(right, options.height / 2 - border, 1, 1),
    addVertex(right - border, options.height / 2 - border, 1, 1),
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Warp an existing x/y mesh once so frame and selection geometry follows the
 * terminal screen. The geometry remains caller-owned and is never disposed.
 */
export function warpGeometryPositions(
  geometry: THREE.BufferGeometry,
  options: TerminalWarpOptions,
): THREE.BufferGeometry {
  validateSpan(options);
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Terminal warp requires a position attribute');
  for (let index = 0; index < position.count; index += 1) {
    const point = terminalWarpPoint(position.getX(index), options);
    const sourceZ = position.getZ(index);
    position.setX(index, point.x);
    position.setZ(index, sourceZ + point.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Return the local-space envelope used for layout and floor clearance. */
export function getTerminalWarpBounds(span: TerminalWarpSpan, samples = 64): TerminalWarpBounds {
  validateSpan(span);
  const count = Math.max(2, Math.floor(samples));
  const radians = clampTerminalCurvatureRadians(span.radians);
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index <= count; index += 1) {
    const point = terminalWarpPoint((index / count - 0.5) * span.width, span);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const minX = radians === 0 ? -span.width / 2 : -(span.width / radians) * Math.sin(radians / 2);
  const maxX = -minX;
  return {
    minX,
    maxX,
    minY: -span.height / 2,
    maxY: span.height / 2,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

/** Conservative arrangement footprint retaining the requested arc span. */
export function getConservativeTerminalArrangementSize(span: TerminalWarpSpan): {
  width: number;
  depth: number;
} {
  return { width: span.width, depth: getTerminalWarpBounds(span).depth };
}

export interface TerminalFrameOptions {
  /** Add the instrument chin below the bottom rim. */
  chin?: boolean;
}

export const TERMINAL_FRAME_SIDE_RIM = 0.0175;
export const TERMINAL_FRAME_TOP_RIM = 0.03;
export const TERMINAL_FRAME_CHIN_GAP = 0.006;
export const TERMINAL_FRAME_CHIN_HEIGHT = 0.044;
/** Highest point of the frame above the screen surface (the corner brackets). */
export const TERMINAL_FRAME_RELIEF = 0.008;

// The frame mesh sits at -0.025 in parent Z; the geometry cancels it so depth 0 is the screen.
const FRAME_ROOT_OFFSET = 0.025;
const FRAME_SEGMENTS = 32;
const FRAME_CORNER_STEPS = 6;
const FRAME_BACK = -0.014;
const FRAME_LIP = 0.006;
const FRAME_FACE = 0.005;
const FRAME_FACE_SHARE = 0.58;
const FRAME_STEP = 0.002;
const FRAME_BEVEL = 0.003;
const BRACKET_INNER = 0.008;
const GLOW_LIFT = 0.0004;

const FRAME_COLORS = {
  shadow: new THREE.Color(0x101820),
  lip: new THREE.Color(0x27303b),
  face: new THREE.Color(0x414c5a),
  bracketSide: new THREE.Color(0x394452),
  bracket: new THREE.Color(0x64717f),
};

type FrameHint = readonly [number, number, number];

interface FrameBuilder {
  vertex(x: number, y: number, depth: number, color?: THREE.Color): number;
  quad(a: number, b: number, c: number, d: number, hint: FrameHint): void;
  fan(loop: readonly number[], hint: FrameHint): void;
  build(): THREE.BufferGeometry;
}

/**
 * Collects frame vertices given in flat pane space (x, y, depth above the screen) and places them
 * on the warped surface: x beyond the screen edge continues along the edge tangent, depth runs
 * along the surface normal. Faces are wound to face their hint, also given in flat space.
 */
function createFrameBuilder(span: TerminalWarpSpan): FrameBuilder {
  const half = span.width / 2;
  const flat: number[] = [];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const triangle = (a: number, b: number, c: number, hint: FrameHint): void => {
    const ux = flat[b * 3] - flat[a * 3];
    const uy = flat[b * 3 + 1] - flat[a * 3 + 1];
    const uz = flat[b * 3 + 2] - flat[a * 3 + 2];
    const vx = flat[c * 3] - flat[a * 3];
    const vy = flat[c * 3 + 1] - flat[a * 3 + 1];
    const vz = flat[c * 3 + 2] - flat[a * 3 + 2];
    const facing =
      (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2];
    if (facing < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  return {
    vertex(x, y, depth, color) {
      const onScreen = THREE.MathUtils.clamp(x, -half, half);
      const point = terminalWarpPoint(onScreen, span);
      const over = x - onScreen;
      flat.push(x, y, depth);
      positions.push(
        point.x + over * point.normalZ + depth * point.normalX,
        y,
        point.z - over * point.normalX + depth * point.normalZ + FRAME_ROOT_OFFSET,
      );
      if (color) colors.push(color.r, color.g, color.b);
      return positions.length / 3 - 1;
    },
    quad(a, b, c, d, hint) {
      triangle(a, b, c, hint);
      triangle(a, c, d, hint);
    },
    fan(loop, hint) {
      for (let index = 1; index < loop.length - 1; index += 1)
        triangle(loop[0], loop[index], loop[index + 1], hint);
    },
    build() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (colors.length)
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

/** One station of the rim path: a screen-edge point and the direction the rim leaves it in. */
interface RimSample {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  rim: number;
  /** Corner whose bracket covers this station, or -1. */
  corner: number;
}

interface RimRow {
  offset(sample: RimSample): number;
  depth: number;
}

const rimRow = (offset: (sample: RimSample) => number, depth: number): RimRow => ({
  offset,
  depth,
});

/** Bracket arm length along each edge, shortened on small panes so the arms never meet. */
export function terminalFrameBracketArm(span: TerminalWarpSpan): number {
  const shortest = Math.min(span.width, span.height);
  return Math.min(THREE.MathUtils.clamp(0.18 * shortest, 0.04, 0.3), 0.3 * shortest);
}

/** Rim path counter-clockwise seen from the front, starting on the top edge outside a bracket. */
function createRimPath(span: TerminalWarpSpan): RimSample[] {
  const halfW = span.width / 2;
  const halfH = span.height / 2;
  const arm = terminalFrameBracketArm(span);
  const radius = TERMINAL_FRAME_SIDE_RIM;
  const samples: RimSample[] = [];
  const cornerOf = (x: number, y: number): number => {
    const nearX = halfW - Math.abs(x) <= arm + 1e-9;
    const nearY = halfH - Math.abs(y) <= arm + 1e-9;
    if (!nearX || !nearY) return -1;
    return (x > 0 ? 0 : 1) + (y > 0 ? 0 : 2);
  };
  const edge = (x: number, y: number, dirX: number, dirY: number): void => {
    samples.push({
      x,
      y,
      dirX,
      dirY,
      rim: dirX ? TERMINAL_FRAME_SIDE_RIM : TERMINAL_FRAME_TOP_RIM,
      corner: cornerOf(x, y),
    });
  };
  const arc = (signX: number, signY: number, ascending: boolean): void => {
    const steps = Array.from({ length: FRAME_CORNER_STEPS }, (_, step) => step);
    for (const step of ascending ? steps : steps.reverse()) {
      const angle = (step / FRAME_CORNER_STEPS) * (Math.PI / 2);
      const offsetX = radius * Math.cos(angle);
      const offsetY = TERMINAL_FRAME_TOP_RIM - radius + radius * Math.sin(angle);
      const rim = Math.hypot(offsetX, offsetY);
      samples.push({
        x: signX * halfW,
        y: signY * halfH,
        dirX: (signX * offsetX) / rim,
        dirY: (signY * offsetY) / rim,
        rim,
        corner: cornerOf(signX * halfW, signY * halfH),
      });
    }
  };
  const xs = [
    ...Array.from(
      { length: FRAME_SEGMENTS + 1 },
      (_, index) => (index / FRAME_SEGMENTS - 0.5) * span.width,
    ),
    -halfW + arm,
    halfW - arm,
  ]
    .sort((a, b) => a - b)
    .filter((x, index, all) => index === 0 || x - all[index - 1] > 1e-7);
  const ys = [-halfH, -halfH + arm, halfH - arm, halfH];
  for (const y of ys) edge(halfW, y, 1, 0);
  arc(1, 1, true);
  for (const x of [...xs].reverse()) edge(x, halfH, 0, 1);
  arc(-1, 1, false);
  for (const y of [...ys].reverse()) edge(-halfW, y, -1, 0);
  arc(-1, -1, true);
  for (const x of xs) edge(x, -halfH, 0, -1);
  arc(1, -1, false);
  const start = samples.findIndex((sample) => sample.corner < 0);
  return [...samples.slice(start), ...samples.slice(0, start)];
}

/** Contiguous stations covered by each corner bracket, in path order. */
function bracketRuns(path: readonly RimSample[]): RimSample[][] {
  const runs: RimSample[][] = [];
  let previous = -1;
  for (const sample of path) {
    if (sample.corner >= 0 && sample.corner === previous) runs[runs.length - 1].push(sample);
    else if (sample.corner >= 0) runs.push([sample]);
    previous = sample.corner;
  }
  return runs;
}

function addRimBand(
  builder: FrameBuilder,
  samples: readonly RimSample[],
  closed: boolean,
  from: RimRow,
  to: RimRow,
  color?: THREE.Color,
): void {
  const place = (sample: RimSample, row: RimRow): number => {
    const offset = row.offset(sample);
    return builder.vertex(
      sample.x + sample.dirX * offset,
      sample.y + sample.dirY * offset,
      row.depth,
      color,
    );
  };
  const ring = samples.map((sample) => [place(sample, from), place(sample, to)] as const);
  const count = closed ? samples.length : samples.length - 1;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % samples.length;
    const sample = samples[index];
    const run = to.offset(sample) - from.offset(sample);
    const rise = to.depth - from.depth;
    builder.quad(ring[index][0], ring[index][1], ring[next][1], ring[next][0], [
      -rise * sample.dirX,
      -rise * sample.dirY,
      run,
    ]);
  }
}

const faceEnd = (sample: RimSample): number => sample.rim * FRAME_FACE_SHARE;
const bevelStart = (sample: RimSample): number => sample.rim - FRAME_BEVEL;
const rimEnd = (sample: RimSample): number => sample.rim;

function addBezel(builder: FrameBuilder, path: readonly RimSample[]): void {
  const rows: [RimRow, THREE.Color][] = [
    [rimRow(() => 0, 0), FRAME_COLORS.lip],
    [rimRow(() => FRAME_LIP, FRAME_FACE), FRAME_COLORS.face],
    [rimRow(faceEnd, FRAME_FACE), FRAME_COLORS.shadow],
    [rimRow(faceEnd, FRAME_STEP), FRAME_COLORS.shadow],
    [rimRow(bevelStart, FRAME_STEP), FRAME_COLORS.shadow],
    [rimRow(rimEnd, FRAME_STEP - FRAME_BEVEL), FRAME_COLORS.shadow],
    [rimRow(rimEnd, FRAME_BACK), FRAME_COLORS.shadow],
  ];
  for (let index = 0; index < rows.length - 1; index += 1)
    addRimBand(builder, path, true, rows[index][0], rows[index + 1][0], rows[index][1]);
}

function addBrackets(builder: FrameBuilder, path: readonly RimSample[]): void {
  const top = TERMINAL_FRAME_RELIEF;
  const rows: [RimRow, THREE.Color][] = [
    [rimRow(() => BRACKET_INNER, FRAME_FACE), FRAME_COLORS.bracketSide],
    [rimRow(() => BRACKET_INNER, top), FRAME_COLORS.bracket],
    [rimRow(bevelStart, top), FRAME_COLORS.bracketSide],
    [rimRow(rimEnd, top - FRAME_BEVEL), FRAME_COLORS.bracketSide],
    [rimRow(rimEnd, FRAME_STEP - FRAME_BEVEL), FRAME_COLORS.bracketSide],
  ];
  // The cut end closes down onto the bezel's own step and face.
  const capRows = [
    ...rows.map(([row]) => row),
    rimRow(bevelStart, FRAME_STEP),
    rimRow(faceEnd, FRAME_STEP),
    rimRow(faceEnd, FRAME_FACE),
  ];
  for (const run of bracketRuns(path)) {
    for (let index = 0; index < rows.length - 1; index += 1)
      addRimBand(builder, run, false, rows[index][0], rows[index + 1][0], rows[index][1]);
    for (const [sample, direction] of [
      [run[0], -1],
      [run[run.length - 1], 1],
    ] as const) {
      const loop = capRows.map((row) => {
        const offset = row.offset(sample);
        return builder.vertex(
          sample.x + sample.dirX * offset,
          sample.y + sample.dirY * offset,
          row.depth,
          FRAME_COLORS.bracketSide,
        );
      });
      builder.fan(loop, [-sample.dirY * direction, sample.dirX * direction, 0]);
    }
  }
}

interface ChinLayout {
  outer: number;
  top: number;
  bottom: number;
  xs: number[];
}

function chinLayout(span: TerminalWarpSpan): ChinLayout {
  const outer = span.width / 2 + TERMINAL_FRAME_SIDE_RIM;
  const top = -(span.height / 2 + TERMINAL_FRAME_TOP_RIM + TERMINAL_FRAME_CHIN_GAP);
  return {
    outer,
    top,
    bottom: top - TERMINAL_FRAME_CHIN_HEIGHT,
    xs: [
      -outer,
      ...Array.from(
        { length: FRAME_SEGMENTS + 1 },
        (_, index) => (index / FRAME_SEGMENTS - 0.5) * span.width,
      ),
      outer,
    ],
  };
}

/** A flat inlay on the chin face, split along x so it follows the curve. */
function addChinInlay(
  builder: FrameBuilder,
  span: TerminalWarpSpan,
  left: number,
  right: number,
  low: number,
  high: number,
  depth: number,
  color?: THREE.Color,
): void {
  const steps = Math.max(1, Math.ceil((right - left) / (span.width / FRAME_SEGMENTS)));
  const row = Array.from({ length: steps + 1 }, (_, index) => {
    const x = left + ((right - left) * index) / steps;
    return [builder.vertex(x, low, depth, color), builder.vertex(x, high, depth, color)] as const;
  });
  for (let index = 0; index < steps; index += 1)
    builder.quad(row[index][0], row[index + 1][0], row[index + 1][1], row[index][1], [0, 0, 1]);
}

const CHIN_FACE = 0.007;
const CHIN_CHAMFER = 0.004;

function addChin(builder: FrameBuilder, span: TerminalWarpSpan): void {
  const { outer, top, bottom, xs } = chinLayout(span);
  const section: [number, number, THREE.Color, FrameHint][] = [
    [top, FRAME_BACK, FRAME_COLORS.shadow, [0, 1, 0]],
    [top, CHIN_FACE - CHIN_CHAMFER, FRAME_COLORS.lip, [0, 1, 1]],
    [top - CHIN_CHAMFER, CHIN_FACE, FRAME_COLORS.face, [0, 0, 1]],
    [bottom + CHIN_CHAMFER, CHIN_FACE, FRAME_COLORS.lip, [0, -1, 1]],
    [bottom, CHIN_FACE - CHIN_CHAMFER, FRAME_COLORS.shadow, [0, -1, 0]],
    [bottom, FRAME_BACK, FRAME_COLORS.shadow, [0, 0, 0]],
  ];
  for (let band = 0; band < section.length - 1; band += 1) {
    const [y0, depth0, color, hint] = section[band];
    const [y1, depth1] = section[band + 1];
    const ring = xs.map(
      (x) => [builder.vertex(x, y0, depth0, color), builder.vertex(x, y1, depth1, color)] as const,
    );
    for (let index = 0; index < xs.length - 1; index += 1)
      builder.quad(ring[index][0], ring[index][1], ring[index + 1][1], ring[index + 1][0], hint);
  }
  for (const sign of [-1, 1])
    builder.fan(
      section.map(([y, depth]) => builder.vertex(sign * outer, y, depth, FRAME_COLORS.shadow)),
      [sign, 0, 0],
    );
  const plate = Math.min(0.22, span.width * 0.3);
  const middle = (top + bottom) / 2;
  addChinInlay(
    builder,
    span,
    outer - 0.02 - plate,
    outer - 0.02,
    middle - 0.008,
    middle + 0.008,
    CHIN_FACE + GLOW_LIFT,
    FRAME_COLORS.bracket,
  );
}

/**
 * Pane frame body: a stepped bezel with rounded outer corners, raised corner brackets and an
 * optional chin. Carries a `color` attribute for a `vertexColors` material.
 */
export function createTerminalFrameGeometry(
  span: TerminalWarpSpan,
  options: TerminalFrameOptions = {},
): THREE.BufferGeometry {
  validateSpan(span);
  const builder = createFrameBuilder(span);
  const path = createRimPath(span);
  addBezel(builder, path);
  addBrackets(builder, path);
  if (options.chin) addChin(builder, span);
  return builder.build();
}

/** Glow lines along the corner brackets, plus the chin status light, for an unlit material. */
export function createTerminalFrameAccentGeometry(
  span: TerminalWarpSpan,
  options: TerminalFrameOptions = {},
): THREE.BufferGeometry {
  validateSpan(span);
  const builder = createFrameBuilder(span);
  const depth = TERMINAL_FRAME_RELIEF + GLOW_LIFT;
  for (const run of bracketRuns(createRimPath(span)))
    addRimBand(
      builder,
      run,
      false,
      rimRow(() => BRACKET_INNER + 0.001, depth),
      rimRow(() => BRACKET_INNER + 0.0032, depth),
    );
  if (options.chin) {
    const { outer, top, bottom } = chinLayout(span);
    const middle = (top + bottom) / 2;
    addChinInlay(
      builder,
      span,
      -outer + 0.02,
      -outer + 0.02 + Math.min(0.036, span.width * 0.1),
      middle - 0.003,
      middle + 0.003,
      CHIN_FACE + GLOW_LIFT,
    );
  }
  return builder.build();
}
