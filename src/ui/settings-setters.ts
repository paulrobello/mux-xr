import type { WorkspaceSettings } from '../settings/store';
import { validateTerminalFiltering } from '../terminal/filtering';
import type { WorkspaceUI } from './index';

export interface SettingsSettersDeps {
  root: HTMLElement;
  /** The live settings; read at call time. */
  current(): WorkspaceSettings;
  saveSettings(patch: Partial<WorkspaceSettings>, options?: { persist?: boolean }): void;
}

type SettingsSetters = Pick<
  WorkspaceUI,
  | 'setTerminalColorMode'
  | 'setKeyboardBackgroundEnabled'
  | 'setKeyboardCurvature'
  | 'setTerminalFiltering'
  | 'setWindowPreferences'
  | 'setHierarchyStyle'
  | 'setKeyborbMode'
  | 'setBackground'
  | 'setArmColor'
  | 'setWeatherZip'
  | 'setAccentColor'
  | 'setEnvironmentAccentColor'
  | 'setHandColor'
  | 'setUISounds'
  | 'setArrangement'
  | 'setFilteringCapabilities'
>;

/**
 * The `WorkspaceUI` methods that write one setting from outside the page: the scene and the host
 * app call them with `persist` false for a change that should not be saved. Writing goes through
 * the shared settings store, so the controls refresh themselves.
 */
export function createSettingsSetters(deps: SettingsSettersDeps): SettingsSetters {
  const { root, current, saveSettings } = deps;
  return {
    setTerminalColorMode: (mode, persist = true) => saveSettings({ colorMode: mode }, { persist }),
    setKeyboardBackgroundEnabled: (enabled, persist = true) =>
      saveSettings({ keyboardBackground: enabled }, { persist }),
    setKeyboardCurvature: (degrees, persist = false) =>
      saveSettings({ keyboardCurvature: degrees }, { persist }),
    setTerminalFiltering: (filtering, persist = false) => saveSettings({ filtering }, { persist }),
    setWindowPreferences: (value, persist = false) =>
      saveSettings({ windowPreferences: value }, { persist }),
    setHierarchyStyle: (style, persist = false) =>
      saveSettings({ hierarchyStyle: style }, { persist }),
    setKeyborbMode: (mode, persist = false) => saveSettings({ keyborbMode: mode }, { persist }),
    setBackground: (mode, persist = false) => saveSettings({ background: mode }, { persist }),
    setArmColor: (color, persist = false) => saveSettings({ armColor: color }, { persist }),
    setWeatherZip: (zip, persist = false) => saveSettings({ weatherZip: zip }, { persist }),
    setAccentColor: (color, persist = false) => saveSettings({ accentColor: color }, { persist }),
    setEnvironmentAccentColor: (color, persist = false) =>
      saveSettings({ environmentAccentColor: color }, { persist }),
    setHandColor: (color, persist = false) => saveSettings({ handColor: color }, { persist }),
    setUISounds: (enabled, persist = false) => saveSettings({ uiSounds: enabled }, { persist }),
    setArrangement: (pattern, persist = true) =>
      saveSettings({ arrangement: pattern }, { persist }),
    setFilteringCapabilities(maxAnisotropy) {
      const ceiling = Number.isFinite(maxAnisotropy)
        ? Math.max(1, Math.min(16, maxAnisotropy))
        : 16;
      const select = root.querySelector<HTMLSelectElement>('[data-filter-anisotropy]');
      if (!select) throw new Error('Missing workspace control: [data-filter-anisotropy]');
      for (const option of select.options) option.hidden = Number(option.value) > ceiling;
      if (Number(select.value) <= ceiling) return;
      const available = [...select.options].reverse().find((option) => !option.hidden);
      if (!available) return;
      saveSettings({
        filtering: validateTerminalFiltering({
          ...current().filtering,
          anisotropy: Number(available.value),
        }),
      });
    },
  };
}
