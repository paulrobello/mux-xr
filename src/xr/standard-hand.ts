import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type CartoonHand, createCartoonHand } from './cartoon-hand';
import { dimHandColor } from './hand-colors';
import type { HandContactProbe } from './hand-contact';
import controllerPoses from './standard-hand-controller-poses.json';

const baseUpdateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;

type HandSide = 'left' | 'right';
type TrackedHand = THREE.Group & { joints?: Record<string, THREE.Object3D | undefined> };

// The generic-hand meshes from @webxr-input-profiles/assets 1.0.20 (MIT), the hands three.js's
// XRHandModelFactory loads on Quest, served locally instead of from its CDN default.
export const STANDARD_HAND_ASSET_URLS: Record<HandSide, string> = {
  left: '/assets/xr-hands/left.glb?v=bc6778314494',
  right: '/assets/xr-hands/right.glb?v=291790c14f7f',
};
export const STANDARD_HAND_JOINTS = [
  'wrist',
  ...['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap((finger) =>
    ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(
      (part) => `${finger}-${part}`,
    ),
  ),
] as const;
const THUMB_CHAIN = [
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
];
const INDEX_CHAIN = [
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
];
const TIP_JOINTS = [
  ['indexTip', 'index-finger-tip'],
  ['middleTip', 'middle-finger-tip'],
  ['outerTip', 'ring-finger-tip'],
  ['thumbTip', 'thumb-tip'],
] as const;
// Controller mode turns each joint from the captured relaxed pose toward the captured fist:
// the thumb follows the face buttons, the index the trigger, the other fingers the grip.
const DIGIT_INPUT: Record<string, 0 | 1 | 2> = {
  thumb: 0,
  'index-finger': 1,
  'middle-finger': 2,
  'ring-finger': 2,
  'pinky-finger': 2,
};
// Each joint's parent in its digit chain; metacarpals hang from the wrist.
const PARENT = new Map<string, string>(
  STANDARD_HAND_JOINTS.slice(1).map((name, index) => [
    name,
    name.endsWith('-metacarpal') ? 'wrist' : STANDARD_HAND_JOINTS[index],
  ]),
);

export interface StandardHandOptions {
  assetUrls?: Record<HandSide, string>;
  loader?: GLTFLoader;
}
export interface StandardHand extends CartoonHand {
  assetReady: Promise<boolean>;
}
interface SideModel {
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  bones: Map<string, THREE.Bone>;
  /** Every node under the root, parents before children. */
  order: THREE.Object3D[];
  boneNames: Map<THREE.Object3D, string>;
  probeVertices: number[];
  probes: HandContactProbe[];
  probesStale: boolean;
}
interface PoseTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

// The generic hand ends in an open cut ring of wrist-only vertices a couple of centimetres
// down the forearm, tilted off the forearm axis. The cap is a thin ellipsoid fitted to that
// ring in wrist-bone space, so it moves with the skin rather than a frame rebuilt from joints.
const WRIST_CUT_BAND = 0.006;
const WRIST_CUT_PLANE_TOLERANCE = 0.001;
const WRIST_CAP_MARGIN = 0.001;
const WRIST_CAP_DEPTH = 0.007;

export interface WristCapFit {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

// The plane through the points, its normal the least-spread direction: power iteration on
// trace(C)·I − C, whose dominant eigenvector is the covariance's smallest one.
function fitPlane(
  points: THREE.Vector3[],
  guess: THREE.Vector3,
): { centroid: THREE.Vector3; normal: THREE.Vector3 } {
  const centroid = new THREE.Vector3();
  for (const point of points) centroid.add(point);
  centroid.divideScalar(points.length);
  let [xx, xy, xz, yy, yz, zz] = [0, 0, 0, 0, 0, 0];
  for (const point of points) {
    const x = point.x - centroid.x;
    const y = point.y - centroid.y;
    const z = point.z - centroid.z;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const trace = xx + yy + zz;
  const iterate = new THREE.Matrix3().set(
    trace - xx,
    -xy,
    -xz,
    -xy,
    trace - yy,
    -yz,
    -xz,
    -yz,
    trace - zz,
  );
  const normal = guess.clone();
  for (let step = 0; step < 64; step++) normal.applyMatrix3(iterate).normalize();
  if (normal.dot(guess) < 0) normal.negate();
  return { centroid, normal };
}

export function fitWristCap(mesh: THREE.SkinnedMesh): WristCapFit | undefined {
  const { bones, boneInverses } = mesh.skeleton;
  const index = (name: string): number => bones.findIndex((bone) => bone.name === name);
  const joints = ['wrist', 'middle-finger-phalanx-proximal', 'index-finger-phalanx-proximal'];
  if ([...joints, 'pinky-finger-phalanx-proximal'].some((name) => index(name) < 0))
    return undefined;
  const wrist = index('wrist');
  const toWrist = new THREE.Matrix4().multiplyMatrices(boneInverses[wrist], mesh.bindMatrix);
  const jointInWrist = (name: string): THREE.Vector3 =>
    new THREE.Vector3().applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(
        boneInverses[wrist],
        boneInverses[index(name)].clone().invert(),
      ),
    );
  const forward = jointInWrist('middle-finger-phalanx-proximal').normalize();
  const across = jointInWrist('index-finger-phalanx-proximal').sub(
    jointInWrist('pinky-finger-phalanx-proximal'),
  );
  const vertices = mesh.geometry.getAttribute('position');
  const points: THREE.Vector3[] = [];
  let nearest = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < vertices.count; vertex++) {
    const point = new THREE.Vector3().fromBufferAttribute(vertices, vertex).applyMatrix4(toWrist);
    points.push(point);
    nearest = Math.min(nearest, point.dot(forward));
  }
  // The cut is tilted, so a band at the forearm end holds only part of the ring. Its plane
  // then gathers the whole ring, and the ring alone sets the final plane.
  const band = points.filter((point) => point.dot(forward) < nearest + WRIST_CUT_BAND);
  if (band.length < 3) return undefined;
  const first = fitPlane(band, forward.clone().negate());
  const offPlane = (point: THREE.Vector3): number =>
    Math.abs(point.clone().sub(first.centroid).dot(first.normal));
  const ring = points.filter((point) => offPlane(point) < WRIST_CUT_PLANE_TOLERANCE);
  if (ring.length < 3) return undefined;
  const { centroid, normal } = fitPlane(ring, first.normal);
  const xAxis = across.addScaledVector(normal, -across.dot(normal)).normalize();
  const yAxis = new THREE.Vector3().crossVectors(normal, xAxis);
  const range = (axis: THREE.Vector3): [number, number] => {
    const values = ring.map((point) => point.dot(axis));
    return [Math.min(...values), Math.max(...values)];
  };
  const [xMin, xMax] = range(xAxis);
  const [yMin, yMax] = range(yAxis);
  const position = new THREE.Vector3()
    .addScaledVector(xAxis, (xMin + xMax) / 2)
    .addScaledVector(yAxis, (yMin + yMax) / 2)
    .addScaledVector(normal, centroid.dot(normal));
  // The extents bound the ring's box; growing them by its widest ellipse radius takes in the
  // vertices between the axes too.
  const halfX = (xMax - xMin) / 2;
  const halfY = (yMax - yMin) / 2;
  if (!(halfX > 1e-4 && halfY > 1e-4)) return undefined;
  const reach = Math.max(
    ...ring.map((point) =>
      Math.hypot(
        (point.dot(xAxis) - (xMin + xMax) / 2) / halfX,
        (point.dot(yAxis) - (yMin + yMax) / 2) / halfY,
      ),
    ),
  );
  return {
    position,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(xAxis, yAxis, normal),
    ),
    scale: new THREE.Vector3(
      halfX * reach + WRIST_CAP_MARGIN,
      halfY * reach + WRIST_CAP_MARGIN,
      WRIST_CAP_DEPTH,
    ),
  };
}

function disposeAsset(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
}

type PoseFile = Record<
  HandSide,
  { open: Record<string, number[]>; fist: Record<string, number[]>; grip: number[] }
>;
const toTransform = (values: number[]): PoseTransform => ({
  position: new THREE.Vector3().fromArray(values, 0),
  quaternion: new THREE.Quaternion().fromArray(values, 3),
});
const posesFor = (side: HandSide, kind: 'open' | 'fist'): Map<string, PoseTransform> =>
  new Map(
    Object.entries((controllerPoses as PoseFile)[side][kind]).map(([name, values]) => [
      name,
      toTransform(values),
    ]),
  );
// The WebXR grip space in the captured fist's wrist frame, inverted: grip pose to wrist pose.
const gripToWrist = (side: HandSide): THREE.Matrix4 => {
  const grip = toTransform((controllerPoses as PoseFile)[side].grip);
  return new THREE.Matrix4()
    .compose(grip.position, grip.quaternion, new THREE.Vector3(1, 1, 1))
    .invert();
};
// Joint transforms are relative to each joint's parent, so turning them keeps bone lengths.
const CONTROLLER_POSES = {
  left: {
    open: posesFor('left', 'open'),
    fist: posesFor('left', 'fist'),
    wrist: gripToWrist('left'),
  },
  right: {
    open: posesFor('right', 'open'),
    fist: posesFor('right', 'fist'),
    wrist: gripToWrist('right'),
  },
};

export function createStandardHand(options: StandardHandOptions = {}): StandardHand {
  const fallback = createCartoonHand();
  const originalUpdate = fallback.update.bind(fallback);
  const skin = fallback.root.getObjectByName('cartoon-hand-skin') as THREE.Mesh | undefined;
  fallback.root.userData.handAsset = 'loading';
  const models: Partial<Record<HandSide, SideModel>> = {};
  let loaded = false;
  let disposed = false;
  let customColor: THREE.ColorRepresentation | null = null;
  let customArmColor: THREE.ColorRepresentation | null = null;
  const armMesh = fallback.root.getObjectByName('elastic-hand-arm') as THREE.Mesh | undefined;
  // Each loaded side's own color, restored when the custom color is cleared.
  const modelColors: Partial<Record<HandSide, THREE.Color>> = {};
  // Hand and wrist cap take the hand color and the arm its own, each lit by an equal emissive
  // share so the dim scene keeps them readable.
  const tint = (
    material: THREE.Material | THREE.Material[],
    color: THREE.ColorRepresentation,
  ): void => {
    if (Array.isArray(material) || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial)
      return;
    const standard = material as THREE.MeshStandardMaterial;
    dimHandColor(standard.color, color);
    standard.emissive.copy(standard.color);
  };
  const applyColor = (): void => {
    if (!loaded) {
      fallback.setColor(customColor, customArmColor);
      return;
    }
    for (const [side, model] of Object.entries(models) as [HandSide, SideModel][]) {
      const handColor = customColor ?? modelColors[side] ?? new THREE.Color();
      if (skin) tint(skin.material, handColor);
      if (armMesh) tint(armMesh.material, customArmColor ?? handColor);
      tint(model.mesh.material, handColor);
      const cap = model.root.getObjectByName(`standard-hand-wrist-cap-${side}`);
      if (cap instanceof THREE.Mesh) tint(cap.material, handColor);
    }
  };
  const curls = [0, 0, 0];
  // The controller hand is posed as a tracked hand with every joint visible.
  const synthetic = new THREE.Group() as TrackedHand & { joints: Record<string, THREE.Group> };
  synthetic.joints = {};
  for (const name of STANDARD_HAND_JOINTS) {
    const joint = new THREE.Group();
    joint.matrixAutoUpdate = false;
    synthetic.joints[name] = joint;
    synthetic.add(joint);
  }
  const gripPosition = new THREE.Vector3();
  const gripRotation = new THREE.Quaternion();
  const jointWorld = new THREE.Matrix4();
  const parentInverse = new THREE.Matrix4();
  const relative = new THREE.Matrix4();
  const blendRotation = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const tip = new THREE.Vector3();
  const thumbTip = new THREE.Vector3();
  const pinchPoint = new THREE.Vector3();
  const loader = options.loader ?? new GLTFLoader();
  const urls = options.assetUrls ?? STANDARD_HAND_ASSET_URLS;

  const prepare = (side: HandSide, scene: THREE.Group): SideModel | undefined => {
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.raycast = () => undefined;
      if (object instanceof THREE.SkinnedMesh) meshes.push(object);
    });
    const bones = new Map<string, THREE.Bone>();
    for (const name of STANDARD_HAND_JOINTS) {
      const bone = scene.getObjectByName(name);
      if (bone instanceof THREE.Bone) bones.set(name, bone);
    }
    if (meshes.length !== 1 || bones.size !== STANDARD_HAND_JOINTS.length) return undefined;
    const mesh = meshes[0];
    scene.name = `standard-hand-root-${side}`;
    mesh.name = `standard-hand-skin-${side}`;
    // The bind bounds sit at the asset origin while the bones follow the tracked hand.
    mesh.frustumCulled = false;
    const fit = fitWristCap(mesh);
    if (fit) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mesh.material);
      cap.name = `standard-hand-wrist-cap-${side}`;
      cap.raycast = () => undefined;
      cap.frustumCulled = false;
      cap.position.copy(fit.position);
      cap.quaternion.copy(fit.quaternion);
      cap.scale.copy(fit.scale);
      (bones.get('wrist') as THREE.Bone).add(cap);
    }
    const probeVertices: number[] = [];
    const probes: HandContactProbe[] = [];
    const cells = new Set<string>();
    const vertices = mesh.geometry.getAttribute('position');
    const point = new THREE.Vector3();
    for (let index = 0; index < vertices.count; index++) {
      point.fromBufferAttribute(vertices, index);
      const cell = `${Math.floor(point.x / 0.015)},${Math.floor(point.y / 0.015)},${Math.floor(point.z / 0.015)}`;
      if (cells.has(cell)) continue;
      cells.add(cell);
      probeVertices.push(index);
      probes.push({ point: new THREE.Vector3(), radius: 0.012 });
    }
    scene.visible = false;
    const order: THREE.Object3D[] = [];
    scene.traverse((node) => {
      if (node !== scene) order.push(node);
    });
    const boneNames = new Map<THREE.Object3D, string>(
      [...bones].map(([name, bone]) => [bone, name]),
    );
    return {
      root: scene,
      mesh,
      bones,
      order,
      boneNames,
      probeVertices,
      probes,
      probesStale: true,
    };
  };

  const assetReady = Promise.allSettled(
    (['left', 'right'] as const).map((side) =>
      loader.loadAsync(urls[side]).then((gltf) => [side, gltf.scene] as const),
    ),
  )
    .then((results) => {
      const scenes = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      if (disposed || scenes.length !== results.length) {
        for (const [, scene] of scenes) disposeAsset(scene);
        if (!disposed) fallback.root.userData.handAsset = 'fallback';
        return false;
      }
      const prepared = scenes.map(([side, scene]) => [side, prepare(side, scene), scene] as const);
      if (prepared.some(([, model]) => !model)) {
        for (const [, , scene] of prepared) disposeAsset(scene);
        fallback.root.userData.handAsset = 'fallback';
        return false;
      }
      for (const [side, model] of prepared) {
        const ready = model as SideModel;
        const material = ready.mesh.material as THREE.MeshStandardMaterial;
        // The scene is lit dimly; a self-lit share keeps the gray hand readable.
        if (material.isMeshStandardMaterial) {
          modelColors[side] = material.color.clone();
          material.emissive.copy(material.color);
          material.emissiveIntensity = 0.6;
          if (skin) (skin.material as THREE.MeshStandardMaterial).copy(material);
          if (armMesh) (armMesh.material as THREE.MeshStandardMaterial).copy(material);
        }
        // A material shared by a skinned and an unskinned mesh makes three rebuild its program
        // parameters on every draw of either, so the wrist cap gets its own copy.
        const cap = ready.root.getObjectByName(`standard-hand-wrist-cap-${side}`);
        if (cap instanceof THREE.Mesh) cap.material = material.clone();
        models[side] = ready;
        fallback.root.add(ready.root);
      }
      if (skin) skin.visible = false;
      loaded = true;
      applyColor();
      fallback.root.userData.handAsset = 'loaded';
      return true;
    })
    .catch(() => {
      if (!disposed) fallback.root.userData.handAsset = 'fallback';
      return false;
    });

  // Places the wrist so the captured fist would wrap the WebXR grip origin, then builds each
  // digit outward from it, turning every joint from the relaxed capture toward the fist.
  const poseController = (pose: THREE.Object3D, side: HandSide): void => {
    const { open, fist, wrist } = CONTROLLER_POSES[side];
    pose.getWorldPosition(gripPosition);
    pose.getWorldQuaternion(gripRotation);
    synthetic.joints.wrist.matrix.compose(gripPosition, gripRotation, unitScale).multiply(wrist);
    for (const name of STANDARD_HAND_JOINTS) {
      const parent = PARENT.get(name);
      if (!parent) continue;
      const from = open.get(name) as PoseTransform;
      const to = fist.get(name) as PoseTransform;
      const finger = Object.keys(DIGIT_INPUT).find((prefix) => name.startsWith(prefix));
      blendRotation.slerpQuaternions(
        from.quaternion,
        to.quaternion,
        finger ? curls[DIGIT_INPUT[finger]] : 0,
      );
      relative.compose(from.position, blendRotation, unitScale);
      synthetic.joints[name].matrix.multiplyMatrices(synthetic.joints[parent].matrix, relative);
    }
  };

  const jointMatrix = (source: TrackedHand, name: string): THREE.Matrix4 | undefined => {
    const joint = source.joints?.[name];
    if (!joint?.visible) return undefined;
    return joint.matrixWorld;
  };

  fallback.update = (source, camera, side, deltaSeconds): void => {
    originalUpdate(source, camera, side, deltaSeconds);
    const tracked = source as TrackedHand;
    for (const [modelSide, model] of Object.entries(models) as [HandSide, SideModel][])
      model.root.visible = loaded && fallback.root.visible && modelSide === side;
    const model = models[side];
    if (!loaded || !model || !fallback.root.visible) {
      fallback.root.userData.keyborbPoint = undefined;
      return;
    }
    model.root.updateWorldMatrix(true, false);
    // Parents come first, so each bone is posed against its parent's final world matrix and one
    // pass leaves every world matrix current, as a per-bone ancestor update did.
    for (const node of model.order) {
      const parent = node.parent as THREE.Object3D;
      const name = model.boneNames.get(node);
      const matrix = name === undefined ? undefined : jointMatrix(tracked, name);
      if (matrix) {
        parentInverse.copy(parent.matrixWorld).invert();
        jointWorld.multiplyMatrices(parentInverse, matrix);
        jointWorld.decompose(node.position, node.quaternion, node.scale);
      }
      if (node.updateMatrixWorld !== baseUpdateMatrixWorld) {
        // SkinnedMesh refreshes its bind inverse in its override.
        node.updateMatrixWorld(true);
        continue;
      }
      if (node.matrixAutoUpdate) node.updateMatrix();
      if (node.matrixWorldAutoUpdate)
        node.matrixWorld.multiplyMatrices(parent.matrixWorld, node.matrix);
      node.matrixWorldNeedsUpdate = false;
    }
    model.mesh.skeleton.update();
    const bonePosition = (name: string, target: THREE.Vector3): THREE.Vector3 =>
      target.setFromMatrixPosition((model.bones.get(name) as THREE.Bone).matrixWorld);
    const userData = fallback.root.userData;
    // An untracked joint's bone keeps its last placement, so its tip keeps the cartoon's value.
    for (const [key, name] of TIP_JOINTS)
      if (tracked.joints?.[name]?.visible)
        (userData[key] as THREE.Vector3).copy(bonePosition(name, tip));
    const trackedDigits = [...THUMB_CHAIN, ...INDEX_CHAIN].every(
      (name) => tracked.joints?.[name]?.visible,
    );
    if (trackedDigits) {
      bonePosition('index-finger-tip', tip);
      bonePosition('thumb-tip', thumbTip);
      pinchPoint.addVectors(tip, thumbTip).multiplyScalar(0.5);
      userData.keyborbPoint = pinchPoint;
    } else userData.keyborbPoint = undefined;
    model.probesStale = true;
  };

  // CPU skinning reads each bone's live matrixWorld, so probes skinned on first read after a
  // pose match skinning them inside update().
  const skinProbes = (model: SideModel): HandContactProbe[] => {
    if (!model.probesStale) return model.probes;
    model.probesStale = false;
    for (let index = 0; index < model.probeVertices.length; index++) {
      const point = model.probes[index].point;
      model.mesh.getVertexPosition(model.probeVertices[index], point);
      point.applyMatrix4(model.mesh.matrixWorld);
    }
    return model.probes;
  };

  return {
    root: fallback.root,
    get contactProbes() {
      const model = models[(fallback.root.userData.handedness as HandSide) ?? 'left'];
      return loaded && model && fallback.root.visible ? skinProbes(model) : fallback.contactProbes;
    },
    assetReady,
    update: fallback.update,
    updateController(pose, camera, side, gamepad, deltaSeconds) {
      const pressure = (index: number): number =>
        THREE.MathUtils.clamp(
          gamepad?.buttons[index]?.value ?? (gamepad?.buttons[index]?.pressed ? 1 : 0),
          0,
          1,
        );
      const alpha = 1 - Math.exp(-20 * Math.max(0, deltaSeconds));
      const amounts = [Math.max(pressure(4), pressure(5)), pressure(0), pressure(1)];
      for (let input = 0; input < 3; input++)
        curls[input] = THREE.MathUtils.lerp(curls[input], amounts[input], alpha);
      if (!pose.visible) {
        this.hide();
        return;
      }
      pose.updateWorldMatrix(true, false);
      poseController(pose, side);
      fallback.update(synthetic, camera, side, deltaSeconds);
    },
    hide() {
      fallback.hide();
      curls.fill(0);
      for (const model of Object.values(models)) model.root.visible = false;
      fallback.root.userData.keyborbPoint = undefined;
    },
    setColor(color, armColor = null) {
      customColor = color;
      customArmColor = armColor;
      applyColor();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const model of Object.values(models)) disposeAsset(model.root);
      fallback.dispose();
    },
  };
}
