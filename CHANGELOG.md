# Changelog

## Unreleased

- Focus now uses a native WebXR composition layer by default in supported immersive VR. Flat terminals use a quad and warped terminals use a cylinder. The pane frame and scroll controls remain part of the spatial workspace.
- Focus warp can use its own 0–180° angle or inherit the terminal's saved warp. Existing Focus angles are preserved as **Custom**. Terminal warp controls and saved angles support up to 180°.
- Fixed focused text flicker and reduced texture uploads by keeping the latest terminal image on the GPU and copying it into each compositor frame.

See the [XR workspace guide](docs/WORKSPACE.md#focus-warp-and-terminal-settings) for controls and fallback behavior.
