import * as THREE from 'three';
import { createElasticArm } from './elastic-arm';
import type { HandContactProbe } from './hand-contact';

type HandSide = 'left' | 'right';
type HandJoints = THREE.Group & { joints?: Record<string, THREE.Object3D | undefined> };

export interface CartoonHand {
  root: THREE.Group;
  /** Current only for the latest pose: read it again after each update, never keep it. */
  readonly contactProbes: readonly HandContactProbe[];
  update(hand: THREE.Group, camera: THREE.Object3D, side: HandSide, deltaSeconds: number): void;
  updateController(
    pose: THREE.Object3D,
    camera: THREE.Object3D,
    side: HandSide,
    gamepad: Gamepad | undefined,
    deltaSeconds: number,
  ): void;
  hide(): void;
  dispose(): void;
}

const SIDES = 10;
const SECTIONS = 14;
const CAP_RINGS = 3;
const RINGS = SECTIONS + 1 + CAP_RINGS;
const FINGER_VERTICES = RINGS * SIDES + 1;
const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger'] as const;
const PARTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const THUMB_JOINTS = [
  '',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
];
const RADII = [0.018, 0.015, 0.015, 0.0145];
const JOINT_NAMES = FINGERS.map((finger, index) =>
  index === 0 ? THUMB_JOINTS : PARTS.map((part) => `${finger}-${part}`),
);
const LITTLE_JOINTS = PARTS.map((part) => `pinky-finger-${part}`);
const REST = [
  [
    [0.03, 0.045],
    [0.055, 0.045],
    [0.08, 0.045],
    [0.1, 0.045],
    [0.11, 0.045],
  ],
  [
    [0.035, 0.025],
    [0.04, 0.075],
    [0.04, 0.115],
    [0.04, 0.15],
    [0.04, 0.17],
  ],
  [
    [0, 0.03],
    [0, 0.08],
    [0, 0.12],
    [0, 0.15],
    [0, 0.175],
  ],
  [
    [-0.025, 0.025],
    [-0.03, 0.065],
    [-0.035, 0.095],
    [-0.04, 0.12],
    [-0.04, 0.145],
  ],
] as const;

export function createCartoonHand(): CartoonHand {
  const root = new THREE.Group();
  root.name = 'xr-cartoon-hand';
  root.visible = false;
  const material = new THREE.MeshStandardMaterial({
    color: 0xff672f,
    emissive: 0xff4f1f,
    emissiveIntensity: 0.6,
    roughness: 0.85,
    metalness: 0,
  });
  const palm = new THREE.SphereGeometry(1, 16, 12);
  const palmPositions = palm.getAttribute('position');
  const palmNormals = palm.getAttribute('normal');
  const palmCount = palmPositions.count;
  const count = palmCount + FINGERS.length * FINGER_VERTICES;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const indices = Array.from(palm.index?.array ?? []);
  for (let finger = 0; finger < FINGERS.length; finger++) {
    const start = palmCount + finger * FINGER_VERTICES;
    for (let ring = 0; ring < RINGS - 1; ring++)
      for (let side = 0; side < SIDES; side++) {
        const a = start + ring * SIDES + side;
        const b = start + ring * SIDES + ((side + 1) % SIDES);
        indices.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
      }
    for (let side = 0; side < SIDES; side++)
      indices.push(start + RINGS * SIDES, start + ((side + 1) % SIDES), start + side);
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
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'cartoon-hand-skin';
  mesh.frustumCulled = false;
  mesh.raycast = () => undefined;
  const arm = createElasticArm(material);
  arm.mesh.name = 'elastic-hand-arm';
  root.add(mesh, arm.mesh);

  const wrist = new THREE.Vector3();
  const across = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const center = new THREE.Vector3();
  const indexBase = new THREE.Vector3();
  const littleBase = new THREE.Vector3();
  const middleBase = new THREE.Vector3();
  const temp = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const position = new THREE.Vector3();
  const surfaceNormal = new THREE.Vector3();
  const wristRotation = new THREE.Quaternion();
  const cameraRotation = new THREE.Quaternion();
  const anchor = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const backNormal = new THREE.Vector3();
  const synthetic = new THREE.Group() as THREE.Group & { joints: Record<string, THREE.Group> };
  synthetic.joints = {};
  for (const name of new Set(['wrist', ...JOINT_NAMES.flat().filter(Boolean), ...LITTLE_JOINTS])) {
    const node = new THREE.Group();
    synthetic.joints[name] = node;
    synthetic.add(node);
  }
  const controllerPosition = new THREE.Vector3();
  const controllerRotation = new THREE.Quaternion();
  const controllerAcross = new THREE.Vector3();
  const controllerForward = new THREE.Vector3();
  const controllerBend = new THREE.Vector3();
  const curl = [0, 0, 0];
  const controls = FINGERS.map(() => Array.from({ length: 5 }, () => new THREE.Vector3()));
  const renderControls = FINGERS.map(() => Array.from({ length: 5 }, () => new THREE.Vector3()));
  const curves = renderControls.map(
    (points) => new THREE.CatmullRomCurve3(points, false, 'centripetal'),
  );
  const samples = Array.from({ length: SECTIONS + 1 }, () => new THREE.Vector3());
  const probePoints = FINGERS.map(() => Array.from({ length: 8 }, () => new THREE.Vector3()));
  const palmProbes = Array.from({ length: 9 }, () => new THREE.Vector3());
  const palmOffsets = palmProbes.map((_, index) =>
    index === 0
      ? new THREE.Vector2()
      : new THREE.Vector2(
          Math.cos((index * Math.PI) / 4),
          Math.sin((index * Math.PI) / 4),
        ).multiplyScalar(0.55),
  );
  const contactProbes: HandContactProbe[] = [
    { point: wrist, radius: 0.022 },
    ...palmProbes.map((point) => ({ point, radius: 0.024 })),
    ...probePoints.flatMap((points, finger) =>
      points.map((point) => ({ point, radius: RADII[finger] })),
    ),
  ];
  root.userData.armAnchor = anchor;
  root.userData.wristPosition = wrist;
  root.userData.palmForward = forward;
  root.userData.wristBackNormal = backNormal;
  root.userData.indexTip = controls[1][4];
  root.userData.middleTip = controls[2][4];
  root.userData.outerTip = controls[3][4];
  root.userData.palmPosition = center;
  root.userData.thumbTip = controls[0][4];
  let disposed = false;

  const write = (vertex: number, point: THREE.Vector3, n: THREE.Vector3): void => {
    const offset = vertex * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
    normals[offset] = n.x;
    normals[offset + 1] = n.y;
    normals[offset + 2] = n.z;
  };
  const joint = (hand: HandJoints, name: string, target: THREE.Vector3): boolean => {
    const node = hand.joints?.[name];
    if (!node?.visible) return false;
    node.getWorldPosition(target);
    return true;
  };
  const fallback = (target: THREE.Vector3, x: number, y: number): void => {
    target.copy(wrist).addScaledVector(across, x).addScaledVector(forward, y);
  };
  const hide = (): void => {
    root.visible = false;
    arm.reset();
    curl.fill(0);
  };
  const prepareRenderControls = (blend: number, width: number, length: number): void => {
    for (let finger = 0; finger < FINGERS.length; finger++)
      for (let part = 0; part < 5; part++)
        renderControls[finger][part].copy(controls[finger][part]);
    if (blend <= 0) return;
    temp.copy(controls[1][4]).sub(controls[2][4]);
    const splay = Math.max(0, 0.042 - temp.dot(across)) * blend * 0.5;
    const indexExtension = THREE.MathUtils.clamp(-0.004 - temp.dot(forward), 0, 0.022) * blend;
    for (let part = 1; part < 5; part++) {
      const fraction = part / 4;
      temp
        .copy(center)
        .addScaledVector(across, width * 0.9 + 0.05 * fraction)
        .addScaledVector(forward, -length * 0.08);
      renderControls[0][part].lerp(temp, blend);
      renderControls[1][part]
        .addScaledVector(across, splay * fraction)
        .addScaledVector(forward, indexExtension * fraction);
      renderControls[2][part].addScaledVector(across, -splay * fraction);
    }
  };

  return {
    root,
    contactProbes,
    hide,
    update(hand, camera, side, deltaSeconds) {
      if (disposed || !hand.visible) {
        hide();
        return;
      }
      hand.updateWorldMatrix(true, true);
      if (!joint(hand, 'wrist', wrist)) {
        hide();
        return;
      }
      const source = hand as HandJoints;
      root.userData.handedness = side;
      root.visible = true;
      source.joints?.wrist?.getWorldQuaternion(wristRotation);
      across.set(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(wristRotation);
      forward.set(0, 1, 0).applyQuaternion(wristRotation);
      const haveIndex = joint(source, 'index-finger-phalanx-proximal', indexBase);
      const haveLittle = joint(source, 'pinky-finger-phalanx-proximal', littleBase);
      const haveMiddle = joint(source, 'middle-finger-phalanx-proximal', middleBase);
      if (haveMiddle) forward.copy(middleBase).sub(wrist).normalize();
      if (haveIndex && haveLittle) across.copy(indexBase).sub(littleBase);
      across.addScaledVector(forward, -across.dot(forward)).normalize();
      if (across.lengthSq() < 0.5) across.set(1, 0, 0).applyQuaternion(wristRotation);
      normal.crossVectors(across, forward).normalize();
      backNormal.copy(normal).negate();
      const width =
        haveIndex && haveLittle
          ? THREE.MathUtils.clamp(indexBase.distanceTo(littleBase) * 0.75, 0.056, 0.075)
          : 0.06;
      const length = haveMiddle
        ? THREE.MathUtils.clamp(middleBase.distanceTo(wrist) * 0.64, 0.047, 0.07)
        : 0.057;
      center.copy(wrist).addScaledVector(forward, length * 0.82);
      for (const [index, probe] of palmProbes.entries())
        probe
          .copy(center)
          .addScaledVector(across, width * palmOffsets[index].x)
          .addScaledVector(forward, length * palmOffsets[index].y);
      for (let finger = 0; finger < FINGERS.length; finger++) {
        const points = controls[finger];
        for (let part = 0; part < 5; part++) {
          const name = JOINT_NAMES[finger][part];
          if (!name || !joint(source, name, points[part]))
            fallback(points[part], REST[finger][part][0], REST[finger][part][1]);
          if (finger === 3 && joint(source, LITTLE_JOINTS[part], temp))
            points[part].lerp(temp, 0.42);
        }
      }
      const fingertipDistance = Math.min(
        controls[0][4].distanceTo(controls[1][4]),
        controls[0][4].distanceTo(controls[2][4]),
        controls[0][4].distanceTo(controls[3][4]),
      );
      prepareRenderControls(
        hand === synthetic ? 0 : THREE.MathUtils.smoothstep(fingertipDistance, 0.05, 0.085),
        width,
        length,
      );
      for (let vertex = 0; vertex < palmCount; vertex++) {
        position
          .copy(center)
          .addScaledVector(across, palmPositions.getX(vertex) * width)
          .addScaledVector(forward, palmPositions.getY(vertex) * length)
          .addScaledVector(normal, palmPositions.getZ(vertex) * 0.026);
        surfaceNormal
          .copy(across)
          .multiplyScalar(palmNormals.getX(vertex) / width)
          .addScaledVector(forward, palmNormals.getY(vertex) / length)
          .addScaledVector(normal, palmNormals.getZ(vertex) / 0.026)
          .normalize();
        write(vertex, position, surfaceNormal);
      }
      for (let finger = 0; finger < FINGERS.length; finger++) {
        const points = renderControls[finger];
        if (finger === 0)
          points[0]
            .copy(center)
            .addScaledVector(across, width * 0.9)
            .addScaledVector(forward, -length * 0.08);
        else points[0].lerp(center, 0.45);
        const curve = curves[finger];
        for (let ring = 0; ring <= SECTIONS; ring++) curve.getPoint(ring / SECTIONS, samples[ring]);
        for (let probe = 0; probe < probePoints[finger].length; probe++)
          probePoints[finger][probe].copy(samples[probe * 2]);
        radial.copy(normal);
        const radius = RADII[finger];
        const start = palmCount + finger * FINGER_VERTICES;
        for (let ring = 0; ring < RINGS; ring++) {
          const sample = Math.min(ring, SECTIONS);
          tangent
            .copy(samples[Math.min(SECTIONS, sample + 1)])
            .sub(samples[Math.max(0, sample - 1)]);
          if (tangent.lengthSq() < 1e-10) tangent.copy(forward);
          tangent.normalize();
          radial.addScaledVector(tangent, -radial.dot(tangent));
          if (radial.lengthSq() < 1e-8)
            radial.copy(across).addScaledVector(tangent, -across.dot(tangent));
          radial.normalize();
          binormal.crossVectors(tangent, radial).normalize();
          const cap = ring > SECTIONS ? ((ring - SECTIONS) * Math.PI) / (2 * CAP_RINGS) : 0;
          const r = radius * Math.cos(cap);
          for (let around = 0; around < SIDES; around++) {
            const angle = (around * Math.PI * 2) / SIDES;
            surfaceNormal
              .copy(radial)
              .multiplyScalar(Math.cos(angle))
              .addScaledVector(binormal, Math.sin(angle));
            position
              .copy(samples[sample])
              .addScaledVector(surfaceNormal, r)
              .addScaledVector(tangent, radius * Math.sin(cap));
            surfaceNormal
              .multiplyScalar(Math.cos(cap))
              .addScaledVector(tangent, Math.sin(cap))
              .normalize();
            write(start + ring * SIDES + around, position, surfaceNormal);
          }
        }
        tangent.copy(samples[1]).sub(samples[0]).normalize().negate();
        write(start + RINGS * SIDES, samples[0], tangent);
      }
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('normal').needsUpdate = true;
      camera.getWorldPosition(cameraPosition);
      camera.getWorldQuaternion(cameraRotation);
      anchor
        .set(side === 'left' ? -0.2 : 0.2, -0.18, -0.04)
        .applyQuaternion(cameraRotation)
        .add(cameraPosition);
      arm.update(anchor, wrist, deltaSeconds);
    },
    updateController(pose, camera, side, gamepad, deltaSeconds) {
      if (disposed || !pose.visible) {
        hide();
        return;
      }
      pose.getWorldPosition(controllerPosition);
      pose.getWorldQuaternion(controllerRotation);
      controllerAcross.set(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(controllerRotation);
      controllerForward.set(0, 1, 0).applyQuaternion(controllerRotation);
      controllerBend.crossVectors(controllerAcross, controllerForward).normalize();
      controllerPosition.addScaledVector(controllerForward, -0.045);
      const pressure = (index: number): number => {
        const button = gamepad?.buttons[index];
        return THREE.MathUtils.clamp(button?.value ?? (button?.pressed ? 1 : 0), 0, 1);
      };
      const alpha = 1 - Math.exp(-20 * Math.max(0, deltaSeconds));
      curl[0] = THREE.MathUtils.lerp(curl[0], pressure(0), alpha);
      curl[1] = THREE.MathUtils.lerp(curl[1], pressure(1), alpha);
      curl[2] = THREE.MathUtils.lerp(curl[2], Math.max(pressure(4), pressure(5)), alpha);
      synthetic.joints.wrist.position.copy(controllerPosition);
      synthetic.joints.wrist.quaternion.copy(controllerRotation);
      for (const [digit, names] of JOINT_NAMES.entries()) {
        let y: number = REST[digit][1][1];
        let z = 0;
        for (let part = 0; part < 5; part++) {
          const name = names[part];
          if (!name) continue;
          const x = REST[digit][part][0];
          if (digit === 0) {
            y = REST[digit][part][1] * (1 - 0.12 * curl[2]);
            z = (-0.006 * curl[2] * part) / 4;
          } else if (part < 2) {
            y = REST[digit][part][1];
          } else {
            const amount = digit === 1 ? curl[0] : curl[1];
            const angle = amount * (part === 2 ? 0.8 : part === 3 ? 1.45 : 2.1);
            const length = REST[digit][part][1] - REST[digit][part - 1][1];
            y += length * Math.cos(angle);
            z += length * Math.sin(angle);
          }
          synthetic.joints[name].position
            .copy(controllerPosition)
            .addScaledVector(controllerAcross, x)
            .addScaledVector(controllerForward, y)
            .addScaledVector(controllerBend, z);
        }
      }
      for (let part = 0; part < LITTLE_JOINTS.length; part++)
        synthetic.joints[LITTLE_JOINTS[part]].position.copy(
          synthetic.joints[JOINT_NAMES[3][part]].position,
        );
      this.update(synthetic, camera, side, deltaSeconds);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      hide();
      arm.dispose();
      geometry.dispose();
      palm.dispose();
      material.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
