# XR Workspace

`@par/xr-workspace` is a private TypeScript package for apps that render with Three.js and WebXR. The app owns the renderer, session, reference space, frame loop, hit testing, and input routing. Mount the pieces you need in your Three.js scene.

For a sibling app, add `"@par/xr-workspace": "file:../mux-xr/packages/xr-workspace"` to its dependencies and run `bun install`. Adjust the path to match your checkout. Use the Three.js version declared by the package and a bundler that reads TypeScript exports. Import from `@par/xr-workspace`. `updateScalableLabel` changes a label's text and does nothing when the text is unchanged.

| Component | Integration |
| --- | --- |
| Environments | Call `createEnvironmentController(parent)` for the built-in procedural worlds, which load as separate chunks on first use. Or supply a record keyed by your own world IDs whose values are factories or `{ load() }` loaders. A world that has not loaded yet leaves the current one mounted until it arrives, and the optional fourth argument reports each late mount. `ENVIRONMENT_FACTORIES` is the same set with every world bundled eagerly. Call `select` to switch worlds or apply a new accent. Use `enabled: false` for full passthrough. Call `update(deltaSeconds)` each frame and `dispose()` at teardown. |
| Hands and arms | Pass `handColor` and `armColor` to `createStandardHand` as `#rrggbb` strings. For an opt-in material treatment, pass `theme: { hand: { color, roughness, metalness, emissive, emissiveIntensity }, sleeve: { ... } }` or call `setTheme(theme)` and `setTheme(null)` to reset it. Call `setColor` to retint at runtime. An omitted arm tint follows the hand. `setArmVisible` hides or shows the elastic arm and `setArmGlow` sets its self-lit colour. The elastic forearm flares into the loaded hand model’s wrist opening and follows its tilt in controller and tracked-hand poses. The arm fades out within 0.3 to 0.55 m of the eye so a raised hand does not draw it across the view; pass `armNearFade: false` to keep it opaque. Feed the tracked Three.js hand or controller pose into the visual. Hand sampling and contact probes are available separately. |
| Wrist and radial menu | Give `createRadialMenu` two to eight app-defined items and an optional `accentColor`. Supply `theme` to override the glass, selected, cancel, text or outline colors for your app. Omitting it keeps the library appearance. Use `createXrRadialMenu(scene, dispatch)` for a viewer-facing wheel that supports either controller laser, thumbstick selection and the tracked-hand menu gesture. Forward `selectstart` to `handleSelectStart(source)` and `select` to `handleSelect(source)` before gameplay. A true return consumes the select. Call `update(frame, referenceSpace, timeSeconds, items, busy)` in the XR loop, `reset()` on session exit and `dispose()` on teardown. For a custom layout, `createStickRadialNavigation` exposes `selectionFor(controller, rayAction)` to combine a controller’s ray with its stick choice. For a standalone `createRadialMenu` widget, mount its root, call `open` and `update(deltaSeconds)`, and route a pick through `actionAt`. `createWristMenuWatch` accepts a caller-owned button and reports when hand contact activates it. `createHandMenuGesture` is an opt-in sustained thumb-to-ring gesture that returns its hand's `XRInputSource` once per hold. |
| Widgets | Mount a clock, timer, note, picture frame, performance gauge, or your own `SpatialWidget`. Pass wall-clock time in milliseconds to `update`. A widget can expose `activate(target)` and `setPointed(pointed)` for the host to route control hits and hover. |
| Keyboards | `createSpatialKeyboard` supports flat or curved panel keys and Keyborb. Feed a picked object to `press`. The `onKey` callback receives a semantic key and a snapshot of its modifiers. Call `update` after animating the orbs. |
| Menu panels | `createMenuPanel({ name, rows })` lays out rows of cells top-down: a cell with `onSelect` is a button, one without is text, and several cells in a row share its width by `weight`. `pinnedRows` and `pageSize` add paging with its own previous and next cells. Route a hit through `cellAt` and `activate`, highlight with `setHovered`, and change text with `setLabel`. |
| Portal occlusion | Apply `PortalOcclusion.mask(root)` to the local props that a portal obscures. Call `update(openings)` with the active mouths and their local radii before drawing. Each uniformly scaled mouth faces local +Z. Use separate materials for the destination view. Custom vertex shaders can supply `portalOcclusionWorldPosition` under `USE_PORTAL_OCCLUSION`. Call `dispose()` when the masked props leave the scene. |
| Pointer and buttons | Optional. `createPointer()` returns the nearest visible hit among the roots you pass, from an origin and direction or from an XR target-ray object. `createButtonEdges()` reports the frame a gamepad button went down or up, and `createAxisRepeat()` turns a held thumbstick axis into repeated steps. |
| Session | Optional. `createXrSession(renderer, options)` requests the session, picks the first reference space the headset accepts, reports start, end and recenter, and asserts fixed foveation every frame. It asks for medium foveation: three.js defaults to the maximum, which shows on a Quest 3 as blocky, tinted rectangles in the corners of the view. |
| Draw order and control ids | `keepAbove(root)` draws everything under a root after the rest of a single-pass scene, including objects added later, so menus are not washed out by additive scenery. Every control the package creates carries a stable `userData.controlId`; `findControl(root, id)` finds one for automated checks. |

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

The fonts and hand models ship in the package's `assets/` folder. In a build script, `await stageWorkspaceAssets('public')` from `@par/xr-workspace/stage-assets` copies them to the default paths, or run `bun x xr-workspace-assets public`. Otherwise serve the Noto files and license notices from [public/fonts](../../public/fonts) at the app's `/fonts/` path, or call `configureLabelFonts` with their URLs before creating any UI. Serve the standard hand models from [public/assets/xr-hands](../../public/assets/xr-hands) at `/assets/xr-hands/` or set `assetUrls` when creating a hand. The [hand asset provenance and license](../../assets-source/xr-hands) are in the repository.

- Use `createStickyNoteWidget(null, { id, text, onRead, onClose })` for notes. Route hits to `activate`, pass the full text through `stickyNotePages` to build a reader, and save or delete notes in your app.
- Use `createPictureFrameWidget(null, { image, depth, onDepthView, onClose })` for flat, depth, or stereo pictures. Supply a decoded canvas with its width and height, plus an optional right-eye canvas. You can provide up to two picker actions through `picker.actions`. The app loads and stores images. Canvases stay caller-owned by default. Pass `ownsCanvases: true` to let the frame clear them on replacement or disposal.
- Use `createPerfGaugeWidget()` with `setPerfSample({ fps, worstFrameMs, targetHz })` about twice a second. Include `shownPanes` to show the count. Call `resetPerf()` at the start of an XR session.

Mux XR uses the toolkit's environments, hand visual and sampling, radial and wrist UI, clock, timer, note, picture and performance widgets, and keyboard geometry and input primitives. Its scene still owns spatial manipulation, focus, persistence, terminal routing, dictation, and service widgets.

Use `createWeatherWidget()` for US ZIP forecasts and call `setWeatherZip(zip)` after mounting its root. The default fetcher requests `https://api.zippopotam.us` and `https://api.weather.gov` directly. Allow both HTTPS origins in your app's `connect-src` policy. Pass `fetchWeather` to use a different data source. Mux XR supplies its paired companion fetcher while its streamer restricts HTTPS connections to the same origin.

For a tracked-hand menu, create one `createHandMenuGesture()` recognizer per session. In the XR frame loop call `gesture.update(frame, referenceSpace, timeSeconds, enabled)`. A returned input source identifies the hand that held its thumb and ring fingertip together for 550 ms with the index and middle fingertips clear. Open the menu or dismiss it if that hand already owns it. Pass `false` during grabs or other conflicting interactions. A fresh gesture requires releasing the fingertips. Call `gesture.reset()` when ending the session.
