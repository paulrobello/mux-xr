/**
 * The single description of every browser and live check.
 *
 * Each entry states, once, the facts that the Makefile target, the environment guard and the
 * `docs/TESTING.md` row otherwise restate by hand. `scripts/run-check.ts` validates the entry's
 * environment before importing the script, the Makefile check rules invoke the script only
 * through the runner, and `scripts/gen-testing-table.ts` renders the doc table from this list.
 * `tests/check-manifest.test.ts` fails when reality (scripts on disk, Makefile rules, doc rows)
 * diverges from what is declared here.
 */

/** Where a check's page or connection comes from. */
export type CheckFixture = 'browser-fixture' | 'private-streamer' | 'daemon' | 'gpu';

export type CheckSpec = {
  /** Makefile target name, e.g. `focus-mode-check`. */
  name: string;
  /** Repo-relative script path. */
  script: string;
  /** One sentence, also the Checks column of the docs/TESTING.md row. */
  purpose: string;
  /** Environment variables that must be set, besides `MUX_XR_PRIVATE_TEST`. */
  requires: readonly string[];
  /** Environment variables the check reads when present. */
  optional: readonly string[];
  fixture: CheckFixture;
  /** True when the check sends input, resizes or creates panes, or serves a build copy. */
  sendsInput: boolean;
  /** The evidence caveat: what a pass does not establish. */
  doesNotProve: string;
  /** Extra fixture facts the classification alone does not carry. */
  fixtureNote?: string;
};

export const CHECKS: readonly CheckSpec[] = [
  {
    name: 'hierarchy-check',
    script: 'scripts/hierarchy-check.ts',
    purpose:
      'Both hierarchy styles, browser and native synchronization, navigation, screenshots and reload persistence',
    requires: ['MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Headset behavior',
  },
  {
    name: 'input-refinement-check',
    script: 'scripts/input-refinement-check.ts',
    purpose: 'Hierarchy, keyboard curvature, warped rims and injected fake speech recognition',
    requires: ['MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Microphone, transcription service or physical Quest voice support',
  },
  {
    name: 'auto-entry-check',
    script: 'scripts/auto-entry-check.ts',
    purpose: 'Automatic XR entry with and without user activation',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'A real XR session',
  },
  {
    name: 'production-label-check',
    script: 'scripts/production-label-check.ts',
    purpose: 'Actual UI glyph pixels in a built app served with the streamer CSP',
    requires: ['MUX_XR_BASE_URL'],
    optional: [],
    fixture: 'private-streamer',
    sendsInput: false,
    doesNotProve: 'A Vite development server cannot stand in for it',
    fixtureNote: 'Built app behind the streamer',
  },
  {
    name: 'update-notice-check',
    script: 'scripts/update-notice-check.ts',
    purpose: 'Update notice, polling and the automatic desktop reload between two builds',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_UPDATE_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'The immersive reload on a headset',
    fixtureNote: 'Two owned fixture builds',
  },
  {
    name: 'arrangement-check',
    script: 'scripts/arrangement-check.ts',
    purpose: 'Row, Grid, Arc and Sphere arrangements',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Comfort of a layout',
  },
  {
    name: 'focus-mode-check',
    script: 'scripts/focus-mode-check.ts',
    purpose: 'Focus entry, pane placement and exact restore after exit',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve:
      'The compositor layer path: the browser cannot create WebXR composition layers, so this proves the scene mechanics only',
  },
  {
    name: 'window-preferences-check',
    script: 'scripts/window-preferences-check.ts',
    purpose: 'Window defaults, Focus preferences and native setting actions',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Headset behavior',
  },
  {
    name: 'clipboard-selection-check',
    script: 'scripts/clipboard-selection-check.ts',
    purpose: 'Text selection ranges, copy, paste and highlight clearing',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Quest Browser clipboard permissions',
  },
  {
    name: 'placement-motion-check',
    script: 'scripts/placement-motion-check.ts',
    purpose: 'Floor clearance, grid retention and clock grip motion',
    requires: ['MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Headset comfort',
  },
  {
    name: 'input-comfort-check',
    script: 'scripts/input-comfort-check.ts',
    purpose: 'Radial and keyboard opening, press-twice Exit and environment motion',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Physical comfort',
  },
  {
    name: 'hand-input-check',
    script: 'scripts/hand-input-check.ts',
    purpose: 'Hand ray selection, pinch and manipulation from injected hand sources',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve:
      'Physical hand tracking: gesture comfort, occlusion recovery and typing precision need a Quest 3',
  },
  {
    name: 'hand-visual-check',
    script: 'scripts/hand-visual-check.ts',
    purpose: 'Standard hand meshes, bone placement and captured pinch metrics',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: ['MUX_XR_MODE'],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Physical hand tracking',
  },
  {
    name: 'hand-contact-check',
    script: 'scripts/hand-contact-check.ts',
    purpose: 'Fingertip contact with keyboard keys and panel buttons',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Physical typing precision',
  },
  {
    name: 'widgets-clarity-check',
    script: 'scripts/widgets-clarity-check.ts',
    purpose: 'Native widget, filter and pose behavior, and widget pixels',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Legibility on a headset',
  },
  {
    name: 'perf-gauge-check',
    script: 'scripts/perf-gauge-check.ts',
    purpose: 'Update cost of the performance gauge, with screenshots',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: ['MUX_XR_ITERATIONS', 'MUX_XR_SHOTS'],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Quest frame cost',
  },
  {
    name: 'host-load-check',
    script: 'scripts/host-load-check.ts',
    purpose: 'Host load meter states rendered from a fake stats source, with screenshots',
    requires: [],
    optional: ['MUX_XR_SHOTS'],
    fixture: 'browser-fixture',
    sendsInput: false,
    doesNotProve: 'The live host stats route',
  },
  {
    name: 'keyborb-check',
    script: 'scripts/keyborb-check.ts',
    purpose: 'Keyborb layout, pinch typing and orb feedback',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Physical pinch feel',
  },
  {
    name: 'keyborb-perf-check',
    script: 'scripts/keyborb-perf-check.ts',
    purpose: 'Keyborb cost against the closed and standard keyboards. Refuses a host load above 15',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [
      'KEYBORB_PERF_THROTTLE',
      'KEYBORB_PERF_EYES',
      'KEYBORB_PERF_STATES',
      'KEYBORB_PERF_LEFT',
      'KEYBORB_PERF_ABLATE',
    ],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Quest frame cost',
    fixtureNote: 'Booked host',
  },
  {
    name: 'explorer-controls-check',
    script: 'scripts/explorer-controls-check.ts',
    purpose:
      'Hierarchy explorer controls and branches. Functional only, no performance measurement',
    requires: ['MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Headset behavior',
  },
  {
    name: 'radial-live-check',
    script: 'scripts/radial-live-check.ts',
    purpose: 'Live radial menu opening, interaction and glass rendering',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Headset behavior',
  },
  {
    name: 'warp-radial-check',
    script: 'scripts/warp-radial-check.ts',
    purpose: 'Radial Warp curvature and opacity editing',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Headset behavior',
  },
  {
    name: 'quest-controls-check',
    script: 'scripts/quest-controls-check.ts',
    purpose: 'Controller controls and terminal pixels in the real app',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'private-streamer',
    sendsInput: true,
    doesNotProve: 'Physical controllers',
    fixtureNote: 'Serves a copy of dist',
  },
  {
    name: 'local-dictation-check',
    script: 'scripts/local-dictation-check.ts',
    purpose: 'Local dictation review and insertion with a fake audio capture file',
    requires: ['MUX_XR_TEST_ROOT', 'MUX_XR_SPEECH_SAMPLE', 'MUX_XR_SPEECH_URL'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Microphone permission on a headset',
    fixtureNote: 'Speech service',
  },
  {
    name: 'pane-bell-check',
    script: 'scripts/pane-bell-check.ts',
    purpose:
      'Bell indicator with the real parser: OSC sequences ignored, explicit Bell event, pane isolation',
    requires: ['MUX_XR_TEST_ROOT'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'A bell from a real daemon',
  },
  {
    name: 'terminal-shimmer-check',
    script: 'scripts/terminal-shimmer-check.ts',
    purpose: 'WebGL terminal sampler modes and texture reuse under gaze',
    requires: [],
    optional: ['MUX_XR_BASE_URL'],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Quest sampling',
  },
  {
    name: 'terminal-opacity-check',
    script: 'scripts/terminal-opacity-check.ts',
    purpose: 'Terminal glass opacity in WebGL',
    requires: [],
    optional: ['MUX_XR_BASE_URL'],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Quest rendering',
  },
  {
    name: 'terminal-texture-check',
    script: 'scripts/terminal-texture-check.ts',
    purpose:
      'WebGL pixels against the canvas reference: partial updates, orientation, resizing and UV transforms',
    requires: [],
    optional: ['MUX_XR_BASE_URL'],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Any mux daemon connection',
  },
  {
    name: 'stream-lifecycle-check',
    script: 'scripts/stream-lifecycle-check.ts',
    purpose:
      'Four intercepted streams: a 3 MiB seed, manual disconnect, rejected input, reconnect without replay, close and reopen',
    requires: ['MUX_XR_BASE_URL'],
    optional: ['MUX_XR_SKIP_LIFECYCLE', 'MUX_XR_BASELINE', 'MUX_XR_SCREENSHOT_DIR'],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve:
      'Quest capacity or a headset FPS gate. `MUX_XR_SKIP_LIFECYCLE=1` measures a fixed four-pane, 149×54 workload with 6,400 packets, and `MUX_XR_BASELINE=1` runs the same diagnostic against an older build. Timings describe desktop canvas cost and frame pacing',
    fixtureNote: 'Isolated static preview, every WebSocket intercepted',
  },
  {
    name: 'terminal-capacity-check',
    script: 'scripts/terminal-capacity-check.ts',
    purpose: 'Desktop canvas cost and frame pacing for 6, 12 and 18 panes',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT'],
    optional: [
      'MUX_XR_COUNTS',
      'MUX_XR_BACKGROUND',
      'MUX_XR_WORKLOAD',
      'MUX_XR_PERF_GAUGE',
      'MUX_XR_DAMAGE',
      'MUX_XR_GAZE_SWEEP',
      'MUX_XR_TRACE',
      'MUX_XR_BASELINE',
    ],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve: 'Quest capacity',
  },
  {
    name: 'damage-audit-check',
    script: 'scripts/damage-audit-check.ts',
    purpose:
      'Painter audit mode: rows that changed outside the damage hint, with zero misses expected',
    requires: ['MUX_XR_BASE_URL', 'MUX_XR_TEST_ROOT', 'MUX_XR_MUX_SOCKET'],
    optional: ['MUX_XR_PAR_MUX'],
    fixture: 'private-streamer',
    sendsInput: true,
    doesNotProve: 'Behavior on the default daemon, which it refuses',
  },
  {
    name: 'live-check',
    script: 'scripts/live-terminal-check.ts',
    purpose: 'A terminal-adapter diagnostic against a real streamer',
    requires: ['MUX_XR_STREAMER', 'MUX_XR_PANES'],
    optional: ['MUX_XR_BASE_URL'],
    fixture: 'daemon',
    sendsInput: true,
    doesNotProve: 'Full hierarchy or headset acceptance',
  },
  {
    name: 'real-app-check',
    script: 'scripts/real-app-check.ts',
    purpose:
      'The built app against a private compatible core pair, issuing two harmless marker commands',
    requires: [],
    optional: ['MUX_XR_BASE_URL', 'MUX_XR_BUILD', 'MUX_XR_CORE_SHA', 'MUX_XR_BINARY_SHA'],
    fixture: 'private-streamer',
    sendsInput: true,
    doesNotProve: 'Headset behavior',
  },
  {
    name: 'pane-create-check',
    script: 'scripts/pane-create-check.ts',
    purpose:
      'The pane-create protocol against a private streamer. The `created` case adds a real default-shell window',
    requires: ['MUX_XR_STREAMER', 'MUX_XR_EXPECT'],
    optional: [],
    fixture: 'daemon',
    sendsInput: true,
    doesNotProve:
      'The built app. See the [core 0.81 review](core-0.81-review.md#pane-create-adoption-check)',
  },
  {
    name: 'pane-create-app-check',
    script: 'scripts/pane-create-app-check.ts',
    purpose: "The built app's **New terminal** control for each outcome",
    requires: ['MUX_XR_EXPECT'],
    optional: ['MUX_XR_BASE_URL', 'MUX_XR_STREAMER_ARGV', 'MUX_XR_EVIDENCE'],
    fixture: 'private-streamer',
    sendsInput: true,
    doesNotProve: 'The protocol alone',
  },
  {
    name: 'agent-roster-app-check',
    script: 'scripts/agent-roster-app-check.ts',
    purpose:
      'Live roster rows from hook agent states, attaching a pane from its row with no resize, and removal of a killed pane. `MUX_XR_REASON_ONLY=1` checks the reason shown after a fresh streamer start instead',
    requires: ['MUX_XR_MUX_SOCKET'],
    optional: ['MUX_XR_BASE_URL', 'MUX_XR_REASON_ONLY', 'MUX_XR_EVIDENCE'],
    fixture: 'private-streamer',
    sendsInput: true,
    doesNotProve: 'The shared default daemon',
    fixtureNote:
      'Its panes need running `claude` or `codex` processes so the daemon keeps the claims',
  },
  {
    name: 'pane-lifecycle-check',
    script: 'scripts/pane-lifecycle-check.ts',
    purpose: 'Held-pane exit and respawn through a real streamer',
    requires: [],
    optional: ['MUX_XR_STREAMER_BIN', 'MUX_XR_PAR_MUX_BIN'],
    fixture: 'daemon',
    sendsInput: false,
    doesNotProve: 'The built app',
    fixtureNote: 'Never the shared default daemon',
  },
  {
    name: 'xr-visual-check',
    script: 'scripts/xr-visual-check.ts',
    purpose:
      'Native GPU rendering of the spatial keyboard with an explicit test XR camera and controller',
    requires: [],
    optional: ['MUX_XR_BASE_URL'],
    fixture: 'browser-fixture',
    sendsInput: false,
    doesNotProve: 'Headset testing',
  },
  {
    name: 'context-loss-check',
    script: 'scripts/context-loss-check.ts',
    purpose:
      'WebGL context loss and restore on the demo workspace through loseContext() and restoreContext()',
    requires: ['MUX_XR_BASE_URL'],
    optional: [],
    fixture: 'browser-fixture',
    sendsInput: true,
    doesNotProve:
      'An XRSession reaction to context loss, which differs per browser and needs a headset',
  },
];
