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

The system uses blue-black tonal layering, cool blue-gray text, and a scarce cyan selection signal. Motion may clarify active-pane selection, but the user's viewpoint remains under their control. Passthrough, pure black, gradient, observatory, hangar deck, deep-water station, minimal studio, and desert night backgrounds are explicit modes, not competing visual identities.

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

In XR, every UI root is a movable spatial surface: panes, keyboard, commands, hierarchy and the workspace HUD. Grip one controller to move and rotate a root: thumbstick X yaws and Y pitches, with no Y translation. Grip plus trigger rolls around the controller laser axis with X and pushes or pulls along it with Y. Grip the same surface with both controllers to resize by hand spread, rotate by hand direction, roll by the smaller of the grips' twists about the line between them when both turn the same way, past an 8° dead zone (15° for hands, so forearms pitching during a carry do not tilt it), and move by midpoint. A hand ray grab of a surface over 0.5 m away scales the grab offset with the wrist's horizontal distance from an estimated shoulder (18 cm to the hand's side of the current head position, using the head heading at grab time), after a 5 cm dead zone, clamped to 0.3 m through 6 m (a surface already farther stays where it is). When the head heading moves more than 15° from the anchored one, the shoulder re-anchors to it and the reel rebases at the current offset, so turning in place carries the object at its distance. Leaning the head without the body still reels slightly. A re-capture of the same grab keeps reeling from its new offset. Contact grabs and controllers do not reel. A hand far grab of a terminal pane carries the grab offset from the wrist in a roll-free frame built from the ray's heading and pitch only (bending the wrist does not move it; when the ray points within about 14° of vertical the last good heading holds, then eases back to the ray's at the reel rate), keeps the pitch the pane had at grab start, and eases its yaw toward the head (rate 12/s) with zero roll, so a forearm roll neither tilts nor swings it. Controllers and other surfaces keep the rigid grip pose so thumbstick yaw, pitch and roll still apply. Each pane carries a thin glass scroll strip outside its right rim, excluded from the pane's measured footprint. The saved window preference `scrollStripSide` (right by default, left or both) chooses which mirrored rim strips show, from browser Settings or XR Settings → Display; changing it ends any strip drag. An index pinch (or trigger) on the strip starts a drag measured along the pane's own up axis in a plane fixed at pinch start, so the ray may leave the strip. After a half-line dead zone, whole lines scroll touch-style (dragging down shows older output). The strip never starts text selection, terminal mouse capture or a grab, and a grip, Warp, the radial, release or tracking loss ends it. Index pinch-drag on the screen stays text selection. An XR text selection or terminal mouse drag starts only after the hit moves at least 2 cells and 1.5° of ray angle from the press point; below that, the press and release stay a click that selects the pane without copying or sending a mouse move. Desktop pointer drags have no dead zone. The default keyboard remains small, and transforms persist while typing, retargeting and switching modes. Input panels and the radial spawn from the head's yaw-only heading (panels 1.15 m out and 0.2 m below the eye, the radial 1.05 m out and 0.05 m below), so head pitch never tips or sinks them. When hands are the tracked input (a hand source and no non-hand gamepad; a gamepad a hand source reports on squeeze does not count), the keyboard and command editor instead spawn 0.45 m out and 0.4 m below the eye, pitched 30° toward the user. Looking straight up or down, the heading is the side the head faces. A system-spawned pose re-spawns when the mode moves between typing (keyboard, command editor) and panels, and a spawned keyboard moves to the matching pose when the input switches between hands and controllers (no change while neither is tracked). A grabbed pose is user-placed: it carries across modes and input changes and is the only keyboard pose saved, so a later session restores it, while a session that ends on a system spawn clears the saved keyboard pose and the next session spawns for its own input. XR has no dedicated physical resize or reset controls. If UI space is lost, with no grips held, hold both thumbstick clicks (button 3) for one second to recenter all panes, HUD and input surfaces near the current headset position and reset physical scale. This does not resize the PTY. Hands recover far panes with radial Layout → Reset layout or Closer. Saved pane, widget, HUD and keyboard poses are world (reference-space) transforms, so they stay where they were relative to the observatory whatever the head pose at reload. Older v1 saves, which were relative to the head at save time, migrate once against the nominal standing head. Placement still follows the viewer. Inside an XR session, Reset, Arrange, Closer/Farther and newly opened widgets are measured from the frame's viewer pose (three's XR camera moves from the left eye to a centre-and-back union pose during render, so it is only a fallback). Outside a tracked session they use a fixed layout viewer: a nominal head at y 1.52 m, then the last tracked head once a session ends. Desktop Arrange and Reset first return it to the nominal head; the desktop preview camera only frames the scene. Restores apply at once. HUD and keyboard saves and the floor clearance correction wait for the first frame that reports a viewer pose, because until then surfaces opened in front of the viewer, and the eye the correction turns panes toward, sit at the origin or at the previous session's pose. Desktop 3D preview keeps its mouse Smaller, Larger and Reset layout toolbar. Do not imply a fixed radial layout or a maximum panel count beyond the two-pane readability acceptance target.

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

The HUD uses Widgets in the former Keyboard slot. Clocks have dark physical bodies, crisp digital text or raised analog hands, a compact close action and the same grip gestures as other surfaces. The agent board shares the clocks' dark body and close action. Each roster agent gets one dark row with a small state-colour dot (the hierarchy's agent tone colours), left-aligned `state · agent · title` text clipped to 34 characters at one uniform size, an amber-bordered `stalled` chip and a right-hand activity age. Six rows fill in pane order and then stay put: an agent keeps its slot through state flips, and past six, an urgent agent (attention or stalled, then state priority) takes the slot of the agent it displaces while the other rows hold still. A `+N more` line counts the rest, and rows close up only when an agent leaves with no newcomer. The board spawns at (0, -0.27, -1.25) and 0.8 scale (registry `spawnScale`, honored on spawn and recenter), between the clocks and the default or recentered HUD bar. The HUD's transient lines above the bar (status notice and its ×, toast, Update: Reload and the FPS readout) can fall behind the board, so they draw without depth testing at render order 40, and a ray that hits a widget first still reaches those overlay controls behind it. Other HUD controls, such as Exit, never fire through a widget. The HUD layout itself does not move. Seated (eye near 1.1 m), the world-fixed default HUD bar sits behind the board and the board covers its Exit; grab either surface to move it. Rows select their pane on trigger or pinch; grip moves the board. Widget grab and close resolve the widget by root ancestry, so nodes a widget adds after creation need no stamped metadata. Save keyboard/HUD transforms relative to the headset heading across sessions. Keep arranged terminal bounds above the Observatory or passthrough floor without constraining Black/Gradient layouts. The hangar, deep-water, studio and desert environments share the observatory's 0.035 m floor and clearance.

Expose four terminal sampling choices and bounded anisotropy in browser/native settings, with visible current values. Sharper head-gaze rendering is independent of input gaze and selection. Use stable soft circular stars with varied size and restrained color, retaining one draw call.

## XR panel ownership and direct Warp

The A radial has eight direct items: Keyboard, Commands, Panes, Layout, Warp, Widgets, Settings and Focus. Focus acts on the pane captured when the radial opened, so hands, which open the radial from the watch, reach it without the B button. Panels do not repeat global navigation, gaze targeting or world controls. Settings groups Display, World and Selected terminal. The HUD provides status, notices, updates and Exit. Hands open the radial from the watch, and controllers from right A. Left X toggles the Panes navigator directly, closing an open radial first. These are the defaults of the saved `windowPreferences.buttonMap`, which assigns Menu, Panes, Focus, Keyboard, Commands, Layout, Warp, Widgets, Settings or Nothing to right A, right B, left X and left Y from XR Settings → Controller buttons or browser Settings. A mapped panel button toggles its panel. During direct Warp, right A saves and right B cancels regardless of the map, and other face buttons do nothing. A menu press that lands in the same frame as another function yields to it. The left menu button is not used: the input-profiles registry lists it at Touch Plus `buttons[7]`, but on a Quest 3 (2026-11-10) its press never reached the page. HUD Exit and Layout → Reset layout are press-twice controls: the first press arms them (amber, relabelled Exit? or Reset?, armed cue) for `CONFIRM_WINDOW_MS` (3 s), a second press after `CONFIRM_MIN_MS` (350 ms) runs them, and pressing any other control disarms. The both-stick recenter hold and the desktop toolbar Reset layout stay single actions. The ray hit cursor is a 3 mm sphere scaled to subtend about 0.5° at its hit distance (clamped from 1.5 mm to 36 mm). With a tracked hand it grows up to 1.8× and fades from cyan to white as the index-thumb gap closes from 8 cm to 2 cm. Hands use the owner's rounded orange reference: a padded palm, three long fingers and a thumb, without nails or outlines. Ring and little-finger joints share the outer cartoon digit. Smooth matching arms stretch to camera-relative anchors 20 cm to either side, 18 cm below and 4 cm forward, with modest gravity sag and bounded curve lag. Wrist/finger tracking remains immediate. The visual meshes never intercept picking and hide/reset on tracking loss, source replacement or XR exit. Ray/contact and hover retain the controller interaction language. Index-to-thumb pinch selects, while middle-to-thumb pinch manipulates from the wrist pose. A VR/passthrough change ends the session and prepares a fresh named browser entry action, rather than requesting a second session after an asynchronous shutdown.

Hands and controllers use the headset's native target-ray pose for picking, the visible line and its contact marker. Keyboard and watch proximity suppress the relevant rays and distant actions. The palm-centered finger-axis override was reverted after owner headset testing preferred the native aim.

Warp captures the aimed pane when A opens the radial, falling back to the active pane. Right-stick X previews curvature, A commits once, and B restores the initial curvature instead of invoking Focus. Preview changes are not persisted until commit. The hand Warp panel follows the same rule: presets and steps preview live, Done persists, and Cancel, hiding the panel or switching modes restores the captured curvature. Retargeting while the panel is open restores the previous pane and captures the new one. Grips retain manipulation and pause editing. Gaze retargeting, terminal trigger input and scrolling are suppressed. Removing the target, controller disconnect, recovery, disposal or XR exit cancels safely.

Display also owns new-window glass opacity and Focus distance/warp. The new-view opacity default never overwrites a live pane or a saved pane override. Focus defaults to 1.5 m and flat curvature, applies settings live, and keeps its temporary curve separate from the saved per-pane warp. Exiting restores the original transform and curvature. Keep here instead ends Focus at the focused transform, drops the temporary focus curve back to the pane's saved warp, fades the siblings back and saves the placement. Starting direct Warp or opening the hand Warp panel first exits Focus. The screen and hollow rim use the same horizontal subdivision samples so their curved top/bottom edges meet continuously without opaque geometry behind text.

Radial glyphs have no rectangular backplate, retain full interaction targets and sit in front of sector glass. The terminal bezel uses a surface-aligned rim, keeping opaque interior/back faces out of transparent text columns.

The hands also present controller input: trigger pressure curls only the index finger, grip curls the other three fingers, and face buttons move the thumb. A compact navy watch showing local h:mm and AM/PM sits on the right wrist, with a band and readable face above the skin. Contact from any part of the left hand can activate its case or band. The left ray is disabled nearby and can select the watch from farther away. Touch requires withdrawal before a second press, and pointer and contact activation share a short debounce. A touch press plays the select cue once, pulsing the touching left controller when it has one. Watch activation preserves the selected pane. When an update is available, the watch menu shows a Reload update button below the radial wheel, using the same XR-exit and reload flow as the HUD action. The watch is the sole interactive avatar surface, with right A retained as the alternative.

Near standard-keyboard interaction detects each hand: enter within 14 cm of its surface to hide both lasers and poke keys with the index fingertip, then restore ray input only after both hands leave the keyboard proximity area. Front approach, withdrawal hysteresis and swept contact prevent held or fast pokes from repeating. Modifiers share the existing tap/hold behavior across keyboard rebuilds. Grip cancels contact typing. The same contact query pokes the raised panel buttons in both keyboard modes; Keyborb orbs are excluded from its targets so they stay pinch-only. A poke runs through the ray's input-target handling, so its select cue, haptic and press-twice arming match a ray press. Palm, fingertip or wrist contact plus grip captures the actual movable root before distant ray targeting. Contact respects visibility and modal ownership, survives transformed/curved keys, and resets on retarget, tracking loss, close and disposal. Hands render with the standard WebXR generic-hand meshes (`@webxr-input-profiles/assets`, the hands three.js loads on Quest), served locally, one per side. Each of the 25 bones sits on its tracked WebXR joint, so the drawn fingertips are the tracked fingertips and a tracked pinch closes on screen without pose correction. The Keyborb point is the midpoint of the tracked index and thumb tips, and contact probes sample the posed skin. Only the watch reads them, so they are skinned on first read after a pose, and the left hand's are read only while its palm is within 0.3 m of the watch. Controller mode places the wrist so the captured Quest fist wraps the WebXR grip origin (back of the hand along grip ±X, thumb toward −Z) and turns each joint from a captured relaxed hand toward that fist, which keeps every bone length through a half press. The gray skin keeps a self-lit share so it stays readable in the dim scene, and the elastic arm takes the same material. The procedural skin remains the loading and error fallback. Paul confirmed the wrist watch works on Quest 3 on November 4, 2026. New keyboard contact and touch-grab feel remain a separate device check.
