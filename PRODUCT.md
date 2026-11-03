# Mux XR

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript, Vite and Three.js, following par-dots' direct WebXR runtime and webxr1's interaction patterns. This is the lead's implementation choice under the approved MVP build. Reuse par-term's binary streaming protocol and an established terminal emulator.

## Users

Paul uses Meta Quest 3 to monitor terminals running on his computer, with occasional commands. Controllers come first. Hand tracking is on the roadmap. A physical keyboard is not part of the workflow.

## Product Purpose

Display at least two readable, live par-mux panes in a movable spatial workspace. Make occasional input practical through global and workspace quick commands, terminal keys and a virtual keyboard.

## Operating Context

LAN-only. No published hosting or tunnels. The daemon hierarchy is workspace, session, window/tab, pane. Each MVP panel displays one pane. The headset browser stores commands and preferences.

## Capabilities and Constraints

- Move, resize and rotate every XR UI root as a unit, including pane, keyboard, commands, hierarchy and workspace HUD surfaces. One-controller grip moves and rotates, thumbstick X yaws and Y pitches without Y translation. Grip plus trigger rolls around the controller laser axis with X and pushes or pulls with Y. Two-controller grip resizes, rotates and moves from the hand spread, direction and midpoint. XR transforms persist while typing, retargeting and switching modes. Physical scale and local text zoom are separate from explicit terminal grid resizing. Desktop mouse 3D preview retains Smaller, Larger and Reset layout toolbar controls; XR resizing uses grip gestures, and Layout includes recovery.
- Explicit terminal grid resize is available only for the selected pane through browser Workspace Settings or radial Settings → Selected terminal. Apply is required, bounds are 2..300 columns and 2..150 rows, server echo is read-only, and disconnected resize is denied. Terminal colors are a saved global preference with Comfortable as the default, plus Original and Monochrome. Native keyboard labels use self-hosted OFL Noto Sans and Symbols 2 through Troika SDF 0.52.5; unsupported visual glyphs show `?` while preserving the original title.
- Browse the mux hierarchy and display panes from multiple branches at once.
- Close view removes only the virtual panel. Disconnect keeps its image and placement while pausing stream retries and input. Reconnect resumes the same pane. These controls are available in desktop and XR and never terminate the underlying shell.
- Global and workspace-specific command lists, with label, text and optional Enter, following pardeck.
- Selection highlighting belongs only to the active input pane. Manual input targeting is the default. The optional Gaze input toggle on Keyboard lets a short head-gaze dwell select the keyboard target and retains the last target while looking at the keyboard.
- Passthrough, pure black, gradient and a quiet sci-fi observatory. No ambient sound.
- Benchmark actual panel capacity on Quest 3. Two readable panes is the acceptance target, not an invented maximum.
- The seven-item tinted radial menu provides Keyboard, Commands, Panes, Layout, Warp, Widgets and Settings. Direct Warp uses right-stick X, A to save and B to cancel. Named saved 3D layouts, window choreography, whole-window splits and hand tracking remain roadmap work.

## Brand Commitments

Expressive motion in controls and panels, with a restrained sci-fi world that keeps text and controls visually primary. The approved environment is a dark orbital observatory with peripheral architecture and a distant planet. Blender may be used where useful.

## Evidence on Hand

Reference repos: par-term-emu-core-rust, pardeck, par-dots and webxr1. Fixtures must be visibly labeled as demonstrations. Desktop and emulator evidence never substitutes for actual Quest acceptance.

## Product Principles

1. Monitoring stays readable and input stays intentionally targeted.
2. Existing par-mux owns terminal processes and terminal state.
3. Local presentation changes do not disturb desktop selection or terminal sizing.
4. Animation supports spatial understanding while the user's viewpoint stays under their control.

Frontend builds poll a same-origin version manifest and offer an explicit Reload action in browser and XR. The desktop main page reloads automatically after detecting an update. XR keeps the explicit Reload action. Reload ends XR before refreshing the viewer, preserving terminal processes and saved local preferences.

Attached terminal panels can be arranged as Row, Grid, Arc or a front-hemisphere Sphere from browser settings or the native XR Arrange menu. Presets position and orient panels around the current viewer, preserving their individual sizes, input target and terminal grid. Each panel remains directly manipulable afterward. Named saved 3D layouts are still roadmap scope.
