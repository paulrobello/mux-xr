# ENH-007 — Property-based tests for the trust boundaries

> Source: audit of 2026-11-15 (`406a373`). Follows audit issues SEC-001 and ARC-003. Priority medium, estimate M.

## Goal

Test the code that parses untrusted input with generated inputs, so the next bug of the SEC-001 kind is found by a test instead of by an audit. The targets are the terminal frame decoder, the paste sanitizer, the paired-route handshake and the stored-settings validator.

## Current state

- 1,746 example-based Vitest tests pass in 12.2 s. No property-based or fuzz test exists, and `fast-check` is not a dependency.
- `decodeServerMessage` (`src/terminal/protocol.ts:42-68`) accepts bytes from the streamer: a one-byte compression flag, an optional zlib stream bounded during inflation at `MAX_DECOMPRESSED_SIZE`, then a protobuf `ServerMessage`. Tests live in `tests/terminal-protocol.test.ts`.
- `sanitizePasteText` (added by SEC-001 in `src/terminal/protocol.ts`) removes C0 and C1 controls except tab, LF and CR.
- After ARC-003, `createPairedRoute` (`src/server/paired-route.ts`) is the single handshake for every paired host route: nonce, first-frame parse, HMAC comparison, failure limiter, timers.
- `validateSettings` (`src/ui/index.ts:387-430`, moved to `src/settings/store.ts` by ARC-002) turns stored JSON into a settings object field by field. `validPose` guards saved poses.
- SEC-001 existed because no test asked what happens for an arbitrary clipboard string.

## Preconditions

SEC-001 (card `01a1dfd6e30f7742ba3be611d214337f`) and ARC-003 (card `01a1dfd6ec44722e9ba540ba78c37d0c`) are done. The settings and pose properties need no precondition and can use whichever path the functions live at.

## Implementation

1. **Dependency.** `bun add -d --exact fast-check` and record the resolved version in the commit message. Check `bun audit --audit-level high` stays clean.
2. **Layout and bounds.** Put the tests in `tests/property/`. Every property uses `{ numRuns: 200 }` and a fixed `seed` read from `process.env.FC_SEED` when set, otherwise a constant, so a gate failure is reproducible. On failure fast-check prints the seed and the shrunk counterexample; keep that output.
3. **`tests/property/protocol.property.test.ts`**
   - _Totality_: for any `Uint8Array` up to 4,096 bytes, `decodeServerMessage` either returns a message or throws an `Error`. It never throws a non-Error and never hangs (run under a 2-second per-test timeout).
   - _Round trip_: for generated `ServerMessage` values built with `create(ServerMessageSchema, …)` over a small set of cases, `decodeServerMessage(frame(toBinary(...), flag))` equals the input for flag 0 and for flag 1 with `pako.deflate`.
   - _Bound_: a compressed frame whose inflated size exceeds `MAX_DECOMPRESSED_SIZE` always throws. Use one generated repeat count per run, not megabytes of random data.
4. **`tests/property/paste.property.test.ts`**
   - For any string (use `fc.fullUnicodeString()` plus an arbitrary that splices ESC, CSI and the bracketed-paste markers at random positions), the output of `sanitizePasteText` contains no code point in `U+0000–U+0008`, `U+000B`, `U+000C`, `U+000E–U+001F`, `U+007F` or `U+0080–U+009F`.
   - Idempotent: `sanitize(sanitize(s)) === sanitize(s)`.
   - Identity on strings generated without those code points.
   - The output never contains the substring `\u001b[201~`, including for nested inputs.
5. **`tests/property/paired-route.property.test.ts`** (Node environment)
   - For any first frame (arbitrary strings, arbitrary JSON values, and well-formed auth messages with a MAC that differs from the correct one in at least one byte), `onAuthenticated` is never called and the socket closes with a known error code.
   - For a well-formed auth message with the correct MAC, `onAuthenticated` is called exactly once.
   - Use the route's in-process test harness from `tests/paired-route.test.ts` with a fixed secret and an injected clock; do not open real network ports beyond loopback ephemeral ones, and close every server in `afterEach`.
6. **`tests/property/settings.property.test.ts`**
   - For any JSON value (`fc.jsonValue()`), `validateSettings` returns an object whose every field passes the same per-field checks as `DEFAULT_SETTINGS`' types and ranges, and never throws.
   - For any value, `validPose` returns a boolean and never throws; when it returns `true`, every number in the pose is finite.
7. **Mutation demonstration.** Once, by hand, confirm the properties bite: comment out the MAC comparison in `paired-route.ts` and see the paired-route property fail; remove `\u001b` from `PASTE_UNSAFE` and see the paste property fail. Restore both and record the two failures in the commit message. Do not commit the mutations.
8. **Docs.** Add a "Property tests" paragraph to `docs/TESTING.md`: where they live, how to reproduce a failure with `FC_SEED`, and the rule that a counterexample found by a property becomes a named example test before the fix.

## Files to touch

`package.json`, `bun.lock`, new `tests/property/*.property.test.ts` (four files), `vitest.config.ts` (include pattern and the Node project for the paired-route file, if ARC-008 has landed), `docs/TESTING.md`.

## Verification

1. `bun run test tests/property` passes, and the four files together add under 5 seconds to the suite (compare `bun run test` wall time before and after; the baseline is 12.2 s).
2. `FC_SEED=1 bun run test tests/property` and `FC_SEED=2 bun run test tests/property` both pass.
3. The two mutations in step 7 each make their property fail with a shrunk counterexample, and the tree is clean afterwards (`git status --short` empty apart from intended changes).
4. `make checkall-ci` is green, including `bun audit`.

## Acceptance criteria (for the card)

- Property tests cover the frame decoder, the paste sanitizer, the paired-route handshake and the settings and pose validators, each with 200 runs and a reproducible seed.
- Removing the MAC comparison and removing ESC from the paste filter were each shown to fail a property, recorded in the commit message.
- The suite's wall time grows by under 5 seconds and `make checkall-ci` is green.

## Rollback

Delete `tests/property/` and remove the dev dependency. No production code changes.

## Out of scope

Coverage-guided fuzzing, fuzzing the Rust streamer, and property tests for scene or layout math.
