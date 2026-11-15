# Slice 1: arm controls and near-eye fade

## Problem

1. A consumer cannot hide the elastic arm. `createElasticArm().update` ends with `mesh.visible = true`, so the arm reappears every frame. Audio Probe XR hides it by zeroing `layers.mask` on `getObjectByName('elastic-hand-arm')`.
2. A consumer cannot light the arm. Audio Probe XR writes the arm material's `emissive` every frame for audio-reactive arms. Two things overwrite it: `setColor` re-tints emissive, and `standard-hand.ts` copies the hand model's material over the arm material when the model loads (`armMesh.material.copy(material)`).
3. Each arm is anchored at camera-space `(±0.2, −0.18, −0.04)` in `cartoon-hand.ts`, 27 cm from the eyes. With a hand raised above eye height the tube passes 0.2–0.3 m from the eye and fills a corner of the view as a wide flat slab.

## Files

Edit only: `packages/xr-workspace/src/elastic-arm.ts`, `cartoon-hand.ts`, `standard-hand.ts`, `tests/elastic-arm.test.ts`, `tests/cartoon-hand.test.ts`, `tests/standard-hand.test.ts`.

## API

### `elastic-arm.ts`

```ts
export const ELASTIC_ARM_RENDER_ORDER = 900;
/** Metres from the eye: invisible inside `near`, fully drawn beyond `far`. */
export type ArmNearFade = readonly [near: number, far: number];
export const DEFAULT_ARM_NEAR_FADE: ArmNearFade = [0.3, 0.55];

export interface ElasticArm {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  update(anchor: THREE.Vector3, wrist: THREE.Vector3, deltaSeconds: number): void;
  reset(): void;
  /** A hidden arm stays hidden through later updates. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Makes `material` fade out toward the eye. Call again after anything copies over the material. */
export function applyArmNearFade(
  material: THREE.MeshStandardMaterial,
  fade: ArmNearFade | false,
): void;
```

- `setVisible`: keep a `shown` flag, default true. `update` still writes the geometry (so the arm is correct the moment it is shown again) and ends with `mesh.visible = shown`. `setVisible(false)` sets `mesh.visible = false` at once. `reset()` and `dispose()` keep hiding the mesh as today.
- `createElasticArm` sets `mesh.renderOrder = ELASTIC_ARM_RENDER_ORDER`. A transparent arm must blend after scene content drawn before it.
- `applyArmNearFade(material, fade)`:
  - `fade` is a pair: set `material.transparent = true`, `material.depthWrite = true`, and install
    ```ts
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `diffuseColor.a *= smoothstep(${near.toFixed(3)}, ${far.toFixed(3)}, length(vViewPosition));\n#include <opaque_fragment>`,
      );
    };
    material.customProgramCacheKey = () => `arm-near-fade:${near.toFixed(3)}:${far.toFixed(3)}`;
    ```
    `vViewPosition` is declared by the standard material's fragment shader. `opaque_fragment` writes `gl_FragColor = vec4(outgoingLight, diffuseColor.a)` when the material is transparent.
  - `fade` is `false`: set `material.transparent = false`, restore `onBeforeCompile` and `customProgramCacheKey` to no-op defaults (`() => {}` and `() => ''`).
  - Set `material.needsUpdate = true` in both cases.
  - `Material.copy()` resets `transparent`, `opacity` and `depthWrite` and leaves `onBeforeCompile` alone, so the caller re-applies the fade after a copy.

### `cartoon-hand.ts`

```ts
export interface CartoonHandOptions {
  /** Draw the elastic arm. Defaults to true. */
  arm?: boolean;
  /** Fade the arm out near the eye. Defaults to DEFAULT_ARM_NEAR_FADE; false keeps it opaque. */
  armNearFade?: ArmNearFade | false;
}
export function createCartoonHand(options?: CartoonHandOptions): CartoonHand;

export interface CartoonHand {
  // existing members unchanged, plus:
  /** Hides or shows the elastic arm; the choice survives updates, hide() and a model load. */
  setArmVisible(visible: boolean): void;
  /**
   * Self-lit colour of the arm; components may exceed 1. Null returns the arm to the emissive its
   * tint gives it. A set glow survives setColor and a model load.
   */
  setArmGlow(color: THREE.ColorRepresentation | null): void;
}
```

Implementation:

- After `const armMaterial = material.clone();` call `applyArmNearFade(armMaterial, options.armNearFade ?? DEFAULT_ARM_NEAR_FADE)`. Call `arm.setVisible(options.arm ?? true)`.
- Keep `let armGlow: THREE.Color | null = null;`. `setArmGlow(color)`: when `color` is null, clear `armGlow` and re-run the arm part of the tint (the two `dimHandColor(armMaterial…)` lines) with the current colours; otherwise store `new THREE.Color(color)` (or copy into the existing one) and copy it into `armMaterial.emissive`.
- `setColor` today takes the colours as arguments and does not store them. Store the last `color` and `armColor` in closure variables so `setArmGlow(null)` can restore the tint. In `setColor`, after tinting, if `armGlow` is set copy it back into `armMaterial.emissive`.
- `setArmVisible(visible)` forwards to `arm.setVisible`.
- Expose one more internal hook for the standard hand, on the returned object but not on the public interface type if you can avoid it. The simplest form that type-checks: put `reapplyArmMaterial(): void` on `CartoonHand` with a doc comment saying it is for hand visuals that replace the arm material's contents. It calls `applyArmNearFade(armMaterial, fade)` with the stored fade option and, when `armGlow` is set, copies it into `armMaterial.emissive`.

### `standard-hand.ts`

```ts
export interface StandardHandOptions
  extends Pick<WorkspaceColors, 'handColor' | 'armColor'>,
    CartoonHandOptions {
  assetUrls?: Record<HandSide, string>;
  loader?: GLTFLoader;
}
```

- `createStandardHand` passes `{ arm: options.arm, armNearFade: options.armNearFade }` to `createCartoonHand`.
- The returned object is built by hand near the end of the function (`root: fallback.root, …`). Add `setArmVisible: (visible) => fallback.setArmVisible(visible)` and `setArmGlow`, and `reapplyArmMaterial` if the interface requires it.
- The standard hand has its own tint path, `applyColor`, which for a loaded model sets `armMesh.material` colour and then `emissive.copy(color)`. Track the glow here too: keep `let armGlow: THREE.Color | null`. `setArmGlow(color)` stores it, forwards to `fallback.setArmGlow(color)`, and when `color` is null and the model is loaded calls `applyColor()` so the loaded-model tint is restored. At the end of `applyColor`, when `armGlow` is set, copy it into the arm material's emissive.
- At the model load, directly after `if (armMesh) (armMesh.material as THREE.MeshStandardMaterial).copy(material);`, call `fallback.reapplyArmMaterial()`. The existing `applyColor()` a few lines later then re-tints, and the glow is restored by the step above.
- Another branch is adding typed joint accessors to this file. Keep this diff small and local to the places named here.

## Tests

Follow the construction patterns already in the three test files.

- `elastic-arm.test.ts`: after `setVisible(false)`, `update(...)` leaves `mesh.visible` false; after `setVisible(true)` and an update it is true. `mesh.renderOrder` equals `ELASTIC_ARM_RENDER_ORDER`. `applyArmNearFade` with a pair sets `transparent`, and its `onBeforeCompile` rewrites a shader object `{ fragmentShader: 'a\n#include <opaque_fragment>\nb' }` to contain `smoothstep(0.300, 0.550, length(vViewPosition))` before the include; different ranges give different `customProgramCacheKey()` values; `false` leaves `transparent` false and the fragment unchanged.
- `cartoon-hand.test.ts`: the arm mesh (`root.getObjectByName('elastic-hand-arm')`) is transparent by default and opaque with `armNearFade: false`; `createCartoonHand({ arm: false })` and `setArmVisible(false)` keep it hidden through an `update`; `setArmGlow('#ff0000')` sets the arm emissive and a later `setColor('#00ff00')` leaves the emissive red while the hand's emissive changes; `setArmGlow(null)` returns the arm emissive to the tinted value; the hand's own material emissive is never the glow.
- `standard-hand.test.ts`: this file already simulates the model load (it reads the GLB files). After the load resolves, the arm material is still transparent, and a glow set before the load is still the arm's emissive. `setArmVisible(false)` survives the load and an update.

## Done when

`bunx vitest run tests/elastic-arm.test.ts tests/cartoon-hand.test.ts tests/standard-hand.test.ts tests/xr-controller.test.ts` passes, `bunx tsc --noEmit -p .` reports no errors in the three source files, and `bunx biome check` is clean on the six files.
