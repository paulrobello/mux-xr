import * as THREE from 'three';

export interface ElasticArm {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  update(
    anchor: THREE.Vector3,
    wrist: THREE.Vector3,
    deltaSeconds: number,
    wristProfile?: WristProfile,
  ): void;
  reset(): void;
  /** A hidden arm stays hidden through later updates. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** World-space ellipse at the hand end of the arm. The axes need not be normalized. */
export interface WristProfile {
  across: THREE.Vector3;
  normal: THREE.Vector3;
  radiusAcross: number;
  radiusNormal: number;
}

export const ELASTIC_ARM_RENDER_ORDER = 900;
/** Metres from the eye: invisible inside `near`, fully drawn beyond `far`. */
export type ArmNearFade = readonly [near: number, far: number];
export const DEFAULT_ARM_NEAR_FADE: ArmNearFade = [0.3, 0.55];

/** Makes `material` fade out toward the eye. Call again after anything copies over the material. */
export function applyArmNearFade(
  material: THREE.MeshStandardMaterial,
  fade: ArmNearFade | false,
): void {
  if (fade) {
    const [near, far] = fade;
    material.transparent = true;
    material.depthWrite = true;
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `diffuseColor.a *= smoothstep(${near.toFixed(3)}, ${far.toFixed(3)}, length(vViewPosition));\n#include <opaque_fragment>`,
      );
    };
    material.customProgramCacheKey = () => `arm-near-fade:${near.toFixed(3)}:${far.toFixed(3)}`;
  } else {
    material.transparent = false;
    material.onBeforeCompile = () => {};
    material.customProgramCacheKey = () => '';
  }
  material.needsUpdate = true;
}

const SEGMENTS = 24;
const SIDES = 10;
const ANCHOR_RADIUS = 0.018;
const WRIST_RADIUS = 0.014;
const FALLBACK_WRIST_RADIUS = 0.019;
const WRIST_FLARE_LENGTH = 0.12;
const EPSILON = 1e-5;

export function createElasticArm(material: THREE.Material): ElasticArm {
  const vertexCount = (SEGMENTS + 1) * SIDES + 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint16Array(SEGMENTS * SIDES * 6 + SIDES * 6);
  let index = 0;
  const ring = (offset: number, next: number): void => {
    for (let side = 0; side < SIDES; side += 1) {
      const a = offset + side;
      const b = offset + ((side + 1) % SIDES);
      indices[index++] = a;
      indices[index++] = b;
      indices[index++] = next + side;
      indices[index++] = b;
      indices[index++] = next + ((side + 1) % SIDES);
      indices[index++] = next + side;
    }
  };
  for (let segment = 0; segment < SEGMENTS; segment += 1)
    ring(segment * SIDES, (segment + 1) * SIDES);
  const startCap = (SEGMENTS + 1) * SIDES;
  const endCap = startCap + 1;
  for (let side = 0; side < SIDES; side += 1) {
    const next = (side + 1) % SIDES;
    indices[index++] = startCap;
    indices[index++] = next;
    indices[index++] = side;
    const end = SEGMENTS * SIDES;
    indices[index++] = endCap;
    indices[index++] = end + side;
    indices[index++] = end + next;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.raycast = () => undefined;
  mesh.renderOrder = ELASTIC_ARM_RENDER_ORDER;

  const midpoint = new THREE.Vector3();
  const targetMidpoint = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const startTangent = new THREE.Vector3();
  const startNormal = new THREE.Vector3(0, 1, 0);
  const previousNormal = new THREE.Vector3();
  const point = new THREE.Vector3();
  const derivative = new THREE.Vector3();
  const endDelta = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const vertexPosition = new THREE.Vector3();
  const profileAcross = new THREE.Vector3();
  const profileNormal = new THREE.Vector3();
  const ringAcross = new THREE.Vector3();
  const ringNormal = new THREE.Vector3();
  const profileCross = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const wristRotation = new THREE.Quaternion();
  const ringRotation = new THREE.Quaternion();
  const surfaceNormal = new THREE.Vector3();
  let initialized = false;
  let disposed = false;
  let shown = true;

  const writeVertex = (
    vertex: number,
    position: THREE.Vector3,
    unitNormal: THREE.Vector3,
  ): void => {
    const offset = vertex * 3;
    positions[offset] = position.x;
    positions[offset + 1] = position.y;
    positions[offset + 2] = position.z;
    normals[offset] = unitNormal.x;
    normals[offset + 1] = unitNormal.y;
    normals[offset + 2] = unitNormal.z;
  };
  const reset = (): void => {
    initialized = false;
    midpoint.set(0, 0, 0);
    targetMidpoint.set(0, 0, 0);
    startNormal.set(0, 1, 0);
    mesh.visible = false;
  };
  const update = (
    anchor: THREE.Vector3,
    wrist: THREE.Vector3,
    deltaSeconds: number,
    wristProfile?: WristProfile,
  ): void => {
    if (disposed) return;
    const length = anchor.distanceTo(wrist);
    if (length < EPSILON) {
      reset();
      return;
    }
    targetMidpoint.copy(anchor).add(wrist).multiplyScalar(0.5);
    targetMidpoint.y -= Math.min(0.12, length * 0.12);
    if (!initialized) {
      midpoint.copy(targetMidpoint);
      initialized = true;
    } else {
      const alpha = 1 - Math.exp(-Math.max(0, deltaSeconds) * 14);
      midpoint.lerp(targetMidpoint, alpha);
      endDelta.copy(midpoint).sub(targetMidpoint).clampLength(0, 0.1);
      midpoint.copy(targetMidpoint).add(endDelta);
    }
    const profileValid =
      wristProfile !== undefined &&
      Number.isFinite(wristProfile.radiusAcross) &&
      Number.isFinite(wristProfile.radiusNormal) &&
      wristProfile.radiusAcross > EPSILON &&
      wristProfile.radiusNormal > EPSILON &&
      wristProfile.across.lengthSq() > EPSILON * EPSILON &&
      wristProfile.normal.lengthSq() > EPSILON * EPSILON;
    if (profileValid) {
      profileAcross.copy(wristProfile.across).normalize();
      profileNormal
        .copy(wristProfile.normal)
        .addScaledVector(profileAcross, -wristProfile.normal.dot(profileAcross))
        .normalize();
      profileCross.crossVectors(profileAcross, profileNormal);
      if (profileCross.lengthSq() < EPSILON * EPSILON) {
        profileNormal.set(0, 1, 0);
        if (Math.abs(profileAcross.y) > 0.9) profileNormal.set(1, 0, 0);
        profileNormal.addScaledVector(profileAcross, -profileNormal.dot(profileAcross)).normalize();
        profileCross.crossVectors(profileAcross, profileNormal).normalize();
      }
      if (profileCross.dot(endDelta.subVectors(wrist, midpoint)) < 0) {
        profileNormal.negate();
        profileCross.negate();
      }
      wristRotation.setFromRotationMatrix(
        basis.makeBasis(profileAcross, profileNormal, profileCross),
      );
    }
    for (let segment = 0; segment <= SEGMENTS; segment += 1) {
      const t = segment / SEGMENTS;
      const oneMinus = 1 - t;
      point
        .copy(anchor)
        .multiplyScalar(oneMinus * oneMinus)
        .addScaledVector(midpoint, 2 * oneMinus * t)
        .addScaledVector(wrist, t * t);
      derivative
        .copy(midpoint)
        .sub(anchor)
        .multiplyScalar(2 * oneMinus);
      endDelta.copy(wrist).sub(midpoint);
      derivative.addScaledVector(endDelta, 2 * t);
      tangent.copy(derivative);
      if (tangent.lengthSq() < EPSILON * EPSILON) tangent.copy(wrist).sub(anchor);
      tangent.normalize();
      if (segment === 0) {
        startTangent.copy(tangent);
        normal.copy(startNormal).addScaledVector(tangent, -startNormal.dot(tangent));
        if (normal.lengthSq() < EPSILON) normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
        normal.normalize();
        startNormal.copy(normal);
      } else {
        normal.copy(previousNormal).addScaledVector(tangent, -previousNormal.dot(tangent));
        if (normal.lengthSq() < EPSILON) normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
        normal.normalize();
      }
      binormal.crossVectors(tangent, normal).normalize();
      previousNormal.copy(normal);
      const radius = THREE.MathUtils.lerp(ANCHOR_RADIUS, WRIST_RADIUS, t);
      const flare = THREE.MathUtils.smoothstep(t, Math.max(0, 1 - WRIST_FLARE_LENGTH / length), 1);
      let wide = radius,
        thick = radius;
      ringAcross.copy(normal);
      ringNormal.copy(binormal);
      if (flare > 0) {
        wide = THREE.MathUtils.lerp(
          radius,
          profileValid ? wristProfile.radiusAcross : FALLBACK_WRIST_RADIUS,
          flare,
        );
        thick = THREE.MathUtils.lerp(
          radius,
          profileValid ? wristProfile.radiusNormal : FALLBACK_WRIST_RADIUS,
          flare,
        );
      }
      if (profileValid && flare > 0) {
        ringRotation
          .setFromRotationMatrix(basis.makeBasis(normal, binormal, tangent))
          .slerp(wristRotation, flare);
        ringAcross.set(1, 0, 0).applyQuaternion(ringRotation);
        ringNormal.set(0, 1, 0).applyQuaternion(ringRotation);
      }
      for (let side = 0; side < SIDES; side += 1) {
        const angle = (side / SIDES) * Math.PI * 2,
          cos = Math.cos(angle),
          sin = Math.sin(angle);
        radial
          .copy(ringAcross)
          .multiplyScalar(cos * wide)
          .addScaledVector(ringNormal, sin * thick);
        vertexPosition.copy(point).add(radial);
        surfaceNormal
          .copy(ringAcross)
          .multiplyScalar(cos / wide)
          .addScaledVector(ringNormal, sin / thick)
          .normalize();
        writeVertex(segment * SIDES + side, vertexPosition, surfaceNormal);
      }
    }
    endDelta.copy(tangent);
    tangent.copy(startTangent).negate();
    writeVertex(startCap, anchor, tangent);
    writeVertex(endCap, wrist, endDelta);
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
    geometry.computeBoundingSphere();
    mesh.visible = shown;
  };
  return {
    mesh,
    update,
    reset,
    setVisible: (visible) => {
      shown = visible;
      if (!visible) mesh.visible = false;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      mesh.visible = false;
    },
  };
}
