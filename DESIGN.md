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

The system uses blue-black tonal layering, cool blue-gray text, and a scarce cyan selection signal. Motion may clarify active-pane selection, but the user's viewpoint remains under their control. Passthrough, pure black, gradient, and observatory backgrounds are explicit modes, not competing visual identities.

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

In XR, every UI root is a movable spatial surface: panes, keyboard, commands, hierarchy and the workspace HUD. Grip one controller to move and rotate a root: thumbstick X yaws and Y pitches, with no Y translation. Grip plus trigger rolls around the controller laser axis with X and pushes or pulls along it with Y. Grip the same surface with both controllers to resize by hand spread, rotate by hand direction and move by midpoint. The default keyboard remains small, and transforms persist while typing, retargeting and switching modes. XR has no dedicated physical resize or reset controls. If UI space is lost, with no grips held, hold both thumbstick clicks (button 3) for one second to recenter all panes, HUD and input surfaces near the current headset position and reset physical scale. This does not resize the PTY. Desktop 3D preview keeps its mouse Smaller, Larger and Reset layout toolbar. Do not imply a fixed radial layout or a maximum panel count beyond the two-pane readability acceptance target.

## Elevation & Depth

The system is tonal rather than shadow-led. CSS surfaces distinguish field, panel, control, hover, and selected states through blue-black value steps and borders. Three.js provides depth through panel placement, frame geometry, observatory architecture, and background modes. No broad decorative drop-shadow vocabulary is established.

### Named Rules
**The Tonal Depth Rule.** Use a darker or lighter surface step before adding glow, blur, or shadow. Depth should support orientation and interaction.

## Shapes

The form language is compact and gently softened. Desktop containers use an 8px radius, while buttons, inputs, standard keys, labels, and XR controls use a tighter 4px radius. Borders are thin and cool slate. Preserve rectangular silhouettes and clear hit targets; do not turn functional controls into pills. The approved Keyborb alternate keyboard is the deliberate exception: each spatial key is a round translucent blue sphere with a white SDF glyph floating inside. Keep the existing key centers, including the single centered Space sphere and separate arrow cluster. Curvature moves and orients spheres without deforming them. Browser and native Settings share Off / On / Auto, default Auto for hand tracking. Keyborb uses trigger or index-thumb pinch selection and never types from hand contact.

## Components

Keyborb proximity feedback lifts the nearest orb to the midpoint between each hand's index and thumb by its full diameter along the key's surface normal. Use resting centers for nearest-key selection so the lift cannot switch its own target. Ease the lift and restore it on departure, tracking loss, retargeting, mode changes or manipulation. When either hand is near a keyboard, hide both rays and block distant ray selection and grabbing. Keep local key selection and direct contact grabs available. Raw index-thumb selection closes at 4.5 cm and rearms at 5 cm. Accept a native pinch as a fallback without requiring the wider raw opening, and deduplicate it against raw activation and held pinches. Keep a consumed pinch latched through native release; rearming requires a fresh opening lasting 40 ms across at least two tracked frames. A new middle-thumb grab requires an open index finger so it cannot steal index-thumb selection. Controller fingers curl toward the palm normal, opposite the wrist-watch face, for both hands and all controller orientations.

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

Keyboard curvature is a saved 0–100° preference. Curved backing and key geometry preserve ray picking and shared-root grip behavior. Key borders use textured `#7197a8`; Backing remains independent. Keyboard Dictate uses standard/prefixed Web Speech API detection, editable transcript review, explicit Insert without Enter and a captured connected target. Browser/service support and physical voice acceptance remain pending. The terminal frame applies its front-surface offset after cylindrical warp so its hollow rim retains exact screen-edge coordinates without opaque geometry behind text. The active outline uses the original screen width for curvature while retaining its separate outer padding.

### Cards / Containers
- **Corner Style:** 8px for the scene host and larger application containers, 4px for controls and labels.
- **Background:** Layer space black, field black, panel navy, and control navy by function.
- **Border:** Use slate borders for interactive controls and divider slate for structural separation.
- **Internal Padding:** Use 8px, 12px, or 16px based on density and viewport.

### Hover Help

Non-obvious controls explain their action on browser hover or controller-ray hover. Spatial hints use the existing dark label treatment, face the viewer and stay outside ray picking. XR tooltips keep a compact angular size by scaling with distance, appear after a 700 ms dwell, describe actions only and are hidden while gripping. There are no automatic grip instructions. Hover feedback never sends terminal input or changes its target.

### XR Terminal Panel
Each panel presents one live pane with a readable terminal surface, title/status, Disconnect/Reconnect and Close view. Grid, local text zoom and glass opacity live in Settings → Selected terminal. Typing controls live on Keyboard The whole panel is a grabbable transform root, as are the keyboard, commands, hierarchy and workspace HUD surfaces. Terminal grid settings are selected-pane scoped and apply only through explicit numeric Apply controls, with presets 80x24, 100x30, 120x36 and 160x48 plus ±1/±10 draft controls. Bounds are 2..300 columns and 2..150 rows, server echo is read-only, and disconnected resize is denied. Terminal colors are a saved global preference: Comfortable is the default, with Original and Monochrome alternatives. The content remains one canvas texture on flat or curved screen geometry. Saturated color depth is a qualitative optical inference, not a proven physical display effect, and any physical effect needs owner recheck. Selection is explicit by default and independent from head-directed rendering fidelity. Optional Gaze input uses a short head-directed dwell to retarget the keyboard, with a visible target caption. Its sole native toggle lives on Keyboard, next to Backing. Settings → Display separately owns color modes and Filtering, and Settings → World owns backgrounds and VR/passthrough The native keyboard uses self-hosted OFL Noto Sans and Symbols 2 through Troika SDF 0.52.5; unsupported visual glyphs render as `?` while the original title remains. Keyboard Backing is a saved browser/native-header toggle: off hides only the backing while key buttons remain visible and the logical plane stays grabbable and can occlude gaze, retaining the input target. The native FPS HUD is an actual frame counter updated about every 500 ms, not a capacity benchmark. Comfortable-distance guidance remains qualitative GPU-shot evidence and is not headset proof. The physical controller grab pose and two-hand behavior remain unchanged. The observatory background is peripheral architecture and a distant planet, never a competing focal surface.

## Do's and Don'ts

### Do:
- **Do** keep live terminal text and targeted input visually primary.
- **Do** use the existing blue-black palette and cyan only for interaction state.
- **Do** preserve 4px control corners and 8px container corners.
- **Do** support black, gradient, observatory, and passthrough modes as explicit choices.
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

The HUD uses Widgets in the former Keyboard slot. Clocks have dark physical bodies, crisp digital text or raised analog hands, a compact close action and the same grip gestures as other surfaces. Save keyboard/HUD transforms relative to the headset heading across sessions. Keep arranged terminal bounds above the Observatory or passthrough floor without constraining Black/Gradient layouts.

Expose four terminal sampling choices and bounded anisotropy in browser/native settings, with visible current values. Sharper head-gaze rendering is independent of input gaze and selection. Use stable soft circular stars with varied size and restrained color, retaining one draw call.

## XR panel ownership and direct Warp

The A radial has seven direct items: Keyboard, Commands, Panes, Layout, Warp, Widgets and Settings. Panels do not repeat global navigation, gaze targeting or world controls. Settings groups Display, World and Selected terminal. The HUD provides status, notices, updates, Exit and a Menu action for controller-free hand access. The Menu control uses the existing compact label-button style. Hands use the owner's rounded orange reference: a padded palm, three long fingers and a thumb, without nails or outlines. Ring and little-finger joints share the outer cartoon digit. Smooth matching arms stretch to camera-relative anchors 20 cm to either side, 18 cm below and 4 cm forward, with modest gravity sag and bounded curve lag. Wrist/finger tracking remains immediate. The visual meshes never intercept picking and hide/reset on tracking loss, source replacement or XR exit. Ray/contact and hover retain the controller interaction language. Index-to-thumb pinch selects, while middle-to-thumb pinch manipulates from the wrist pose. A VR/passthrough change ends the session and prepares a fresh named browser entry action, rather than requesting a second session after an asynchronous shutdown.

Warp captures the aimed pane when A opens the radial, falling back to the active pane. Right-stick X previews curvature, A commits once, and B restores the initial curvature instead of invoking Focus. Preview changes are not persisted until commit. Grips retain manipulation and pause editing. Gaze retargeting, terminal trigger input and scrolling are suppressed. Removing the target, controller disconnect, recovery, disposal or XR exit cancels safely.

Display also owns new-window glass opacity and Focus distance/warp. The new-view opacity default never overwrites a live pane or a saved pane override. Focus defaults to 1.5 m and flat curvature, applies settings live, and keeps its temporary curve separate from the saved per-pane warp. Exiting restores the original transform and curvature. Starting direct Warp first exits Focus. The screen and hollow rim use the same horizontal subdivision samples so their curved top/bottom edges meet continuously without opaque geometry behind text.

Radial glyphs have no rectangular backplate, retain full interaction targets and sit in front of sector glass. The terminal bezel uses a surface-aligned rim, keeping opaque interior/back faces out of transparent text columns.

The orange hands also present controller input: trigger pressure curls only index, grip curls the lower two digits, and face buttons move the thumb. A compact navy Menu watch sits on the right wrist, with a band and readable face above the skin. The left index can tap it directly, or the left controller can point and trigger. Touch requires a front approach and withdrawal before a second press; pointer and contact activation share a short debounce. Watch activation preserves the selected pane. Its face is the sole interactive avatar surface, with controller A and HUD Menu retained as alternatives.

Near standard-keyboard interaction detects each hand: enter within 14 cm of its surface to hide both lasers and poke keys with the index fingertip, then restore ray input only after both hands leave the keyboard proximity area. Front approach, withdrawal hysteresis and swept contact prevent held or fast pokes from repeating. Modifiers share the existing tap/hold behavior across keyboard rebuilds. Grip cancels contact typing. Palm, fingertip or wrist contact plus grip captures the actual movable root before distant ray targeting. Contact respects visibility and modal ownership, survives transformed/curved keys, and resets on retarget, tracking loss, close and disposal. The neutral thumb extends from the palm side in the finger plane; tracked fingertips retain their measured positions. Paul confirmed the wrist watch works on Quest 3 on November 4, 2026. New keyboard contact and touch-grab feel remain a separate device check.
