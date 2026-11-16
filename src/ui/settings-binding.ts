import { type SettingsStore, settingChanged, type WorkspaceSettings } from '../settings/store';

export interface SettingsBindingDeps {
  store: SettingsStore;
  /** Called with each settings change, including ones made by another presenter. */
  onChange?(next: WorkspaceSettings): void;
  /** Called when a save could not be written to storage. */
  onSaveError(): void;
}

export interface SettingsBinding {
  /** The latest settings; read at event time, never cached. */
  current(): WorkspaceSettings;
  /** Registers a control that shows these settings; `refresh` runs when one of them changes. */
  bind(keys: Array<keyof WorkspaceSettings>, refresh: () => void): void;
  /**
   * Writes a patch to the store. The patched controls refresh even when the store ignored the
   * patch, because a control may hold a raw typed value that validation changed back to the
   * stored one.
   */
  save(patch: Partial<WorkspaceSettings>, options?: { persist?: boolean }): void;
  stop(): void;
}

/** Connects the browser controls to the shared settings store. */
export function createSettingsBinding(deps: SettingsBindingDeps): SettingsBinding {
  const { store } = deps;
  let settings = store.get();
  const views: Array<{ keys: Array<keyof WorkspaceSettings>; refresh: () => void }> = [];
  const refreshViews = (changed: (key: keyof WorkspaceSettings) => boolean): void => {
    for (const view of views) if (view.keys.some(changed)) view.refresh();
  };
  const stop = store.subscribe((next, previous) => {
    settings = store.get();
    refreshViews((key) => settingChanged(next, previous, key));
    deps.onChange?.(next);
  });
  return {
    current: () => settings,
    bind(keys, refresh) {
      views.push({ keys, refresh });
    },
    save(patch, options) {
      const saved = store.update(patch, options);
      settings = store.get();
      refreshViews((key) => key in patch);
      if (!saved) deps.onSaveError();
    },
    stop,
  };
}
