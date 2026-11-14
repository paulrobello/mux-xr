# XR Workspace

`@par/xr-workspace` is a private TypeScript package for apps that render with Three.js and WebXR. The app owns the renderer, session, reference space, frame loop, hit testing, and input routing. Mount the pieces you need in your Three.js scene.

For a sibling app, add `"@par/xr-workspace": "file:../mux-xr/packages/xr-workspace"` to its dependencies and run `bun install`. Adjust the path to match your checkout. Use the Three.js version declared by the package and a bundler that reads TypeScript exports. Import from `@par/xr-workspace`. The `/internal/` imports support the Mux XR migration.

| Component | Integration |
| --- | --- |
| Environments | Call `createEnvironmentController(parent)` for the built-in procedural worlds, or supply a record of factories keyed by your own world IDs. Call `select` to switch worlds or apply a new accent. Use `enabled: false` for full passthrough. Call `update(deltaSeconds)` each frame and `dispose()` at teardown. |
| Hands and arms | Pass `handColor` and `armColor` to `createStandardHand` as `#rrggbb` strings. Call `setColor` to retint at runtime. An omitted arm tint follows the hand. Feed the tracked Three.js hand or controller pose into the visual. Hand sampling and contact probes are available separately. |
| Wrist and radial menu | Give `createRadialMenu` two to eight app-defined items and an optional `accentColor`. Mount its root, call `open` and `update(deltaSeconds)`, and route a pick through `actionAt`. `createWristMenuWatch` accepts a caller-owned button and reports when hand contact activates it. |
| Widgets | Mount a clock, timer, or your own `SpatialWidget`. Pass wall-clock time in milliseconds to `update`. A widget can expose `activate(target)` and `setPointed(pointed)` for the host to route control hits and hover. |
| Keyboards | `createSpatialKeyboard` supports flat or curved panel keys and Keyborb. Feed a picked object to `press`. The `onKey` callback receives a semantic key and a snapshot of its modifiers. Call `update` after animating the orbs. |

```ts
import {
  createEnvironmentController,
  createSpatialKeyboard,
  keyboardKeyLabel,
  type WorkspaceColors,
} from '@par/xr-workspace';

const colors: WorkspaceColors = {
  handColor: '#d49062',
  armColor: '#4069b0',
  accentColor: '#68d6ff',
  environmentAccentColor: '#e09c55',
};
const worlds = createEnvironmentController(scene);
worlds.select('hangar', colors);

const keyboard = createSpatialKeyboard({
  style: 'panel',
  curvatureDegrees: 35,
  onKey(key, modifiers) {
    const text = keyboardKeyLabel(key, modifiers.shift);
    handleKey(key, text, modifiers);
  },
});
keyboard.root.position.set(0, 1.05, -0.75);
keyboard.root.scale.setScalar(0.38);
scene.add(keyboard.root);
```

For near-hand Keyborb typing, mount the keyboard with `style: 'keyborb'`, pass its root to `createKeyborbInput().begin`, and feed the input helper each hand's tracked fingertip positions in world space. Pass committed printable keys and activated modifier keys to `keyboard.press`. Call `animate(deltaSeconds)` before `keyboard.update()`, and `reset` when the keyboard deactivates or the session ends. Hosts can also use ordinary ray picks to press either style.

Serve the Noto files and license notices from [public/fonts](../../public/fonts) at the app's `/fonts/` path, or call `configureLabelFonts` with their URLs before creating any UI. Serve the standard hand models from [public/assets/xr-hands](../../public/assets/xr-hands) at `/assets/xr-hands/` or set `assetUrls` when creating a hand. The [hand asset provenance and license](../../assets-source/xr-hands) are in the repository.

Mux XR uses the toolkit's environments, hand visual and sampling, radial and wrist UI, clock and timer, and keyboard geometry and input primitives. Its scene still owns spatial manipulation, focus, persistence, terminal routing, dictation, and service widgets.
