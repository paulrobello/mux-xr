# Radial menu prototype notes

This prototype explores a controller-first action menu for the current Mux XR
surface. It is a mockup only. The runtime remains on the existing A-button
behavior until the interaction and visual design are reviewed.

## Actions

The menu contains five clear targets: Keyboard, Commands, Layout, Warp, and
Widgets. The center target is Cancel. Targets use the existing dark blue-black
palette and cyan/selection-blue interaction state. Labels are large native SDF
labels, not tiny icons.

Two visual variants are useful for comparison:

- `ring` uses chunky filled annular sectors. The sectors are solid, readable
  controls, not thin shimmering outlines.
- `satellites` uses the existing rectangular button language placed around a
  circle. This is the safer readability baseline for the first review.

The glass option is intentionally conservative: a dark translucent tint with
depth writing disabled. It does not imply transmission, blur, post-processing,
or audio. A glass chrome layer with an opaque content plate is the recommended
shipping direction until headset readability proves otherwise.

## Interaction recommendation

Tap A to toggle the menu. Aim and press trigger to choose an action. Grip does
not activate the menu. B keeps its existing focus behavior. While the menu is
open, suppress scrolling so a ray selection cannot accidentally move a terminal
surface. Selecting an action should open the actual existing surface or action,
not a mock destination.

The menu should animate over roughly 120–180 ms, remain bounded, and keep the
caller responsible for placing it at 0.6–0.8 m scale and distance. Controller
ray hover is the primary feedback. Headset acceptance still needs a real Quest
check for comfort, target size, occlusion, and label readability.
