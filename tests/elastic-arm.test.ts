import { applyArmNearFade, createElasticArm, ELASTIC_ARM_RENDER_ORDER } from '@par/xr-workspace';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

function center(positions: THREE.BufferAttribute, segment: number, side = 0): THREE.Vector3 {
  const result = new THREE.Vector3();
  result.fromBufferAttribute(positions, segment * 10 + side);
  return result;
}

describe('elastic arm', () => {
  it('keeps endpoints exact and sags below the chord', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const anchor = new THREE.Vector3(0, 1, 0);
    const wrist = new THREE.Vector3(1, 1, 0);
    arm.update(anchor, wrist, 1);
    const positions = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(center(positions, 0).distanceTo(anchor)).toBeCloseTo(0.018, 3);
    expect(center(positions, 24).distanceTo(wrist)).toBeCloseTo(0.019, 3);
    expect(center(positions, 12).y).toBeLessThan(1);
    arm.dispose();
  });

  it('flares the wrist end into the supplied tracked wrist silhouette', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const wrist = new THREE.Vector3(1, 1, 0);
    arm.update(new THREE.Vector3(0, 1, 0), wrist, 1, {
      across: new THREE.Vector3(0, 1, 0),
      normal: new THREE.Vector3(0, 0, 1),
      radiusAcross: 0.03,
      radiusNormal: 0.02,
    });
    const positions = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const rim = Array.from({ length: 10 }, (_, side) => center(positions, 24, side));
    expect(Math.max(...rim.map((point) => point.y))).toBeCloseTo(1.03, 2);
    expect(Math.min(...rim.map((point) => point.y))).toBeCloseTo(0.97, 2);
    expect(Math.max(...rim.map((point) => point.z))).toBeCloseTo(0.02, 2);
    expect(Math.min(...rim.map((point) => point.z))).toBeCloseTo(-0.02, 2);
    const tilted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
    const across = new THREE.Vector3(0, 1, 0),
      minor = new THREE.Vector3(0, 0, 1).applyQuaternion(tilted);
    arm.update(new THREE.Vector3(0, 1, 0), wrist, 1, {
      across,
      normal: minor,
      radiusAcross: 0.03,
      radiusNormal: 0.02,
    });
    const face = across.clone().cross(minor);
    for (let i = 0; i < 10; i++) {
      const p = center(positions, 24, i).sub(wrist);
      expect(Math.abs(p.dot(face))).toBeLessThan(1e-6);
      expect(Math.hypot(p.dot(across) / 0.03, p.dot(minor) / 0.02)).toBeCloseTo(1, 4);
    }
    arm.dispose();
  });

  it('blends the fitted flare across several terminal rings', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const wrist = new THREE.Vector3(1, 1, 0);
    const profile = {
      across: new THREE.Vector3(0, 1, 0),
      normal: new THREE.Vector3(0, 0, 1),
      radiusAcross: 0.03,
      radiusNormal: 0.02,
    };
    arm.update(new THREE.Vector3(0, 1, 0), wrist, 1, profile);
    const positions = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const acrossRadius = (segment: number): number => {
      const ring = Array.from({ length: 10 }, (_, side) => center(positions, segment, side));
      const meanY = ring.reduce((sum, point) => sum + point.y, 0) / ring.length;
      return Math.max(...ring.map((point) => Math.abs(point.y - meanY)));
    };
    expect(acrossRadius(21)).toBeLessThan(acrossRadius(22));
    expect(acrossRadius(22)).toBeLessThan(acrossRadius(23));
    expect(acrossRadius(23)).toBeLessThan(acrossRadius(24));
    expect(acrossRadius(24)).toBeCloseTo(profile.radiusAcross, 4);
    arm.dispose();
  });

  it('gently widens the fallback hand end without a wrist profile', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const wrist = new THREE.Vector3(1, 1, 0);
    arm.update(new THREE.Vector3(0, 1, 0), wrist, 1);
    const positions = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const rim = Array.from({ length: 10 }, (_, side) => center(positions, 24, side));
    expect(Math.max(...rim.map((point) => point.y))).toBeCloseTo(1.019, 2);
    expect(Math.min(...rim.map((point) => point.y))).toBeCloseTo(0.981, 2);
    arm.dispose();
  });

  it('falls back to a finite procedural flare for invalid wrist profiles', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    arm.update(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 1, {
      across: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      radiusAcross: Number.NaN,
      radiusNormal: 0,
    });
    const positions = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (const value of positions.array) expect(Number.isFinite(value)).toBe(true);
    arm.dispose();
  });

  it('reuses buffers, owns geometry only, and is not pickable', () => {
    const material = new THREE.MeshBasicMaterial();
    const materialDispose = vi.spyOn(material, 'dispose');
    const arm = createElasticArm(material);
    const position = arm.mesh.geometry.getAttribute('position');
    const normal = arm.mesh.geometry.getAttribute('normal');
    const dispose = vi.spyOn(arm.mesh.geometry, 'dispose');
    arm.update(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 1);
    expect(arm.mesh.geometry.getAttribute('position')).toBe(position);
    expect(arm.mesh.geometry.getAttribute('normal')).toBe(normal);
    expect(arm.mesh.raycast).not.toBe(THREE.Mesh.prototype.raycast);
    arm.dispose();
    arm.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it('stays finite for vertical and coincident endpoints and reset clears lag', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const position = arm.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    arm.update(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0.001);
    arm.update(new THREE.Vector3(), new THREE.Vector3(0, 0, 0), 0.016);
    expect(arm.mesh.visible).toBe(false);
    for (let i = 0; i < position.array.length; i += 1)
      expect(Number.isFinite(position.array[i])).toBe(true);
    arm.reset();
    arm.update(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 2, 0), 0);
    expect(center(position, 12).y).toBeLessThan(2);
    arm.dispose();
  });

  it('stays hidden through updates after setVisible(false) and draws after scene content', () => {
    const arm = createElasticArm(new THREE.MeshBasicMaterial());
    const anchor = new THREE.Vector3();
    const wrist = new THREE.Vector3(0, 0, 1);
    expect(arm.mesh.renderOrder).toBe(ELASTIC_ARM_RENDER_ORDER);
    arm.setVisible(false);
    expect(arm.mesh.visible).toBe(false);
    arm.update(anchor, wrist, 1);
    expect(arm.mesh.visible).toBe(false);
    arm.setVisible(true);
    arm.update(anchor, wrist, 1);
    expect(arm.mesh.visible).toBe(true);
    arm.dispose();
  });

  it('fades the arm toward the eye through a patched fragment shader', () => {
    const material = new THREE.MeshStandardMaterial();
    const compile = (): string => {
      const shader = { fragmentShader: 'a\n#include <opaque_fragment>\nb' };
      material.onBeforeCompile(
        shader as THREE.WebGLProgramParametersWithUniforms,
        undefined as never,
      );
      return shader.fragmentShader;
    };
    applyArmNearFade(material, [0.3, 0.55]);
    expect(material.transparent).toBe(true);
    expect(compile()).toContain(
      'smoothstep(0.300, 0.550, length(vViewPosition));\n#include <opaque_fragment>',
    );
    const key = material.customProgramCacheKey();
    applyArmNearFade(material, [0.1, 0.2]);
    expect(material.customProgramCacheKey()).not.toBe(key);
    applyArmNearFade(material, false);
    expect(material.transparent).toBe(false);
    expect(compile()).toBe('a\n#include <opaque_fragment>\nb');
  });
});
