import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { quietObservatoryPlanet } from '../src/environment';

describe('authored observatory display treatment', () => {
  it('dims only the authored distant planet material', () => {
    const root = new THREE.Group();
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshStandardMaterial({ emissiveIntensity: 0.23 }),
    );
    planet.name = 'observatory_distant_planet';
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    panel.name = 'observatory_window_sill';
    root.add(planet, panel);
    quietObservatoryPlanet(root);
    expect(planet.material.color.getHex()).toBe(0x172b3e);
    expect((planet.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.05);
    expect((panel.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(1);
  });

  it('leaves fallback and unrelated meshes unchanged when authored planet is absent', () => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshStandardMaterial({ emissiveIntensity: 0.8 }),
    );
    quietObservatoryPlanet(mesh);
    expect((mesh.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.8);
  });
});
