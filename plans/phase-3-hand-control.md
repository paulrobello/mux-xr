# P3: Hand control

## Dependencies

P1 MVP. Reuse the action contracts rather than binding product behavior directly to controller buttons.

## Tasks

- P3.1: Hand ray/pinch selection and direct-grab manipulation, with clear hover/grab feedback and tracking-loss recovery. Verify action-unit tests, emulation and real Quest hands. Dependencies: P1.1.
- P3.2: Hand-operated command menu, terminal keys and virtual keyboard, preserving bound command targets and supporting intentional repeat/modifiers. Verify action routing, loss/cancel cases and actual headset typing. Dependencies: P3.1, P1.2. P2 radial treatments may be reused when available.

Run `make checkall`, `make checkall-ci` and relevant local browser checks per task. Real hand tracking acceptance is required and cannot be replaced by screenshots or controller simulation.
