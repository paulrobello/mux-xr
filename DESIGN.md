---
name: Mux XR
description: A quiet sci-fi observatory for readable terminal monitoring and intentionally targeted input.
colors:
  space-black: "#080c12"
  field-black: "#0b1016"
  panel-navy: "#17212d"
  control-navy: "#192b38"
  selected-teal: "#203c48"
  hover-blue: "#264455"
  selection-blue: "#315c6d"
  border-slate: "#3a5363"
  divider-slate: "#293746"
  muted-blue-gray: "#7e96a6"
  body-blue-gray: "#b4c5cf"
  text-blue-gray: "#c9d8e3"
  text-cool: "#dce7ed"
  text-bright: "#edf7fa"
  accent-cyan: "#8be0ea"
  interactive-cyan: "#66d5e7"
  selected-text-cyan: "#a7eeef"
  terminal-black: "#05070b"
  observatory-deep: "#050a10"
  cartoon-hand-orange: "#ff672f"
  cartoon-hand-emissive: "#ff4f1f"
  wrist-watch-case: "#0b1725"
  wrist-watch-strap: "#17293a"
  pending-bell-background: "#302718"
rounded:
  sm: "4px"
  md: "8px"
spacing:
  xs: "2px"
  sm: "8px"
  md: "12px"
  lg: "14px"
  xl: "16px"
typography:
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: "1.4"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "normal"
    letterSpacing: "-0.02em"
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  terminal:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "18px"
components:
  button-control:
    backgroundColor: "{colors.control-navy}"
    textColor: "{colors.text-cool}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
    height: "34px"
  button-control-hover:
    backgroundColor: "{colors.hover-blue}"
    textColor: "{colors.text-cool}"
    rounded: "{rounded.sm}"
  button-selected:
    backgroundColor: "{colors.selection-blue}"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.sm}"
  input-field:
    backgroundColor: "{colors.field-black}"
    textColor: "{colors.text-cool}"
    rounded: "{rounded.sm}"
    padding: "8px"
  terminal-panel:
    backgroundColor: "{colors.panel-navy}"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.sm}"
---

# Design System: Mux XR

## Overview

**Creative North Star: "The Quiet Orbital Observatory"**

Mux XR is a functional monitoring instrument wrapped in a restrained sci-fi observatory. The interface stays dark and low-glare so live terminal text remains the visual priority. Controls are compact, legible, and deliberately targeted for controller use in mixed reality, while the world contributes only enough atmosphere to establish orientation.

The system uses blue-black tonal layering, cool blue-gray text, and a scarce cyan selection signal. Motion may clarify active-pane selection, but the user's viewpoint remains under their control. Passthrough, pure black, gradient, observatory, hangar deck, deep-water station, minimal studio, desert night, aurora tundra, koi garden, cloud summit, and rain rooftop backgrounds are explicit modes, not competing visual identities. The four newer worlds carry slow ambient motion (aurora curtains and snow, koi and falling leaves, rolling cloud and passing birds, city windows, beacons, traffic and rain), placed above, below, behind or far beyond the panes and kept dim and low in the forward pane sector, with no flicker faster than about 1 Hz.

**Key Characteristics:**
- Terminal content and intentional input stay primary.
- Quiet sci-fi atmosphere with no ambient sound dependency.
- Flat, dark controls with restrained cyan state emphasis.
- Spatial panels, quick commands, and virtual keyboard target readability at Quest scale; owner check pending.

## Colors

The palette is a deep blue-black field with cool slate controls and a cyan signal reserved for selection, focus, and active states.

### Primary
- **Signal Cyan** (`#8be0ea`): Selected and focused states, including active keys and panel emphasis.

### Secondary
- **Selection Blue** (`#315c6d`): Filled active controls and selection surfaces.
- **Hover Blue** (`#264455`): Desktop hover feedback on actionable controls.

### Tertiary
- **Selected Teal** (`#203c48`): Attached or active selector background.

### Neutral
- **Space Black** (`#080c12`): Desktop application field.
- **Field Black** (`#0b1016`): Text-entry surfaces and recessed fields.
- **Panel Navy** (`#17212d`): Attached selector and terminal-adjacent surfaces.
- **Control Navy** (`#192b38`): Primary control fill.
- **Text Cool** (`#dce7ed`): Control and input text.
- **Text Bright** (`#edf7fa`): High-priority labels and terminal-facing text.
- **Muted Blue-Gray** (`#7e96a6`): Secondary hierarchy and daemon metadata.
- **Border Slate** (`#3a5363`): Control outlines.
- **Divider Slate** (`#293746`): Sidebar and structural separators.

### Named Rules
**The Signal Rarity Rule.** Cyan is a state signal, not decoration. Reserve it for selection, focus, and active interaction.

## Typography

**Display Font:** system UI sans-serif
**Body Font:** inherited system UI sans-serif
**Label/Mono Font:** terminal renderer's established terminal face; UI labels remain system UI.

**Character:** Compact, neutral, and highly legible. Text hierarchy comes from cool-blue contrast and measured size changes rather than expressive type treatments.

### Hierarchy
- **Title** (600, approximately 12–16px): Panel names, mode titles, and compact workspace headings.
- **Body** (400, inherited size): Explanatory UI copy and input labels.
- **Label** (600, 10–12px): Keys, quick commands, hierarchy summaries, and status metadata.
- **Terminal** (renderer-defined): Live pane content; preserve monospace readability and avoid decorative substitutions.

### Named Rules
**The Readability Rule.** Never trade terminal legibility for atmosphere, especially in XR where panels must remain readable at physical scale.

## Layout

Desktop UI uses a full-height application frame with a top bar, a sidebar for mux hierarchy, and a stage for controls and spatial content. The scene host fills the remaining viewport and uses an 8px radius. The command editor is a three-column grid with 8px gaps, while mobile collapses into a vertically scrolling body, moves the sidebar above the stage, and keeps the XR scene at a stable 330px height. Control groups use 8–16px spacing and wrap rather than compressing labels.

Desktop terminals use flat canvases at their logical text size, with scrolling rather than shrinking an entire terminal into a narrow card. At ordinary widths panels stack. A 3D preview toggle exposes the spatial scene. Canvas backing resolution follows device density up to 2x.

In XR, every UI root is a movable spatial surface: panes, keyboard, commands, hierarchy and the workspace HUD. Grip one controller to move and rotate a root: thumbstick X yaws and Y pitches, with no Y translation. Grip plus trigger rolls around the controller laser axis with X and pushes or pulls along it with Y. Grip the same surface with both controllers to resize by hand spread, rotate by hand direction, roll by the smaller of the grips' twists about the line between them when both turn the same way, past an 8° dead zone (15° for hands, so forearms pitching during a carry do not tilt it), and move by midpoint. A hand ray grab of a surface over 0.5 m away scales the grab offset with the wrist's horizontal distance from an estimated shoulder (18 cm to the hand's side of the current head position, using the head heading at grab time), after a 5 cm dead zone, clamped to 0.3 m through 6 m (a surface already farther stays where it is). When the head heading moves more than 15° from the anchored one, the shoulder re-anchors to it and the reel rebases at the current offset, so turning in place carries the object at its distance. Leaning the head without the body still reels slightly. A re-capture of the same grab keeps reeling from its new offset. Contact grabs and controllers do not reel. A hand far grab of a terminal pane carries the grab offset from the wrist in a roll-free frame built from the ray's heading and pitch only (bending the wrist does not move it; when the ray points within about 14° of vertical the last good heading holds, then eases back to the ray's at the reel rate), keeps the pitch the pane had at grab start, and eases its yaw toward the head (rate 12/s) with zero roll, so a forearm roll neither tilts nor swings it. Controllers and other surfaces keep the rigid grip pose so thumbstick yaw, pitch and roll still apply. Each pane carries a thin glass scroll strip outside its right rim, excluded from the pane's measured footprint. The saved window preference `scrollStripSide` (right by default, left or both) chooses which mirrored rim strips show, from browser Settings or XR Settings → Display; changing it ends any strip drag. An index pinch (or trigger) on the strip starts a drag measured along the pane's own up axis in a plane fixed at pinch start, so the ray may leave the strip. After a half-line dead zone, whole lines scroll touch-style (dragging down shows older output). The strip never starts text selection, terminal mouse capture or a grab, and a grip, Warp, the radial, release or tracking loss ends it. Index pinch-drag on the screen stays text selection. An XR text selection or terminal mouse drag starts only after the hit moves at least 2 cells and 1.5° of ray angle from the press point; below that, the press and release stay a click that selects the pane without copying or sending a mouse move. Desktop pointer drags have no dead zone. The default keyboard remains small, and transforms persist while typing, retargeting and switching modes. Input panels and the radial spawn from the head's yaw-only heading (panels 1.15 m out and 0.2 m below the eye, the radial 1.05 m out and 0.05 m below), so head pitch never tips or sinks them. When hands are the tracked input (a hand source and no non-hand gamepad; a gamepad a hand source reports on squeeze does not count), the keyboard and command editor instead spawn 0.45 m out and 0.4 m below the eye, pitched 30° toward the user. Looking straight up or down, the heading is the side the head faces. A system-spawned pose re-spawns when the mode moves between typing (keyboard, command editor) and panels, and the open keyboard retains its pose when tracking switches between hands and controllers. Reopening a system-spawned keyboard uses the current input type. A grabbed pose is user-placed: it carries across modes and input changes and is the only keyboard pose saved, so a later session restores it, while a session that ends on a system spawn clears the saved keyboard pose and the next session spawns for its own input. XR has no dedicated physical resize or reset controls. If UI space is lost, with no grips held, hold both thumbstick clicks (button 3) for one second to recenter all panes, HUD and input surfaces near the current headset position and reset physical scale. This does not resize the PTY. Hands recover far panes with radial Layout → Reset layout or Closer. Saved pane, widget, HUD and keyboard poses are world (reference-space) transforms, so they stay where they were relative to the observatory whatever the head pose at reload. Older v1 saves, which were relative to the head at save time, migrate once against the nominal standing head. Placement still follows the viewer. Inside an XR session, Reset, Arrange, Closer/Farther and newly opened widgets are measured from the frame's viewer pose (three's XR camera moves from the left eye to a centre-and-back union pose during render, so it is only a fallback). Outside a tracked session they use a fixed layout viewer: a nominal head at y 1.52 m, then the last tracked head once a session ends. Desktop Arrange and Reset first return it to the nominal head; the desktop preview camera only frames the scene. Restores apply at once. HUD and keyboard saves and the floor clearance correction wait for the first frame that reports a viewer pose, because until then surfaces opened in front of the viewer, and the eye the correction turns panes toward, sit at the origin or at the previous session's pose. Desktop 3D preview keeps its mouse Smaller, Larger and Reset layout toolbar. Do not imply a fixed radial layout or a maximum panel count beyond the two-pane readability acceptance target.

## Elevation & Depth

The system is tonal rather than shadow-led. CSS surfaces distinguish field, panel, control, hover, and selected states through blue-black value steps and borders. Three.js provides depth through panel placement, frame geometry, observatory architecture, and background modes. No broad decorative drop-shadow vocabulary is established.

### Named Rules
**The Tonal Depth Rule.** Use a darker or lighter surface step before adding glow, blur, or shadow. Depth should support orientation and interaction.

## Shapes

The form language is compact and gently softened. Desktop containers use an 8px radius, while buttons, inputs, standard keys, labels, and XR controls use a tighter 4px radius. Borders are thin and cool slate. Preserve rectangular silhouettes and clear hit targets; do not turn functional controls into pills. The approved Keyborb alternate keyboard is the deliberate exception: each spatial key is a round translucent blue sphere with a white SDF glyph floating inside. Keep the existing key centers, including the single centered Space sphere and separate arrow cluster. Curvature moves and orients spheres without deforming them. Browser and native Settings share Off / On / Auto, default Auto for hand tracking. Keyborb uses trigger or index-thumb pinch selection and never types from hand contact. The Keyborb text keyboard adds a Mic orb at the top-row center when speech is supported, because its panel buttons are out of pinch reach. It starts or stops dictation through the normal Keyborb commit (on release) and shows a busy, inactive orb while transcribing. All orb shells of a keyboard draw as one instanced mesh and all glyphs as one troika `BatchedText`; the per-key orb meshes stay as invisible hit and state proxies, so a Keyborb costs a handful of draw calls rather than three per key (`make keyborb-perf-check` compares it with the closed and standard keyboards, by default under a 4x CPU throttle with one render per eye). The glyph batch rebuilds its per-glyph data only after a glyph moves or re-lays out, not on every render. Hand visuals are posed once per frame; keyboard proximity checks reuse that pose. With the Mic orb shown, the Keyborb panel drops the flat Dictation button and keeps only the Insert text, Clear and Cancel review buttons. The standard keyboard keeps its Dictation button. Keyboard and command-editor panel controls (every control except keys, orbs, the title and captions) are raised buttons: the existing label is the front face, 0.03 panel units (about 11 mm at the 0.38 spawn scale) ahead of the panel on border-slate side walls, and any ray, trigger or poke press sinks the face 0.016 units (about 6 mm) into its fixed walls for 140 ms, then eases back over 80 ms. A press is keyed by action, command and layout position, so a button rebuilt by its own action (Backing, curve steps, strip arming, Dictation) comes back already sunk. On a curved keyboard the side walls bend with the face. Every raised button's walls on a panel are merged into one non-pickable `xr-button-walls` mesh, rebuilt with the panel, so they cost one draw call. The walls are a real mesh, so they add a small contact-grab surface around each raised button.

## Components

Keyborb proximity feedback lifts the nearest orb to the midpoint between each rendered index and thumb by its full diameter along the key's surface normal. Use resting centers for nearest-key selection so the lift cannot switch its own target. Latch the displayed target through pinch closure and native-event resampling, remapping its layout slot through key rebuilds. While latched, a neighbor closer by 30% of the scaled orb diameter takes over. Pinch closure holds and highlights the key, and the opening commits it (raw opening or native selectend, whichever comes first, gated by the same keyboard state as the per-frame sample). Modifiers act on closure. A native selectend that arrives during a tracking gap commits the held key, while a raw-only pinch lost past the grace is dropped. A held key that hands over to a neighbor before release is dropped untyped, and tracking loss drops it after a 100 ms grace. Raw joint separation still determines the pinch. Ease the lift and restore it on departure, tracking loss, retargeting, mode changes or manipulation. When either hand is near a keyboard, hide both rays and block distant ray selection and grabbing. Keep local key selection and direct contact grabs available. Raw index-thumb selection closes at 4.5 cm and rearms at 5 cm. Accept a native pinch as a fallback without requiring the wider raw opening, and deduplicate it against raw activation and held pinches. Keep a consumed pinch latched through native release; rearming requires a fresh opening lasting 40 ms across at least two tracked frames. A new middle-thumb grab requires an open index finger so it cannot steal index-thumb selection. Controller fingers curl toward the palm normal, opposite the wrist-watch face, for both hands and all controller orientations. A registered pinch flashes its orb mint green for 240 ms, including when typing rebuilds the key meshes.

### UI sounds and haptics
The saved `uiSounds` preference (default on, browser Settings checkbox and XR Settings toggle) gates every interface cue. Cues are WebAudio oscillator envelopes of 30–80 ms, never audio files, and the audio context starts lazily on the first cue and resumes if suspended. Distinct cues mark a control or key press (ray, contact poke or Keyborb), grab start and end (single, contact and pair grabs, not internal re-captures), each scroll-strip line batch (rate-limited to one per 40 ms), a held modifier lock, a press-twice confirm arming (instead of the click), a paste failure and the both-stick recenter. Controllers pulse their first haptic actuator (or the dual-rumble vibration actuator) on the same events, the confirm, Reset and paste cues on the controller that pressed; hands get sound only. Off means neither sound nor haptics.

### Buttons
- **Shape:** Tight rectangular corners (4px), 34px minimum height for desktop controls.
- **Primary:** Control navy fill, cool text, and 7px 10px padding.
- **Hover / Focus:** Hover shifts to hover blue. Focus and active states use selection blue with the cyan signal border where applicable.
- **Secondary / Ghost:** Use the same compact geometry with tonal or border contrast, not a new shape language.

### Inputs / Fields
- **Style:** Recessed field black, 1px slate border, 4px radius, and 8px internal padding.
- **Focus:** Increase border contrast toward the cyan signal without adding a persistent glow.
- **Disabled:** Preserve hierarchy with reduced opacity and no misleading active color.

### Navigation
- **Style:** The mux hierarchy is a compact tree in the sidebar. Summaries use 12px cool blue-gray text, 7px vertical padding, and indentation to communicate workspace/session/window/pane structure.

### XR mux hierarchy
The immersive Panes surface renders the same workspace/session/window/pane hierarchy as native 3D geometry through `src/xr/hierarchy-navigator.ts`. **Helix Navigator** is the default style; **Spatial Docks** is the alternate spatial grouping. Both use muted teal (`#3c91a0`) and ivory (`#dce7ed`) solid node bodies, amber (`#e4a84a`) for the selected branch and attached rings, muted teal (`#1d4c59`) connectors, dark depth (`#102832`), locally bundled crisp labels and a short scale-in transition. The desktop DOM tree remains the accessible fallback.

Panes navigation initially shows the current workspace and sessions, then centers the current parent with one spherical child level while unrelated siblings disappear. Click expands a node. Ancestors remain breadcrumbs, and Home, Up and paging retain parent context. A pane leaf selects the existing terminal view and closes the navigator. B closes the navigator without invoking Focus. The navigator is a grabbable root with the same one- and two-controller gestures as other XR surfaces. Its path and transform persist across style changes. Opening it temporarily hides terminal view roots, and closing or switching away restores their prior visibility. The browser Workspace **Hierarchy style** selector and native Settings → Display **Mux tree** control are one saved, synchronized preference. These controls do not alter terminal processes or remote grids.

Keyboard curvature is a saved 0–100° preference. Curved backing and key geometry preserve ray picking and shared-root grip behavior. Key borders use textured `#7197a8`; Backing remains independent. Keyboard Dictate uses standard/prefixed Web Speech API detection, editable transcript review, explicit Insert without Enter and a captured connected target. Browser/service support and physical voice acceptance remain pending. The terminal frame applies its front-surface offset after cylindrical warp so its hollow rim retains exact screen-edge coordinates without opaque geometry behind text. The selected pane has no separate outline: its frame glows in the accent color and its bracket accents turn white and stay solid at any glass opacity.

### Cards / Containers
- **Corner Style:** 8px for the scene host and larger application containers, 4px for controls and labels.
- **Background:** Layer space black, field black, panel navy, and control navy by function.
- **Border:** Use slate borders for interactive controls and divider slate for structural separation.
- **Internal Padding:** Use 8px, 12px, or 16px based on density and viewport.

### Host clipboard

Host clipboard actions sit with the clipboard control they extend. In the browser drawer, **Host → Quest** and **Quest → Host** follow **Paste** as secondary buttons. On the XR keyboard panel, **Paste host** and **Copy to host** flank the keyboard-curve row as raised buttons. Results use the existing clipboard toast and notice line, and failures name the fix (pair in Settings, create the secret file, check port 4242). The pairing secret is a password field under **Workspace settings → Host clipboard** with **Save** and a quiet **Forget** text button. The field is never refilled, and the status line says only whether this browser is paired.

### Hover Help

Non-obvious controls explain their action on browser hover or controller-ray hover. Spatial hints use the existing dark label treatment, face the viewer and stay outside ray picking. XR tooltips keep a compact angular size by scaling with distance, appear after a 700 ms dwell, describe actions only and are hidden while gripping. There are no automatic grip instructions. Hover feedback never sends terminal input or changes its target.

### XR Terminal Panel
Each panel presents one live pane with a readable terminal surface, title/status, Disconnect/Reconnect, Close view and Bring here. Bring here places that pane level, facing the viewer's heading, at the Focus distance, ends any active Focus first, and saves the placement; the button sits left of Close view and is excluded from the pane's measured footprint. While a pane is focused its button becomes Keep here. Grid, local text zoom and glass opacity live in Settings → Selected terminal. Typing controls live on Keyboard The whole panel is a grabbable transform root, as are the keyboard, commands, hierarchy and workspace HUD surfaces. Terminal grid settings are selected-pane scoped and apply only through explicit numeric Apply controls, with presets 80x24, 100x30, 120x36 and 160x48 plus ±1/±10 draft controls. Bounds are 2..300 columns and 2..150 rows, server echo is read-only, and disconnected resize is denied. Terminal colors are a saved global preference: Comfortable is the default, with Original and Monochrome alternatives. The content remains one canvas texture on flat or curved screen geometry. Saturated color depth is a qualitative optical inference, not a proven physical display effect, and any physical effect needs owner recheck. Selection is explicit by default and independent from head-directed rendering fidelity. Optional Gaze input uses a short head-directed dwell to retarget the keyboard, with a visible target caption. Its sole native toggle lives on Keyboard, next to Backing. Settings → Display separately owns color modes and Filtering, and Settings → World owns backgrounds and VR/passthrough The native keyboard uses self-hosted OFL Noto Sans and Symbols 2 through Troika SDF 0.52.5; unsupported visual glyphs render as `?` while the original title remains. Keyboard Backing is a saved browser/native-header toggle: off hides only the backing while key buttons remain visible and the logical plane stays grabbable and can occlude gaze, retaining the input target. The native FPS HUD is an actual frame counter updated about every 500 ms, not a capacity benchmark. Comfortable-distance guidance remains qualitative GPU-shot evidence and is not headset proof. The physical controller grab pose and two-hand behavior remain unchanged. The observatory background is peripheral architecture and a distant planet, never a competing focal surface.

## Do's and Don'ts

### Do:
- **Do** keep live terminal text and targeted input visually primary.
- **Do** use the existing blue-black palette and cyan only for interaction state.
- **Do** preserve 4px control corners and 8px container corners.
- **Do** support black, gradient, observatory, hangar deck, deep-water station, minimal studio, desert night, and passthrough modes as explicit choices.
- **Do** keep motion expressive enough to explain selection while leaving viewpoint control to the user.

### Don't:
- **Don't** redirect input from gaze unless the user enables Gaze input. Show the current target and retain it while the user looks at the keyboard.
- **Don't** add ambient sound as part of the visual system.
- **Don't** use bright gradients, ornamental neon, or decorative glows that compete with pane content.
- **Don't** invent headset acceptance claims from desktop or emulator evidence.
- **Don't** turn the workspace into a fixed radial menu or elaborate window choreography for MVP.

### Update notices

Version availability uses a compact inline browser notice and a small action attached to the movable XR HUD. It does not interrupt monitoring or change terminal/input focus. Desktop updates reload automatically. Immersive updates show Update: Reload and await selection, end XR, then navigate. No centered modal is used.

### Spatial arrangements

The native Arrange surface uses four labeled choices in the existing grabbable panel style. Browser settings use a compact select and explicit Apply action that opens the 3D preview. Row, Grid, Arc and Sphere affect attached terminal roots only. Sphere occupies the forward hemisphere, with panels facing the viewer. Presets preserve physical scale and intentional input targeting. Subsequent manual placement remains under the user's control.

### Widgets, placement and filtering

The HUD uses Widgets in the former Keyboard slot. Clocks have dark physical bodies, crisp digital text or raised analog hands, a compact close action and the same grip gestures as other surfaces. The timer shares the clocks' dark body and close action: a 0.27 x 0.325 m panel, narrow enough to sit centred (x +0.01) in the 0.30 m gap between the clock bodies, with a mode toggle, a time face, Start/Pause/Reset buttons and four 0.048 m countdown presets (1, 5, 15, 25 min). Controls sit 0.02 m inside the face top and bottom, each row uses one fixed label font size, and its scale limits start at 0.65 so a preset stays about 30 mm. Its state machine lives in `src/xr/timer-state.ts` (no three.js), keeps countdown and stopwatch state separate, and derives all time from the `nowMs` passed to `update`. In stopwatch mode the presets drop out and the time and run row spread over the freed band. A countdown that ends under the stopwatch shows a `Countdown done` badge instead of covering the time, and the flash starts when the countdown is shown again. Completion pulses an amber plane over the face at 2 Hz for five seconds, then holds a dim tint beside the text `Done`. The agent board shares the clocks' dark body and close action. Each roster agent gets one dark row with a small state-colour dot (the hierarchy's agent tone colours), left-aligned `state · agent · title` text clipped to 34 characters at one uniform size, an amber-bordered `stalled` chip and a right-hand activity age. Six rows fill in pane order and then stay put: an agent keeps its slot through state flips, and past six, an urgent agent (attention or stalled, then state priority) takes the slot of the agent it displaces while the other rows hold still. A `+N more` line counts the rest, and rows close up only when an agent leaves with no newcomer. The timer spawns at (0.01, 0.3, -1.25) at scale 1. The board spawns at (0, -0.27, -1.25) and 0.8 scale (registry `spawnScale`, honored on spawn and recenter), between the clocks and the default or recentered HUD bar. The HUD's transient lines above the bar (status notice and its ×, toast, Update: Reload and the FPS readout) can fall behind the board, so they draw without depth testing at render order 40, and a ray that hits a widget first still reaches those overlay controls behind it. Other HUD controls, such as Exit, never fire through a widget. The HUD layout itself does not move. Seated (eye near 1.1 m), the world-fixed default HUD bar sits behind the board and the board covers its Exit; grab either surface to move it. Rows select their pane on trigger or pinch; grip moves the board. The bell feed shares the same body, close action and row language at 0.72 m wide: an amber-bordered `bell` or grey-bordered `note` tag, the pane title or notice text clipped to 26 characters (more shrinks the row font), and a right-hand age. It lists the scene-owned feed newest first: one row per pending pane bell (24 kept) and notices deduplicated by text (8 kept on their own budget, shown for 10 minutes), six rows with `+N more`, and a header counting bells only. Only notices passed `setNotice(text, { feed: true })` enter it; main.ts opts in streamer and connection errors, missing restored views and blocked XR entry, and direct feedback and storage failures stay HUD-only. Rows re-sort only while no controller ray hits any mesh the feed owns (`widgetOwning` on the raw hit, so gaps, body and face count and other surfaces carrying `widgetKind` do not); while one does, rows keep their slots, a cleared row leaves a gap and new entries wait in the count. XR exit releases the hold. A pane's bell entry clears on the falling edge of its `bellPending`, which every view path (selection, focus, main's `selectPane`) produces, on `removeTerminal`, and when the pane is neither listed nor attached; a rename relabels it in place. The feed spawns at (1.05, 0.15, -1.1) and 0.8 scale with registry `faceViewer: true`, which adds a yaw of atan2(-x, -z) from the spawn offset on spawn and recenter so it faces the eye, right of the analog clock and clear of the timer, the agent board and both HUD poses. The performance gauge (registry `perf-gauge`, display name Performance) shares the same dark body at 0.9 scale, spawned at (-1, 0.15, -1.1) and turned toward the eye (`faceViewer`), left of and nearer than the digital clock and clear of the board and both HUD poses. White text carries `current / target fps`, `worst (20 s)` and the shown pane count. Status is a shape as well as a colour: a green circle on pace, an amber or coral triangle below it, because label text is always white. Sparkline bars are tinted by each bar's own frame time against the budget line. The scene pushes one sample each time its frame counter reports (about 2 Hz). It skips pause intervals: one ending while the page or XR session is not visible, one spanning a `visibilitychange` event on the document or session, or one over 5 s. It resets the gauge's history at XR session start and end. The stat rows use a fixed 22 mm font, with `worst (20 s)` on its own full-width row, so they read at about 1.5 m. One `isPanelShown` predicate defines a shown pane for LOD, hand hit-testing, the ray roots and the gauge. The gauge does no per-frame work, writes its bars into preallocated buffers and re-typesets a label only when its text changes. Widget grab and close resolve the widget by root ancestry, so nodes a widget adds after creation need no stamped metadata. Picture frames are the one multi-instance widget: the registry entry sets `multiInstance`, the scene widget map and the pose store key each frame as `picture:<id>` (singleton kinds keep their bare kind key, and a bare `picture` key is refused), and the Widgets menu always reads Add Picture. The picker lives on the browser page because a file dialog cannot open inside immersive WebXR. `src/xr/picture-image.ts` decodes with `createImageBitmap`, draws into a canvas no larger than 2048 px on its long edge (three ignores `flipY` for an `ImageBitmap`, so the canvas is the texture source), closes the bitmap and re-encodes WebP for storage. URLs use `fetch` in CORS mode without credentials and are never proxied, and a fetch `TypeError` is reported as CORS or unreachable because the browser does not distinguish them. Before decoding, `probeImageSize` reads the width and height from the first 256 KB (PNG IHDR, GIF, WebP VP8/VP8L/VP8X, JPEG SOF) and refuses a source over 16384 px or 64 MP. A file over 8 MB whose header gives no size (an unknown format, or a JPEG frame header past the probed bytes) is refused rather than decoded blind; the decoded size is checked against the same limits. URL fetches carry `AbortSignal.timeout(20 s)`, which also aborts the body read, and report a timeout separately from CORS. An `http:` URL from an `https:` page is refused as mixed content before fetching. A URL body is streamed and cancelled once it passes the 40 MB cap, whether or not Content-Length is present. The frame uploads one sRGB, mipmapped `CanvasTexture` with anisotropy capped like the terminals (`min(filtering.anisotropy, renderer max)`) and disposes it and empties its canvas on close. `src/xr/picture-store.ts` keeps the blobs in IndexedDB behind a storage seam (an in-memory adapter in tests), bounded at 8 frames and 32 MB with oldest-first eviction. Restore is driven by those records: saved picture poses with no stored image are dropped, a record that no longer decodes is deleted with a notice, and session teardown keeps both. The menu's placeholder frame has no blob and at most one is open. Its pose persists under `picture:placeholder-<n>` so a reload during the exit-to-pick flow (for example the update auto-reload when XR exits) restores it on the first frame, `restorePictures` never drops that key, and filling or closing it removes the key. It spawns at (-0.67, -0.17, -1.05) and 0.6 scale, inside 45 degrees of straight ahead. The next pick takes its pose and no slot. Other frames take the lowest free slot from `pictureSpawnOffset`, five per layer with every centre within 50 degrees of forward: lower left on an arc at the base offset's radius, its mirror at lower right, then an upper row 1.05 m above the eye on a 1.4 m arc above the clocks (centre, then 32 degrees left and right). Slot 5 and up repeat the layout 0.07 m nearer per layer (the lower row also 0.035 m lower), so no two frames coincide. The registry entry sets `faceViewer`, and the yaw is taken from each frame's own slot offset. The pose store keeps each frame's slot (-1 for the placeholder's spot) and a `placed` flag set only by a grab. A grabbed frame is user-placed: recenter leaves it alone and frees its slot. A restored frame keeps its saved slot, so later picks spawn elsewhere and recenter re-slots it; a saved slot already in use is re-assigned. A filled placeholder keeps the placeholder's spot until a new placeholder spawns there, which moves it into a free slot. The scene caps frames at `PICTURE_LIMITS.maxFrames` on its own and returns the ids it evicted, so the cap holds when IndexedDB fails. The controller serializes adds and restore through one promise chain, so rapid picks cannot overshoot the cap and a restore never shows a frame an add already evicted. Changing texture filtering re-applies anisotropy to every frame through the optional `setTextureAnisotropy` widget hook. In XR, the placeholder carries Enter URL and Recent buttons (0.24 x 0.085 local, at least 0.05 m at the 0.6 placeholder scale) and a filled frame a Change button inside its bottom-left corner (keeping the frame footprint and slot clearance) that reveals the same pair over the picture. Both open input-panel modes on the shared `inputRoot`, so they spawn, grab, scale and keep HUD-overlay ray priority like Widgets and Settings. `picture-url` is a typing mode (`isTypingMode`) and counts for `isTextEntryActive`, so the physical-keyboard router hands printable keys, Backspace, Delete, arrows, Home, End, Enter and Escape to `typeTextEntryKey` and never to the shell. Its actions (Paste, Paste host, Load, Clear, Recent, Close) share one row above the field, so the panel ends at the keyboard's last row, clear of the HUD bar. The controller's notices go through `notifyPicture`: during a pick from an open picker panel they are held and shown once, as the panel's message line on failure or on the HUD after a successful pick closes the panel; otherwise they go to the HUD. A pick while one loads only shows "Loading…", and a finished pick closes its panel and clears the target only if no newer panel opened meanwhile (`pictureSession`). A restored placeholder takes back `picturePlaced` from its saved pose, so a grabbed placeholder filled after a reload stays put, and a pose `applyUIPose` would reject falls back to normal placement. The Recent eviction notice shows once per page session, and Remove shows its toast only after storage confirms the delete. `picture-url` so it gets the keyboard, hand and Keyborb input and the saved keyboard pose; its line editing reuses `editCommandDraft`, Enter submits and Escape closes. Paste and Paste host divert at the top of `pasteFrom` into the URL field (whitespace dropped) only when no pane id or the `PICTURE_URL_PASTE` sentinel is given, so an explicit terminal paste still reaches the terminal, and the native select path records a `PICTURE_URL_PASTE` sentinel instead of a pane id so the Quest clipboard read keeps its user activation with no terminal selected. `picture-gallery` lists `listRecent()` behind a generation guard (Loading…, then a 3 x 2 page of 0.4 x 0.28 thumbnails, 0.07 apart across and 0.06 down, with a 0.12 × (46 mm) centred on each thumbnail's top-right corner so it covers 0.06 of the thumbnail's width, and Enter URL beside Close on one bottom row so the panel stays above the HUD bar), creates one `CanvasTexture` per shown thumbnail that panel disposal frees, and zeroes the decoded thumbnail canvases when the mode closes. Every pick names its target frame, and `addPicture(id, image, target)` hands that frame's pose and slot to the new picture; a changed frame is closed (pose removed, `onPictureClosed`), and the controller deletes its live record before `library.add` so the frame cap never evicts an unrelated frame. The Recent library (`createRecentPictureLibrary`, database `mux-xr-recent-pictures`) is separate from the 8 live frames because closing a frame deletes its live blob. It is bounded at 12 entries and 48 MB counting blob plus thumbnail, evicts by `lastUsedAt` through `planEviction`, keys entries by source (URL or file name, size and modified time) so a repeat pick refreshes one entry, and `placeRecent` only touches the entry. Thumbnails are drawn before the frame shows, because frame disposal empties the canvas. A Recent write failure never fails the pick. Save keyboard/HUD transforms relative to the headset heading across sessions. Keep arranged terminal bounds above the Observatory or passthrough floor without constraining Black/Gradient layouts. The hangar, deep-water, studio, desert, aurora, koi, summit and rooftop environments share the observatory's 0.035 m floor and clearance. Settings → World shows the current background as a button that opens the Backgrounds picker: a 3 x 2 grid of 0.42 x 0.236 thumbnails (`src/xr/background-picker.ts`) with captions, scrolled one row at a time by ▲/▼ buttons (hidden when there is nowhere to go) or the thumbstick while the ray is on the panel, with a `Rows a–b of n` caption. The current background has an accent frame and is scrolled into view on open; picking a tile or caption switches in place, and Back returns to World. Thumbnails are 480 x 270 WebP files under `public/assets/backgrounds/`, rendered by `make background-thumbnails` through the runtime factories, each framed where that world's life is; a missing or failed thumbnail leaves a dark plate under its caption.

Expose four terminal sampling choices and bounded anisotropy in browser/native settings, with visible current values. Sharper head-gaze rendering is independent of input gaze and selection. Use stable soft circular stars with varied size and restrained color, retaining one draw call.

## XR panel ownership and direct Warp

The A radial has eight direct items: Keyboard, Commands, Panes, Layout, Warp, Widgets, Settings and Focus. Focus acts on the pane captured when the radial opened, so hands, which open the radial from the watch, reach it without the B button. Panels do not repeat global navigation, gaze targeting or world controls. Settings groups Display, World and Selected terminal. The HUD provides status, notices, updates and Exit. Hands open the radial from the watch, and controllers from right A. Left X toggles the Panes navigator directly, closing an open radial first. These are the defaults of the saved `windowPreferences.buttonMap`, which assigns Menu, Panes, Focus, Keyboard, Commands, Layout, Warp, Widgets, Settings or Nothing to right A, right B, left X and left Y from XR Settings → Controller buttons or browser Settings. A mapped panel button toggles its panel. During direct Warp, right A saves and right B cancels regardless of the map, and other face buttons do nothing. A menu press that lands in the same frame as another function yields to it. The left menu button is not used: the input-profiles registry lists it at Touch Plus `buttons[7]`, but on a Quest 3 (2026-11-10) its press never reached the page. HUD Exit and Layout → Reset layout are press-twice controls: the first press arms them (amber, relabelled Exit? or Reset?, armed cue) for `CONFIRM_WINDOW_MS` (3 s), a second press after `CONFIRM_MIN_MS` (350 ms) runs them, and pressing any other control disarms. The both-stick recenter hold and the desktop toolbar Reset layout stay single actions. The ray hit cursor is a 3 mm sphere scaled to subtend about 0.5° at its hit distance (clamped from 1.5 mm to 36 mm). With a tracked hand it grows up to 1.8× and fades from cyan to white as the index-thumb gap closes from 8 cm to 2 cm. Hands use the owner's rounded orange reference: a padded palm, three long fingers and a thumb, without nails or outlines. Ring and little-finger joints share the outer cartoon digit. Smooth matching arms stretch to camera-relative anchors 20 cm to either side, 18 cm below and 4 cm forward, with modest gravity sag and bounded curve lag. Wrist/finger tracking remains immediate. The visual meshes never intercept picking and hide/reset on tracking loss, source replacement or XR exit. Ray/contact and hover retain the controller interaction language. Index-to-thumb pinch selects, while middle-to-thumb pinch manipulates from the wrist pose. A regular VR session needs fresh browser activation to enter passthrough. An alpha-blended session switches between the full virtual world, Desk Window, and full passthrough in place. Keyboard and watch proximity suppress the relevant rays and distant actions. The palm-centered finger-axis override was reverted after owner headset testing preferred the native aim.

Warp captures the aimed pane when A opens the radial, falling back to the active pane. Right-stick X previews curvature, A commits once, and B restores the initial curvature instead of invoking Focus. Preview changes are not persisted until commit. The hand Warp panel follows the same rule: presets and steps preview live, Done persists, and Cancel, hiding the panel or switching modes restores the captured curvature. Done and the stick commit persist only when the curvature differs from the value captured at the start of the edit or a preset or stick input touched it, so an untouched commit never pins a pane while a deliberate one can pin the default. Retargeting while the panel is open restores the previous pane and captures the new one. Grips retain manipulation and pause editing. Gaze retargeting, terminal trigger input and scrolling are suppressed. Removing the target, controller disconnect, recovery, disposal or XR exit cancels safely.

Display also owns new-window glass opacity and Focus distance/warp. The new-view opacity default never overwrites a live pane or a saved pane override. Selected terminal has a Reset to defaults button (also in the browser per-pane controls) that clears the pane's saved opacity and warp from the warp store, applies the current defaults without saving them so the pane keeps following them, cancels a stick Warp edit, re-bases an open Warp panel edit on the reset values (so presets still preview, Cancel returns to the reset curve and Done saves), and leaves a Focus curve in place until Focus ends. Opacity changes rebase the Focus fade snapshot of a faded pane so the fade restore cannot overwrite them. Focus defaults to 1.5 m and flat curvature, applies settings live, and keeps its temporary curve separate from the saved per-pane warp. Exiting restores the original transform and curvature. Keep here instead ends Focus at the focused transform, drops the temporary focus curve back to the pane's saved warp, fades the siblings back and saves the placement. Starting direct Warp or opening the hand Warp panel first exits Focus. The screen and hollow rim use the same horizontal subdivision samples so their curved top/bottom edges meet continuously without opaque geometry behind text.

Radial glyphs have no rectangular backplate, retain full interaction targets and sit in front of sector glass. The terminal bezel uses a surface-aligned rim, keeping opaque interior/back faces out of transparent text columns.

The hands also present controller input: trigger pressure curls only the index finger, grip curls the other three fingers, and face buttons move the thumb. A compact navy watch showing local h:mm and AM/PM sits on the right wrist, with a band and readable face above the skin. Contact from any part of the left hand can activate its case or band. The left ray is disabled nearby and can select the watch from farther away. Touch requires withdrawal before a second press, and pointer and contact activation share a short debounce. A touch press plays the select cue once, pulsing the touching left controller when it has one. Watch activation preserves the selected pane. When an update is available, the watch menu shows a Reload update button below the radial wheel, using the same XR-exit and reload flow as the HUD action. The watch is the sole interactive avatar surface, with right A retained as the alternative.

Near standard-keyboard interaction detects each hand: enter within 14 cm of its surface to hide both lasers and poke keys with the index fingertip, then restore ray input only after both hands leave the keyboard proximity area. Front approach, withdrawal hysteresis and swept contact prevent held or fast pokes from repeating. Modifiers share the existing tap/hold behavior across keyboard rebuilds. Grip cancels contact typing. The same contact query pokes the raised panel buttons in both keyboard modes; Keyborb orbs are excluded from its targets so they stay pinch-only. A poke runs through the ray's input-target handling, so its select cue, haptic and press-twice arming match a ray press. Palm, fingertip or wrist contact plus grip captures the actual movable root before distant ray targeting. Contact respects visibility and modal ownership, survives transformed/curved keys, and resets on retarget, tracking loss, close and disposal. Hands render with the standard WebXR generic-hand meshes (`@webxr-input-profiles/assets`, the hands three.js loads on Quest), served locally, one per side. Each of the 25 bones sits on its tracked WebXR joint, so the drawn fingertips are the tracked fingertips and a tracked pinch closes on screen without pose correction. The Keyborb point is the midpoint of the tracked index and thumb tips, and contact probes sample the posed skin. Only the watch reads them, so they are skinned on first read after a pose, and the left hand's are read only while its palm is within 0.3 m of the watch. Controller mode places the wrist so the captured Quest fist wraps the WebXR grip origin (back of the hand along grip ±X, thumb toward −Z) and turns each joint from a captured relaxed hand toward that fist, which keeps every bone length through a half press. The gray skin keeps a self-lit share so it stays readable in the dim scene, and the elastic arm takes the same material. The procedural skin remains the loading and error fallback. Paul confirmed the wrist watch works on Quest 3 on November 4, 2026. New keyboard contact and touch-grab feel remain a separate device check.
