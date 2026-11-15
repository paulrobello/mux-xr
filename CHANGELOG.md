# Changelog

## Unreleased

- `@par/xr-workspace` 0.2.0 adds APIs asked for by its first outside consumer: elastic-arm visibility, glow and a near-eye fade; a public label text update; `keepAbove` for single-pass scenes; stable control ids; a menu panel; optional pointer, button and session helpers; and the fonts and hand models inside the package with a staging command. The arm's near-eye fade is on by default, in Mux XR as well.
- Focus now uses a native WebXR composition layer by default in supported immersive VR. Flat terminals use a quad and warped terminals use a cylinder. The pane frame and scroll controls remain part of the spatial workspace.
- Focus warp can use its own 0–180° angle or inherit the terminal's saved warp. Existing Focus angles are preserved as **Custom**. Terminal warp controls and saved angles support up to 180°.
- Fixed focused text flicker and reduced texture uploads by keeping the latest terminal image on the GPU and copying it into each compositor frame.

See the [XR workspace guide](docs/WORKSPACE.md#focus-warp-and-terminal-settings) for controls and fallback behavior.
