# Radial menu prototype notes

These notes record the initial visual comparison. The tinted ring was selected
and implemented. The current runtime has seven direct items: Keyboard, Commands,
Panes, Layout, Warp, Widgets and Settings. See [current controls](../README.md#spatial-controls).

## Actions

The initial comparison used five clear targets: Keyboard, Commands, Layout, Warp, and
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
not activate the menu. B keeps Focus outside direct Warp editing, where it cancels the preview. A commits a Warp preview instead of reopening the radial. While the menu is
open, suppress scrolling so a ray selection cannot accidentally move a terminal
surface. Selecting an action should open the actual existing surface or action,
not a mock destination.

The opening sequence lasts 640 ms after the owner's 20% speed-up: center
expansion for 128 ms, stack emergence for 128 ms and fan-out for 384 ms.
The caller places the menu about 1.05 m ahead at 0.8 scale. Radial
labels now have no rectangular backplates and retain a front glyph offset. Controller
ray hover is the primary feedback. Headset acceptance still needs a real Quest
check for comfort, target size, occlusion, and label readability.
