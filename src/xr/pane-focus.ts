import type * as THREE from 'three';

interface TransformSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface MaterialSnapshot {
  material: THREE.Material;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

interface FadeSnapshot {
  visible: boolean;
  materials: MaterialSnapshot[];
  progress: number;
  direction: 1 | -1;
}

interface Motion {
  fromPosition: THREE.Vector3;
  fromQuaternion: THREE.Quaternion;
  toPosition: THREE.Vector3;
  toQuaternion: THREE.Quaternion;
  elapsed: number;
}

const DURATION = 0.25;

function ease(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function materialsOf(object: THREE.Object3D): MaterialSnapshot[] {
  const snapshots = new Map<THREE.Material, MaterialSnapshot>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!snapshots.has(material))
        snapshots.set(material, {
          material,
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
        });
    }
  });
  // Terminal roots own these materials, including each Text's derived material.
  for (const { material } of snapshots.values()) {
    material.transparent = true;
    material.depthWrite = false;
    material.needsUpdate = true;
  }
  return [...snapshots.values()];
}

function setOpacity(snapshot: FadeSnapshot, amount: number): void {
  for (const value of snapshot.materials) value.material.opacity = value.opacity * amount;
}

function restoreFade(root: THREE.Group, snapshot: FadeSnapshot): void {
  root.visible = snapshot.visible;
  for (const value of snapshot.materials) {
    value.material.opacity = value.opacity;
    value.material.transparent = value.transparent;
    value.material.depthWrite = value.depthWrite;
    value.material.needsUpdate = true;
  }
  snapshot.materials.length = 0;
}

export interface PaneFocus {
  readonly activeId: string | null;
  originalTransform(root: THREE.Group): TransformSnapshot | null;
  enter(
    id: string,
    root: THREE.Group,
    roots: Iterable<THREE.Group>,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): void;
  exit(immediate?: boolean): void;
  update(deltaSeconds: number): void;
  add(root: THREE.Group): void;
  remove(root: THREE.Group): void;
  cancelMotion(root: THREE.Group): void;
  dispose(): void;
}

export function createPaneFocus(): PaneFocus {
  const roots = new Set<THREE.Group>();
  const originals = new Map<THREE.Group, TransformSnapshot>();
  const fades = new Map<THREE.Group, FadeSnapshot>();
  let activeId: string | null = null;
  let focusedRoot: THREE.Group | null = null;
  let motion: Motion | null = null;

  const beginFade = (root: THREE.Group): FadeSnapshot => {
    const existing = fades.get(root);
    if (existing) {
      existing.direction = -1;
      root.visible = existing.visible;
      root.userData.focusHidden = true;
      return existing;
    }
    const snapshot: FadeSnapshot = {
      visible: root.visible,
      materials: materialsOf(root),
      progress: 1,
      direction: -1,
    };
    fades.set(root, snapshot);
    root.userData.focusHidden = true;
    return snapshot;
  };

  const reveal = (root: THREE.Group): void => {
    const snapshot = fades.get(root);
    if (!snapshot) {
      root.userData.focusHidden = undefined;
      return;
    }
    restoreFade(root, snapshot);
    fades.delete(root);
    root.userData.focusHidden = undefined;
  };

  const restoreTransforms = (): void => {
    for (const [root, snapshot] of originals) {
      root.position.copy(snapshot.position);
      root.quaternion.copy(snapshot.quaternion);
      root.scale.copy(snapshot.scale);
    }
  };

  const exit = (immediate = false): void => {
    if (!focusedRoot && !fades.size) return;
    if (focusedRoot && originals.has(focusedRoot)) {
      const snapshot = originals.get(focusedRoot) as TransformSnapshot;
      focusedRoot.position.copy(snapshot.position);
      focusedRoot.quaternion.copy(snapshot.quaternion);
      focusedRoot.scale.copy(snapshot.scale);
    }
    motion = null;
    if (immediate) restoreTransforms();
    if (immediate) {
      for (const root of [...fades.keys()]) reveal(root);
      originals.clear();
    } else {
      for (const [root, fade] of fades) {
        fade.direction = 1;
        root.visible = fade.visible;
      }
    }
    for (const root of roots) if (!fades.has(root)) root.userData.focusHidden = undefined;
    focusedRoot = null;
    activeId = null;
    originals.clear();
  };

  const fadeRoot = (root: THREE.Group): void => {
    const snapshot = beginFade(root);
    setOpacity(snapshot, snapshot.progress);
  };

  const enter = (
    id: string,
    root: THREE.Group,
    rootIterable: Iterable<THREE.Group>,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): void => {
    if (focusedRoot && focusedRoot !== root) exit(true);
    if (fades.has(root)) reveal(root);
    for (const candidate of rootIterable) roots.add(candidate);
    roots.add(root);
    if (!originals.has(root)) {
      originals.set(root, {
        position: root.position.clone(),
        quaternion: root.quaternion.clone(),
        scale: root.scale.clone(),
      });
    }
    // Re-entry uses the original snapshot and never captures a faded pose.
    const snapshot = originals.get(root) as TransformSnapshot;
    root.position.copy(snapshot.position);
    root.quaternion.copy(snapshot.quaternion);
    root.visible = true;
    focusedRoot = root;
    activeId = id;
    motion = {
      fromPosition: root.position.clone(),
      fromQuaternion: root.quaternion.clone(),
      toPosition: position.clone(),
      toQuaternion: quaternion.clone(),
      elapsed: 0,
    };
    for (const candidate of roots) {
      if (candidate !== root) fadeRoot(candidate);
    }
  };

  return {
    get activeId() {
      return activeId;
    },
    originalTransform(root) {
      const value = originals.get(root);
      return value
        ? {
            position: value.position.clone(),
            quaternion: value.quaternion.clone(),
            scale: value.scale.clone(),
          }
        : null;
    },
    enter,
    exit,
    update(deltaSeconds: number) {
      const delta = Math.max(0, deltaSeconds);
      if (motion && focusedRoot) {
        motion.elapsed = Math.min(DURATION, motion.elapsed + delta);
        const amount = ease(motion.elapsed / DURATION);
        focusedRoot.position.lerpVectors(motion.fromPosition, motion.toPosition, amount);
        focusedRoot.quaternion.slerpQuaternions(motion.fromQuaternion, motion.toQuaternion, amount);
        if (motion.elapsed >= DURATION) motion = null;
      }
      for (const [root, fade] of [...fades]) {
        fade.progress = Math.max(
          0,
          Math.min(1, fade.progress + (fade.direction * delta) / DURATION),
        );
        setOpacity(fade, fade.progress);
        root.visible = fade.visible && fade.progress > 0;
        if (fade.progress >= 1 && fade.direction === 1) reveal(root);
      }
      if (!focusedRoot && !fades.size) originals.clear();
    },
    add(root: THREE.Group) {
      roots.add(root);
      if (focusedRoot && root !== focusedRoot) fadeRoot(root);
    },
    remove(root: THREE.Group) {
      if (root === focusedRoot) exit(true);
      else reveal(root);
      roots.delete(root);
      originals.delete(root);
    },
    cancelMotion(root: THREE.Group) {
      if (root === focusedRoot) motion = null;
    },
    dispose() {
      exit(true);
      roots.clear();
      originals.clear();
      fades.clear();
    },
  };
}
