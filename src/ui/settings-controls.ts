import { validateWeatherZip } from '@par/xr-workspace';
import type { BackgroundMode, TerminalColorMode } from '../contracts';
import type { WorkspaceSettings } from '../settings/store';
import { validateHierarchyStyle } from '../workspace/hierarchy-style';
import { validateKeyborbMode } from '../workspace/keyborb';

export interface SettingsControlsDeps {
  root: HTMLElement;
  /** The live settings; read at event time. */
  current(): WorkspaceSettings;
  saveSettings(patch: Partial<WorkspaceSettings>): void;
  bindSettings(keys: Array<keyof WorkspaceSettings>, refresh: () => void): void;
}

/**
 * The settings controls the shell markup already contains: the streamer endpoint field, the
 * background, color mode, hierarchy style and Keyborb selects, the toggles, and the weather ZIP.
 * Each shows the stored value, saves on change and follows later changes from other presenters.
 * The hierarchy style and Keyborb selects are refreshed by the settings panel that creates them.
 */
export function mountSettingsControls(deps: SettingsControlsDeps): void {
  const { root, current, saveSettings, bindSettings } = deps;
  const qs = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  const settings = current();
  qs<HTMLInputElement>('#endpoint').value = settings.endpoint;
  qs<HTMLSelectElement>('[data-background]').value = settings.background;
  qs<HTMLSelectElement>('[data-hierarchy-style]').value = settings.hierarchyStyle;
  qs<HTMLSelectElement>('[data-keyborb-mode]').value = settings.keyborbMode;
  qs<HTMLSelectElement>('[data-color-mode]').value = settings.colorMode;
  qs<HTMLInputElement>('[data-keyboard-background]').checked = settings.keyboardBackground;
  qs<HTMLInputElement>('[data-gaze-input]').checked = settings.gazeInput;
  qs<HTMLInputElement>('[data-ui-sounds]').checked = settings.uiSounds;

  qs<HTMLSelectElement>('[data-background]').addEventListener('change', (event) =>
    saveSettings({ background: (event.target as HTMLSelectElement).value as BackgroundMode }),
  );
  qs<HTMLSelectElement>('[data-hierarchy-style]').addEventListener('change', (event) =>
    saveSettings({
      hierarchyStyle: validateHierarchyStyle((event.target as HTMLSelectElement).value),
    }),
  );
  qs<HTMLSelectElement>('[data-keyborb-mode]').addEventListener('change', (event) =>
    saveSettings({ keyborbMode: validateKeyborbMode((event.target as HTMLSelectElement).value) }),
  );
  qs<HTMLSelectElement>('[data-color-mode]').addEventListener('change', (event) =>
    saveSettings({ colorMode: (event.target as HTMLSelectElement).value as TerminalColorMode }),
  );
  qs<HTMLInputElement>('[data-keyboard-background]').addEventListener('change', (event) =>
    saveSettings({ keyboardBackground: (event.target as HTMLInputElement).checked }),
  );
  qs<HTMLInputElement>('[data-gaze-input]').addEventListener('change', (event) =>
    saveSettings({ gazeInput: (event.target as HTMLInputElement).checked }),
  );
  qs<HTMLInputElement>('[data-ui-sounds]').addEventListener('change', (event) =>
    saveSettings({ uiSounds: (event.target as HTMLInputElement).checked }),
  );

  const weatherZipInput = qs<HTMLInputElement>('[data-weather-zip]');
  weatherZipInput.value = settings.weatherZip;
  bindSettings(['weatherZip'], () => {
    weatherZipInput.value = current().weatherZip;
  });
  weatherZipInput.addEventListener('change', () => {
    const next = validateWeatherZip(weatherZipInput.value.trim());
    weatherZipInput.value = next;
    if (current().weatherZip === next) return;
    saveSettings({ weatherZip: next });
  });

  bindSettings(['background'], () => {
    qs<HTMLSelectElement>('[data-background]').value = current().background;
  });
  bindSettings(['colorMode'], () => {
    qs<HTMLSelectElement>('[data-color-mode]').value = current().colorMode;
  });
  bindSettings(['keyboardBackground'], () => {
    qs<HTMLInputElement>('[data-keyboard-background]').checked = current().keyboardBackground;
  });
  bindSettings(['gazeInput'], () => {
    qs<HTMLInputElement>('[data-gaze-input]').checked = current().gazeInput;
  });
  bindSettings(['uiSounds'], () => {
    qs<HTMLInputElement>('[data-ui-sounds]').checked = current().uiSounds;
  });
}
