# Slice 4: pointer and session helpers

The package README says the app owns the renderer, session, reference space, frame loop, hit testing and input routing. That stays true for Mux XR. These two modules are optional helpers for an app that has no reason to write its own. Nothing else in the package may import them, and Mux XR must not use them.

Read `src/immersive.ts` in the sibling `audio-probe-xr` checkout (read-only) first. It is the code these helpers replace: `cast`, `visible` and `showHover`; the per-source `update` with its edge detection on `gamepad.buttons[4]`, `[5]` and `[3]`; `updateLeftStick` with hold-to-repeat; and `enter`, `supported`, `onReset`, `onEnd`.

## Files

Create only `packages/xr-workspace/src/pointer.ts`, `packages/xr-workspace/src/xr-session.ts`, `tests/pointer.test.ts`, `tests/xr-session.test.ts`. Edit nothing else. Do not import from the Mux XR app's `src/`.

## `pointer.ts`

```ts
export interface PointerHit {
  object: THREE.Object3D;
  /** The entry of `roots` the object belongs to. */
  root: THREE.Object3D;
  distance: number;
  point: THREE.Vector3;
}
export interface Pointer {
  /**
   * Nearest hit among `roots` whose object and every ancestor up to and including its root are
   * visible. The returned hit is reused by the next call.
   */
  cast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    roots: readonly THREE.Object3D[],
  ): PointerHit | null;
  /** Casts along the −Z axis of `source`'s world transform, as an XR target-ray space points. */
  castFrom(source: THREE.Object3D, roots: readonly THREE.Object3D[]): PointerHit | null;
}
export function createPointer(options?: { far?: number; layers?: readonly number[] }): Pointer;
```

- One `THREE.Raycaster`, one reused intersections array (`length = 0` before each cast), one reused `PointerHit` with its own `point` vector.
- `far` sets `raycaster.far` (default: three's default). `layers`, when given, enables those layers on `raycaster.layers` in addition to layer 0, so an app that puts menus on `ON_TOP_LAYER` can still pick them.
- For each root call `raycaster.intersectObject(root, true, hits)`; three sorts each call's results, so sort the combined array by distance once at the end, or track the nearest visible hit while iterating.
- Visibility: walk from the hit object up to the root; reject the hit if any node on the path, the root included, has `visible === false`. three's raycaster does not test this.
- `castFrom`: `source.getWorldPosition(origin)`, `source.getWorldQuaternion(q)`, `direction.set(0, 0, -1).applyQuaternion(q)`. Call `source.updateWorldMatrix(true, false)` first.

```ts
export interface ButtonEdges {
  /** Call once per frame before reading. A missing gamepad releases every button. */
  update(gamepad: Gamepad | null | undefined): void;
  /** True only on the frame the button went down. */
  pressed(index: number): boolean;
  /** True only on the frame the button came up. */
  released(index: number): boolean;
  held(index: number): boolean;
  reset(): void;
}
export function createButtonEdges(): ButtonEdges;

export interface AxisRepeat {
  /** Returns −1 or 1 on the frames the axis should act, otherwise 0. */
  update(value: number, deltaSeconds: number): -1 | 0 | 1;
  reset(): void;
}
export function createAxisRepeat(options?: {
  threshold?: number;
  initialDelay?: number;
  repeatDelay?: number;
}): AxisRepeat;
```

- `ButtonEdges`: keep the previous and current `pressed` state per index in two arrays that grow as needed.
- `AxisRepeat` defaults: `threshold` 0.6, `initialDelay` 0.4 s, `repeatDelay` 0.12 s. Fires once when `|value|` first exceeds the threshold, again after `initialDelay`, then every `repeatDelay`. A sign change or a return under the threshold resets it.

## `xr-session.ts`

Fixed foveation is the reason this helper exists. three.js asks the headset for the maximum level by default. On a Quest 3 that showed as blocky, slightly tinted rectangles in the corners of the view. A level of 0.5 keeps most of the frame time foveation saves. A write that lands late in session start can replace the level, so it is asserted every frame.

```ts
export const FOVEATION_LEVELS = { high: 1, medium: 0.5, low: 0.25, off: 0 } as const;
export type FoveationLevel = keyof typeof FOVEATION_LEVELS;

export interface XrSessionOptions {
  /** Defaults to 'immersive-vr'. */
  mode?: XRSessionMode;
  /** Tried in order until the session accepts one. Defaults to ['local-floor', 'local']. */
  referenceSpaces?: readonly XRReferenceSpaceType[];
  /** Defaults to ['hand-tracking']. Every entry of `referenceSpaces` is added as well. */
  optionalFeatures?: readonly string[];
  /** Defaults to 'medium'. */
  foveation?: FoveationLevel | number;
  onStart?(session: XRSession): void;
  onEnd?(): void;
  /** The reference space was reset, for example by the headset's recenter. */
  onReset?(): void;
  /** For tests. Defaults to `navigator.xr`. */
  xr?: XRSystem;
}
export interface XrSession {
  supported(): Promise<boolean>;
  /** Resolves once the session is presenting. Rejects if the request is refused. */
  enter(): Promise<void>;
  exit(): Promise<void>;
  readonly session: XRSession | null;
  readonly reference: XRReferenceSpace | null;
  readonly presenting: boolean;
  /** 0 to 1. */
  readonly foveation: number;
  setFoveation(level: FoveationLevel | number): void;
  /** Call once per frame. Asserts the foveation level and returns the viewer pose, if any. */
  update(frame?: XRFrame): XRViewerPose | null;
  dispose(): void;
}
export function createXrSession(
  renderer: THREE.WebGLRenderer,
  options?: XrSessionOptions,
): XrSession;
```

- `supported`: false when there is no `xr`, otherwise `xr.isSessionSupported(mode)`, and false if that rejects.
- `enter`:
  1. Return the in-flight promise if an enter is already running; resolve at once if already presenting.
  2. `xr.requestSession(mode, { optionalFeatures: [...referenceSpaces, ...optionalFeatures] })`.
  3. Listen for `end` on the session before anything else can fail.
  4. For each reference-space type in order: `await session.requestReferenceSpace(type)`; on the first that resolves, call `renderer.xr.setReferenceSpaceType(type)` and stop. If none resolves, end the session and reject.
  5. `renderer.xr.enabled = true`, `await renderer.xr.setSession(session)`.
  6. If the session ended during those awaits, return without touching state.
  7. `reference = renderer.xr.getReferenceSpace()`, add a `reset` listener that calls `onReset`, apply the foveation, call `onStart(session)`.
- `end` handler: remove the `reset` listener, clear `session` and `reference`, call `onEnd`.
- `exit`: `await session.end()` when there is one; errors from an already-ended session are swallowed.
- `setFoveation`: map a name through `FOVEATION_LEVELS`, clamp a number to 0–1, store it, and call `renderer.xr.setFoveation` when presenting.
- `update`: when not presenting or no `frame` or no reference, return null. Otherwise call `renderer.xr.setFoveation(level)` and return `frame.getViewerPose(reference) ?? null`.
- `dispose`: remove listeners and make later calls no-ops. It does not end the session.
- Type the renderer parameter as `THREE.WebGLRenderer`. Tests pass a minimal fake cast to that type.

## Tests

`tests/pointer.test.ts`:

- Two meshes on one ray: the nearer is returned; hide it and the farther is returned; hide the root and the result is null; hide an intermediate group and its descendants are skipped.
- The hit's `root` is the matching entry of `roots`.
- `castFrom` with a rotated, translated source hits what a manual origin and direction hit.
- `ButtonEdges` over a sequence of fake gamepads (`{ buttons: [{ pressed: true }] }`): pressed for one frame, held after, released for one frame, a null gamepad releases.
- `AxisRepeat`: fires at the crossing, not again before 0.4 s, again at 0.4 s, then every 0.12 s; a sign flip fires at once in the new direction; dropping under the threshold resets.

`tests/xr-session.test.ts`, with fakes for `XRSystem`, `XRSession` (an `EventTarget` with `requestReferenceSpace` and `end`) and `renderer.xr` (`enabled`, `setReferenceSpaceType`, `setSession`, `getReferenceSpace`, `setFoveation`, `isPresenting`):

- `supported` true, false, missing `xr`, and a rejecting `isSessionSupported`.
- `enter` requests the mode with the merged optional features; when `local-floor` rejects, `local` is used and passed to `setReferenceSpaceType`.
- Foveation defaults to 0.5, is applied on enter, is asserted by every `update`, and follows `setFoveation('off')` and `setFoveation(0.25)`.
- `update` returns the frame's viewer pose, and null before entering.
- The `end` event clears `session` and `reference` and calls `onEnd`; the `reset` event calls `onReset`.
- Two overlapping `enter` calls request one session.
- A session that ends while `setSession` is pending leaves `presenting` false and does not call `onStart`.

## Done when

`bunx vitest run tests/pointer.test.ts tests/xr-session.test.ts` passes, `bunx tsc --noEmit -p .` reports no errors in the two source files, and `bunx biome check` is clean on the four files.
