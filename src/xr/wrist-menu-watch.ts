import * as THREE from 'three';

export interface WristMenuWatch {
  root: THREE.Group;
  update(wrist: THREE.Vector3, forward: THREE.Vector3, backNormal: THREE.Vector3): void;
  setVisible(visible: boolean): void;
  updateTouch(leftIndexTip: THREE.Vector3 | null): boolean;
  dispose(): void;
}

export function createWristMenuWatch(button: THREE.Mesh): WristMenuWatch {
  const root = new THREE.Group();
  root.name = 'xr-wrist-menu-watch';
  root.visible = false;
  const caseGeometry = new THREE.BoxGeometry(0.06, 0.044, 0.012);
  const caseMaterial = new THREE.MeshBasicMaterial({ color: 0x0b1725 });
  const watchCase = new THREE.Mesh(caseGeometry, caseMaterial);
  watchCase.name = 'xr-wrist-menu-watch-case';
  watchCase.raycast = () => undefined;
  const strapGeometry = new THREE.TorusGeometry(0.022, 0.005, 8, 20);
  const strapMaterial = new THREE.MeshBasicMaterial({ color: 0x17293a });
  const strap = new THREE.Mesh(strapGeometry, strapMaterial);
  strap.rotation.x = Math.PI / 2;
  strap.name = 'xr-wrist-menu-watch-strap';
  strap.raycast = () => undefined;
  button.userData.inputAction = 'wristMenu';
  button.position.z = 0.009;
  root.add(strap, watchCase, button);

  const basis = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const center = new THREE.Vector3();
  const buttonNormal = new THREE.Vector3();
  const delta = new THREE.Vector3();
  let armed = false;
  let latched = false;
  let disposed = false;

  const update = (
    wrist: THREE.Vector3,
    forward: THREE.Vector3,
    backNormal: THREE.Vector3,
  ): void => {
    if (disposed) return;
    up.copy(forward);
    normal.copy(backNormal);
    if (up.lengthSq() < 1e-8 || normal.lengthSq() < 1e-8) return;
    up.normalize();
    normal.normalize();
    right.crossVectors(up, normal);
    if (right.lengthSq() < 1e-8) return;
    right.normalize();
    normal.crossVectors(right, up).normalize();
    basis.makeBasis(right, up, normal);
    rotation.setFromRotationMatrix(basis);
    root.position.copy(wrist).addScaledVector(up, 0.012).addScaledVector(normal, 0.03);
    root.quaternion.copy(rotation);
    strap.position.set(0, -0.012, -0.03);
  };
  const setVisible = (visible: boolean): void => {
    root.visible = visible;
    if (!visible) {
      armed = false;
      latched = false;
    }
  };
  const updateTouch = (tip: THREE.Vector3 | null): boolean => {
    if (disposed || !root.visible || !tip) {
      armed = false;
      latched = false;
      return false;
    }
    button.updateMatrixWorld(true);
    button.getWorldPosition(center);
    button.getWorldQuaternion(rotation);
    buttonNormal.set(0, 0, 1).applyQuaternion(rotation).normalize();
    delta.copy(tip).sub(center);
    const planeOffset = delta.dot(buttonNormal);
    const radial = Math.max(0, delta.lengthSq() - planeOffset * planeOffset);
    if (planeOffset > 0.035 || (planeOffset >= 0 && radial > 0.045 * 0.045)) {
      armed = true;
      latched = false;
    }
    if (!armed || latched || planeOffset < -0.004 || planeOffset > 0.014 || radial > 0.027 * 0.027)
      return false;
    latched = true;
    return true;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    root.visible = false;
    root.removeFromParent();
    root.remove(button);
    root.remove(watchCase, strap);
    caseGeometry.dispose();
    caseMaterial.dispose();
    strapGeometry.dispose();
    strapMaterial.dispose();
    root.clear();
  };
  return { root, update, setVisible, updateTouch, dispose };
}
