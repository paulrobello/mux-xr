import { validateHandColor, validateWeatherZip } from '@par/xr-workspace';
import type { BackgroundMode, PanelArrangement, TerminalColorMode } from '../contracts';
import { isBackgroundMode } from '../contracts';
import { reportSwallowed } from '../diagnostics';
import { type FoveationLevel, validateFoveationLevel } from '../foveation';
import { type PasteReviewMode, validatePasteReviewMode } from '../paste-review';
import {
  DEFAULT_TERMINAL_FILTERING,
  type TerminalFiltering,
  validateTerminalFiltering,
} from '../terminal/filtering';
import {
  AGENT_BOARD_ROWS_DEFAULT,
  AGENT_ROWS_CHOICES,
  AGENTS_SORTS,
  type AgentRosterLayout,
  type AgentRowsChoice,
  type AgentsSort,
  DEFAULT_AGENT_ROSTER_LAYOUT,
  resolveAgentRows,
  validateAgentBoardRows,
} from '../workspace/agent-roster';
import {
  DEFAULT_HIERARCHY_STYLE,
  type HierarchyStyle,
  validateHierarchyStyle,
} from '../workspace/hierarchy-style';
import { validateKeyboardCurvature } from '../workspace/keyboard-curvature';
import { type KeyborbMode, validateKeyborbMode } from '../workspace/keyborb';
import {
  DEFAULT_WINDOW_PREFERENCES,
  validateWindowPreferences,
  type WindowPreferences,
} from '../workspace/window-preferences';

export interface WorkspaceSettings {
  version: 1;
  endpoint: string;
  /** Streamer `--api-key` value, or empty when the streamer needs none. Never logged or echoed. */
  streamerApiKey: string;
  background: BackgroundMode;
  gazeInput: boolean;
  /** Render the selected terminal through a compositor quad layer for sharper text. */
  crispFocusedTerminal: boolean;
  /** Compositor fixed foveation for immersive sessions: `off`, `low`, `medium` or `high`. */
  foveation: FoveationLevel;
  colorMode: TerminalColorMode;
  keyboardBackground: boolean;
  keyboardCurvature: number;
  arrangement: PanelArrangement;
  filtering: TerminalFiltering;
  windowPreferences: WindowPreferences;
  hierarchyStyle: HierarchyStyle;
  keyborbMode: KeyborbMode;
  uiSounds: boolean;
  /** When a paste needs a second press: `always`, `multiline` or `off`. */
  pasteReview: PasteReviewMode;
  /** `#rrggbb` tint for the XR hands and arms, or empty for the default color. */
  handColor: string;
  /** `#rrggbb` arm tint, or empty to match the hands. */
  armColor: string;
  /** `#rrggbb` XR interface accent, or empty for the default cyan. */
  accentColor: string;
  /** `#rrggbb` XR environment accent, or empty to match the interface accent. */
  environmentAccentColor: string;
  /** Five-digit US ZIP for the weather widget, or empty when none is set. */
  weatherZip: string;
  /** par-mux `agent-rows` preset, or `custom` for {@link agentRowsCustom}. */
  agentRows: AgentRowsChoice;
  agentRowsCustom: string;
  agentsSort: AgentsSort;
  /** Rows per page on the XR agent board, 3-12. */
  agentBoardMaxRows: number;
}

export const SETTINGS_KEY = 'mux-xr:settings:v1';

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  version: 1,
  endpoint: '',
  streamerApiKey: '',
  background: 'observatory',
  gazeInput: false,
  crispFocusedTerminal: true,
  foveation: 'low',
  colorMode: 'comfort',
  keyboardBackground: true,
  keyboardCurvature: 0,
  arrangement: 'arc',
  filtering: { ...DEFAULT_TERMINAL_FILTERING },
  windowPreferences: { ...DEFAULT_WINDOW_PREFERENCES },
  hierarchyStyle: DEFAULT_HIERARCHY_STYLE,
  keyborbMode: 'auto',
  uiSounds: true,
  pasteReview: 'multiline',
  handColor: '',
  weatherZip: '',
  armColor: '',
  accentColor: '',
  environmentAccentColor: '',
  agentRows: 'full',
  agentRowsCustom: '',
  agentsSort: DEFAULT_AGENT_ROSTER_LAYOUT.sort,
  agentBoardMaxRows: AGENT_BOARD_ROWS_DEFAULT,
};

/** The roster layout a settings value selects. */
export function agentRosterLayout(
  settings: Pick<WorkspaceSettings, 'agentRows' | 'agentRowsCustom' | 'agentsSort'>,
): AgentRosterLayout {
  return {
    rows: resolveAgentRows(settings.agentRows, settings.agentRowsCustom),
    sort: settings.agentsSort,
  };
}

export function validateSettings(value: unknown): WorkspaceSettings {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<WorkspaceSettings>;
  return {
    version: 1,
    endpoint: typeof candidate.endpoint === 'string' ? candidate.endpoint : '',
    streamerApiKey:
      typeof candidate.streamerApiKey === 'string' ? candidate.streamerApiKey.trim() : '',
    background: isBackgroundMode(candidate.background)
      ? candidate.background
      : DEFAULT_SETTINGS.background,
    gazeInput: candidate.gazeInput === true,
    crispFocusedTerminal: candidate.crispFocusedTerminal !== false,
    foveation: validateFoveationLevel(candidate.foveation),
    colorMode:
      candidate.colorMode === 'original' || candidate.colorMode === 'monochrome'
        ? candidate.colorMode
        : 'comfort',
    keyboardBackground: candidate.keyboardBackground !== false,
    keyboardCurvature: validateKeyboardCurvature(candidate.keyboardCurvature),
    filtering: validateTerminalFiltering(candidate.filtering),
    windowPreferences: validateWindowPreferences(candidate.windowPreferences),
    hierarchyStyle: validateHierarchyStyle(candidate.hierarchyStyle),
    keyborbMode: validateKeyborbMode(candidate.keyborbMode),
    uiSounds: candidate.uiSounds !== false,
    pasteReview: validatePasteReviewMode(candidate.pasteReview),
    handColor: validateHandColor(candidate.handColor),
    armColor: validateHandColor(candidate.armColor),
    accentColor: validateHandColor(candidate.accentColor),
    environmentAccentColor: validateHandColor(candidate.environmentAccentColor),
    weatherZip: validateWeatherZip(candidate.weatherZip),
    agentRows: AGENT_ROWS_CHOICES.includes(candidate.agentRows as AgentRowsChoice)
      ? (candidate.agentRows as AgentRowsChoice)
      : DEFAULT_SETTINGS.agentRows,
    agentRowsCustom:
      typeof candidate.agentRowsCustom === 'string' ? candidate.agentRowsCustom.slice(0, 500) : '',
    agentsSort: AGENTS_SORTS.includes(candidate.agentsSort as AgentsSort)
      ? (candidate.agentsSort as AgentsSort)
      : DEFAULT_SETTINGS.agentsSort,
    agentBoardMaxRows: validateAgentBoardRows(candidate.agentBoardMaxRows),
    arrangement:
      candidate.arrangement === 'row' ||
      candidate.arrangement === 'grid' ||
      candidate.arrangement === 'sphere' ||
      candidate.arrangement === 'arc'
        ? candidate.arrangement
        : DEFAULT_SETTINGS.arrangement,
  };
}

function cloneDefaults(): WorkspaceSettings {
  return validateSettings({});
}

/** Structural equality that ignores key order, because the validators do not fix one. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => sameValue(left[key], right[key]))
  );
}

/** Whether two settings values hold the same field values. */
export function sameSettings(a: WorkspaceSettings, b: WorkspaceSettings): boolean {
  return sameValue(a, b);
}

/** Whether one field of two settings values differs; the presenter re-renders only those controls. */
export function settingChanged(
  next: WorkspaceSettings,
  previous: WorkspaceSettings,
  key: keyof WorkspaceSettings,
): boolean {
  return !sameValue(next[key], previous[key]);
}

/** The browser's `localStorage`, or undefined where none exists (workers, tests without a DOM). */
export function browserStorage(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export function loadSettings(storage: Storage | undefined = browserStorage()): WorkspaceSettings {
  if (!storage) return cloneDefaults();
  try {
    return validateSettings(JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null'));
  } catch {
    return cloneDefaults();
  }
}

export interface SettingsUpdateOptions {
  /**
   * Write the settings to storage after this change. Defaults to true. A change made with
   * `persist: false` stays in memory and is written by the next persisting update.
   */
  persist?: boolean;
}

export type SettingsListener = (next: WorkspaceSettings, previous: WorkspaceSettings) => void;

/** The single owner of the settings both presenters read and change. */
export interface SettingsStore {
  get(): WorkspaceSettings;
  /**
   * Validates `patch` over the current settings. A patch that changes nothing notifies nobody,
   * which is what ends feedback between subscribers; it still writes earlier `persist: false`
   * changes when asked to persist. A change persists unless `persist === false`, then notifies
   * every subscriber in subscription order. Returns false when the storage write failed; the
   * in-memory change and the notification still happen.
   */
  update(patch: Partial<WorkspaceSettings>, options?: SettingsUpdateOptions): boolean;
  subscribe(listener: SettingsListener): () => void;
}

/** A store over `storage`; without one the settings live in memory only. */
export function createSettingsStore(storage?: Storage): SettingsStore {
  let current = storage ? loadSettings(storage) : cloneDefaults();
  const listeners = new Set<SettingsListener>();
  // An update made from inside a subscriber is queued, so every listener sees each change in order.
  const pending: Array<[WorkspaceSettings, WorkspaceSettings]> = [];
  let delivering = false;
  // A `persist: false` change leaves memory ahead of storage until the next persisting update.
  let unsaved = false;
  const deliver = (): void => {
    if (delivering) return;
    delivering = true;
    try {
      for (let event = pending.shift(); event; event = pending.shift())
        for (const listener of [...listeners]) listener(event[0], event[1]);
    } finally {
      delivering = false;
      pending.length = 0;
    }
  };
  return {
    get: () => current,
    update(patch, options = {}) {
      const next = validateSettings({ ...current, ...patch });
      const changed = !sameSettings(next, current);
      const persist = options.persist !== false;
      if (!changed && !(persist && unsaved)) return true;
      const previous = current;
      current = next;
      let saved = true;
      if (persist) {
        try {
          storage?.setItem(SETTINGS_KEY, JSON.stringify(current));
          unsaved = false;
        } catch (error) {
          reportSwallowed('settings.save', error);
          saved = false;
        }
      } else unsaved = true;
      if (changed) {
        pending.push([next, previous]);
        deliver();
      }
      return saved;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
