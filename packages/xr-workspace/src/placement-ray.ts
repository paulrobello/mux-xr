import * as THREE from 'three';

export type PlacementRayTarget = {
  source: XRInputSource;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  distance: number;
  contact: boolean;
  valid: boolean;
};

function material(color: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
}

export class PlacementRays {
  readonly group = new THREE.Group();
  private readonly beamGeometry = new THREE.CylinderGeometry(0.0015, 0.002, 1, 8);
  private readonly dotGeometry = new THREE.SphereGeometry(0.008, 12, 8);
  private readonly validBeamMaterial = material(0x9debd2);
  private readonly invalidBeamMaterial = material(0xff9b73);
  private readonly dotMaterial = material(0xffc578);
  private readonly visuals = new Map<
    XRInputSource,
    { root: THREE.Group; beam: THREE.Mesh; dot: THREE.Mesh }
  >();
  private readonly up = new THREE.Vector3(0, 1, 0);
  constructor(scene: THREE.Scene) {
    this.group.name = 'placement-ray-layer';
    scene.add(this.group);
  }
  update(targets: readonly PlacementRayTarget[]) {
    for (const visual of this.visuals.values()) visual.root.visible = false;
    for (const target of targets) {
      let visual = this.visuals.get(target.source);
      if (!visual) {
        const root = new THREE.Group();
        root.name = `placement-ray-${target.source.handedness}`;
        const beam = new THREE.Mesh(this.beamGeometry, this.validBeamMaterial);
        beam.name = 'placement-ray-beam';
        const dot = new THREE.Mesh(this.dotGeometry, this.dotMaterial);
        dot.name = 'placement-ray-contact';
        root.add(beam, dot);
        this.group.add(root);
        visual = { root, beam, dot };
        this.visuals.set(target.source, visual);
      }
      visual.root.visible = true;
      visual.root.position.copy(target.origin);
      visual.beam.position.copy(target.direction).multiplyScalar(target.distance / 2);
      visual.beam.scale.y = target.distance;
      visual.beam.quaternion.setFromUnitVectors(this.up, target.direction);
      visual.beam.material = target.valid ? this.validBeamMaterial : this.invalidBeamMaterial;
      visual.dot.visible = target.contact;
      if (target.contact)
        visual.dot.position.copy(target.direction).multiplyScalar(target.distance);
    }
    for (const [source, visual] of this.visuals)
      if (!targets.some((target) => target.source === source)) {
        visual.root.removeFromParent();
        this.visuals.delete(source);
      }
  }
  clear() {
    this.group.clear();
    this.visuals.clear();
  }
  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.beamGeometry.dispose();
    this.dotGeometry.dispose();
    this.validBeamMaterial.dispose();
    this.invalidBeamMaterial.dispose();
    this.dotMaterial.dispose();
  }
}
