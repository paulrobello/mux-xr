# P3: Hand control

## Dependencies

P1 MVP. Reuse the action contracts rather than binding product behavior directly to controller buttons.

On November 3, 2026, Paul reported that his testing has been on Quest 3 and the current build works well, and explicitly selected hand tracking as the next implementation task.

## Tasks

- P3.1: Hand ray/pinch selection and direct-grab manipulation, with clear hover/grab feedback and tracking-loss recovery. Verify action-unit tests, emulation and real Quest hands. Dependencies: P1.1.
- P3.2: Hand-operated command menu, terminal keys and virtual keyboard, preserving bound command targets and supporting intentional repeat/modifiers. Verify action routing, loss/cancel cases and actual headset typing. Dependencies: P3.1, P1.2. P2 radial treatments may be reused when available.

Run `make checkall`, `make checkall-ci`, `make e2e` and the isolated `make hand-input-check` browser fixture per task. The hand fixture requires `MUX_XR_PRIVATE_TEST=1`, a loopback `MUX_XR_BASE_URL` and a `MUX_XR_TEST_ROOT` served by that private preview. Real hand tracking acceptance is required and cannot be replaced by screenshots or controller simulation.

## Interaction mapping

- Index-to-thumb pinch uses the runtime's select events for ray selection, commands and virtual keys.
- Middle-to-thumb pinch grabs the aimed surface using the tracked wrist pose. Two hands share the existing scale/rotation/translation behavior.
- The HUD Menu control provides radial access without controller buttons.
- Missing hand or required joint poses cancel in-flight actions. Reacquisition requires neutral pinches before accepting new input.
- Controller input remains the fallback. Physical Quest hand comfort, occlusion recovery and keyboard precision remain separate acceptance checks.
