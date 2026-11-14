import * as THREE from 'three';

export interface ElasticArm {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  update(anchor: THREE.Vector3, wrist: THREE.Vector3, deltaSeconds: number): void;
  reset(): void;
  dispose(): void;
}

const SEGMENTS = 24;
const SIDES = 10;
const ANCHOR_RADIUS = 0.018;
const WRIST_RADIUS = 0.014;
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
  let initialized = false;
  let disposed = false;

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
  const update = (anchor: THREE.Vector3, wrist: THREE.Vector3, deltaSeconds: number): void => {
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
      for (let side = 0; side < SIDES; side += 1) {
        const angle = (side / SIDES) * Math.PI * 2;
        radial
          .copy(normal)
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(binormal, Math.sin(angle));
        vertexPosition.copy(point).addScaledVector(radial, radius);
        writeVertex(segment * SIDES + side, vertexPosition, radial);
      }
    }
    endDelta.copy(tangent);
    tangent.copy(startTangent).negate();
    writeVertex(startCap, anchor, tangent);
    writeVertex(endCap, wrist, endDelta);
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
    geometry.computeBoundingSphere();
    mesh.visible = true;
  };
  return {
    mesh,
    update,
    reset,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      mesh.visible = false;
    },
  };
}
