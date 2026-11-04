import * as THREE from 'three';
import { createScalableLabel } from './labels';

export function createKeyborbKey(label: string, diameter: number): THREE.Mesh {
  const color = new THREE.Color(0xffffff);
  const material = Object.assign(
    new THREE.ShaderMaterial({
      uniforms: { tint: { value: color } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 surfaceNormal;
        varying vec3 viewDirection;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          surfaceNormal = normalize(normalMatrix * normal);
          viewDirection = -viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 tint;
        varying vec3 surfaceNormal;
        varying vec3 viewDirection;
        void main() {
          vec3 n = normalize(surfaceNormal);
          vec3 view = normalize(viewDirection);
          vec3 light = normalize(vec3(-0.5, 0.8, 1.0));
          float rim = pow(1.0 - abs(dot(n, view)), 2.6);
          float shine = pow(max(dot(reflect(-light, n), view), 0.0), 32.0);
          vec3 shell = mix(vec3(0.04, 0.12, 0.19), vec3(0.32, 0.72, 0.84), rim);
          shell = shell * tint + vec3(shine * 0.65);
          gl_FragColor = vec4(shell, 0.18 + rim * 0.56 + shine * 0.2);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
    { color },
  );
  const root = new THREE.Mesh(new THREE.SphereGeometry(diameter / 2, 24, 16), material);
  const text = createScalableLabel(label, diameter * 0.92, diameter * 0.8, {
    backplate: false,
  });
  text.raycast = () => undefined;
  text.traverse((child) => {
    child.renderOrder = 12;
  });
  root.add(text);
  root.renderOrder = 10;
  Object.assign(root.userData, {
    keyborb: true,
    keyborbLabel: text,
    labelText: label,
    labelWidth: diameter,
    labelHeight: diameter,
  });
  return root;
}
