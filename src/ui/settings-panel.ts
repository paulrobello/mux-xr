import { validateHandColor } from '@par/xr-workspace';
import type { PanelArrangement } from '../contracts';
import type { WorkspaceSettings } from '../settings/store';
import { validateTerminalFiltering } from '../terminal/filtering';
import {
  AGENT_TOKENS,
  type AgentRowsChoice,
  type AgentsSort,
  parseAgentRows,
} from '../workspace/agent-roster';
import {
  BUTTON_FUNCTION_LABELS,
  BUTTON_FUNCTIONS,
  CONTROLLER_BUTTON_LABELS,
  CONTROLLER_BUTTONS,
  type ControllerButton,
  DEFAULT_BUTTON_MAP,
} from '../workspace/controller-buttons';
import { validateKeyboardCurvature } from '../workspace/keyboard-curvature';
import {
  MAX_TERMINAL_CURVATURE_DEGREES,
  validateWindowPreferences,
} from '../workspace/window-preferences';
import type { UICallbacks } from './index';

// The swatch the color picker shows while the hands keep their default color.
const DEFAULT_HAND_SWATCH = '#b4b4b4';
// The swatch the accent pickers show while the XR accent stays the default cyan.
const DEFAULT_ACCENT_SWATCH = '#68d6ff';

export interface SettingsPanelDeps {
  /** The `[data-settings]` element the controls are inserted into. */
  panel: HTMLElement;
  root: HTMLElement;
  callbacks: UICallbacks;
  /** The live settings; read at event time, never cached. */
  current(): WorkspaceSettings;
  saveSettings(patch: Partial<WorkspaceSettings>): void;
  bindSettings(keys: Array<keyof WorkspaceSettings>, refresh: () => void): void;
  /** The selected pane, which the per-pane curvature and opacity sliders edit. */
  activePaneId(): string | undefined;
  terminalCurvature: Map<string, number>;
  terminalOpacity: Map<string, number>;
  qs<T extends Element = Element>(selector: string): T;
  /** Re-renders the agent roster after its layout setting changes. */
  renderAgents(): void;
}

export interface SettingsPanel {
  /** Enables Apply arrangement only while terminals are attached. */
  setArrangementAvailable(available: boolean): void;
}

/** Builds the browser settings controls inside the panel and keeps them in step with the settings. */
export function mountSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const { panel: settingsPanel, root, callbacks, current, saveSettings, bindSettings, qs } = deps;
  const { terminalCurvature, terminalOpacity } = deps;
  const activePane = (): string | undefined => deps.activePaneId();
  const renderAgents = (): void => deps.renderAgents();
  let arrangementSelect: HTMLSelectElement | null = null;
  let arrangementApply: HTMLButtonElement | null = null;
  let hierarchyStyleSelect: HTMLSelectElement | null = null;
  let agentSortSelect: HTMLSelectElement | null = null;
  let keyborbModeSelect: HTMLSelectElement | null = null;
  let updateWindowPreferenceControls = (): void => undefined;
  let updateHandColorControls = (): void => undefined;
  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Terminal colors';
  const colorSelect = document.createElement('select');
  colorSelect.dataset.colorMode = 'true';
  colorSelect.setAttribute('aria-label', 'Terminal color mode');
  colorSelect.innerHTML =
    '<option value="comfort">Comfort colors</option><option value="original">Original colors</option><option value="monochrome">Monochrome</option>';
  colorLabel.append(colorSelect);
  settingsPanel.insertBefore(
    colorLabel,
    settingsPanel.querySelector('[data-background]')?.parentElement ?? null,
  );
  const keyboardBackground = document.createElement('label');
  keyboardBackground.className = 'check';
  keyboardBackground.innerHTML =
    '<input type="checkbox" data-keyboard-background> Keyboard background <span>Show the keyboard panel background in XR.</span>';
  settingsPanel.insertBefore(
    keyboardBackground,
    settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
  );
  const keyboardCurvature = document.createElement('label');
  keyboardCurvature.innerHTML =
    '<span>Keyboard curvature <span data-keyboard-curvature-value>0°</span></span><input data-keyboard-curvature type="range" min="0" max="100" step="1" aria-label="Keyboard curvature in degrees">';
  settingsPanel.insertBefore(
    keyboardCurvature,
    settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
  );
  const keyboardCurvatureInput = keyboardCurvature.querySelector<HTMLInputElement>(
    '[data-keyboard-curvature]',
  );
  const keyboardCurvatureValue = keyboardCurvature.querySelector<HTMLElement>(
    '[data-keyboard-curvature-value]',
  );
  if (!keyboardCurvatureInput || !keyboardCurvatureValue)
    throw new Error('Keyboard curvature control missing');
  const updateKeyboardCurvature = (): void => {
    keyboardCurvatureInput.value = String(current().keyboardCurvature);
    keyboardCurvatureValue.textContent = `${current().keyboardCurvature}°`;
  };
  keyboardCurvatureInput.addEventListener('input', () =>
    saveSettings({
      keyboardCurvature: validateKeyboardCurvature(Number(keyboardCurvatureInput.value)),
    }),
  );
  bindSettings(['keyboardCurvature'], updateKeyboardCurvature);
  updateKeyboardCurvature();
  const keyborb = document.createElement('label');
  keyborb.innerHTML =
    '<span>Keyborb</span><select data-keyborb-mode aria-label="Keyborb"><option value="off">Off</option><option value="on">On</option><option value="auto">Auto</option></select><small>Auto uses Keyborb with hand tracking.</small>';
  settingsPanel.insertBefore(
    keyborb,
    settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
  );
  keyborbModeSelect = keyborb.querySelector('[data-keyborb-mode]');
  if (!keyborbModeSelect) throw new Error('Keyborb control missing');
  const keyborbSelect = keyborbModeSelect;
  bindSettings(['keyborbMode'], () => {
    keyborbSelect.value = current().keyborbMode;
  });
  keyborbModeSelect.value = current().keyborbMode;
  const uiSounds = document.createElement('label');
  uiSounds.className = 'check';
  uiSounds.innerHTML =
    '<input type="checkbox" data-ui-sounds> UI sounds <span>Play short clicks in XR and pulse the controllers on presses, grabs and scrolling.</span>';
  settingsPanel.insertBefore(
    uiSounds,
    settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
  );
  const weatherZip = document.createElement('label');
  weatherZip.innerHTML =
    '<span>Weather ZIP</span><input data-weather-zip type="text" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" placeholder="5-digit US ZIP" aria-label="Weather ZIP code"><small>US ZIP for the XR weather widget; leave empty for none.</small>';
  settingsPanel.insertBefore(
    weatherZip,
    settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
  );
  // A color picker plus a button that clears the color back to empty.
  const colorPicker = (
    key: 'handColor' | 'armColor' | 'accentColor' | 'environmentAccentColor',
    label: string,
    reset: string,
    resetTitle: string,
    swatch: () => string,
  ): (() => void) => {
    const row = document.createElement('div');
    const id = {
      handColor: 'hand',
      armColor: 'arm',
      accentColor: 'accent',
      environmentAccentColor: 'environment-accent',
    }[key];
    row.innerHTML = `<label for="mux-${id}-color">${label}</label><div class="hand-color-row"><input id="mux-${id}-color" type="color" data-${id}-color><button type="button" data-action="${id}-color-default" class="text-btn" title="${resetTitle}">${reset}</button></div>`;
    settingsPanel.insertBefore(row, settingsPanel.querySelector('[data-action="passthrough"]'));
    const input = row.querySelector<HTMLInputElement>(`[data-${id}-color]`);
    const clear = row.querySelector<HTMLButtonElement>(`[data-action="${id}-color-default"]`);
    if (!input || !clear) throw new Error(`${label} control missing`);
    const update = (): void => {
      input.value = current()[key] || swatch();
      clear.disabled = !current()[key];
    };
    input.addEventListener('input', () => saveSettings({ [key]: validateHandColor(input.value) }));
    clear.addEventListener('click', () => saveSettings({ [key]: '' }));
    return update;
  };
  const updateHandPicker = colorPicker(
    'handColor',
    'Hand color',
    'Default',
    'Use the default hand color',
    () => DEFAULT_HAND_SWATCH,
  );
  const updateArmPicker = colorPicker(
    'armColor',
    'Arm color',
    'Match hands',
    'Color the arms like the hands',
    () => current().handColor || DEFAULT_HAND_SWATCH,
  );
  const updateAccentPicker = colorPicker(
    'accentColor',
    'XR accent color',
    'Default',
    'Use the default cyan accent',
    () => DEFAULT_ACCENT_SWATCH,
  );
  const updateEnvironmentAccentPicker = colorPicker(
    'environmentAccentColor',
    'Environment accent',
    'Match accent',
    'Tint environment glows like the XR accent',
    () => current().accentColor || DEFAULT_ACCENT_SWATCH,
  );
  updateHandColorControls = () => {
    updateHandPicker();
    updateArmPicker();
    updateAccentPicker();
    updateEnvironmentAccentPicker();
  };
  bindSettings(['handColor', 'armColor', 'accentColor', 'environmentAccentColor'], () =>
    updateHandColorControls(),
  );
  updateHandColorControls();
  const filteringControls = document.createElement('div');
  filteringControls.innerHTML =
    '<label>Terminal filtering<select data-filter-mode aria-label="Terminal filtering"><option value="nearest">Nearest pixels</option><option value="linear">Linear (sharp)</option><option value="mipmap-nearest">Mipmap bilinear</option><option value="mipmap-linear">Mipmap trilinear (smooth)</option></select></label><label data-filter-anisotropy-row>Anisotropy (mipmap modes)<select data-filter-anisotropy aria-label="Terminal anisotropy"><option value="1">Off</option><option value="2">2x</option><option value="4">4x</option><option value="8">8x</option><option value="16">16x</option></select><span>Anisotropy matters for oblique minification. 8x and 16x may look the same front-facing.</span></label><label class="check"><input type="checkbox" data-filter-gaze> Sharper gazed terminal <span>Use sharp linear sampling while looking at a terminal.</span></label><label data-filter-distance-row>Gaze max distance<input data-filter-distance type="number" min="0.25" max="20" step="0.25" aria-label="Gaze maximum distance in meters"><span>Sharper gaze ignores mipmaps within this distance.</span></label>';
  settingsPanel.insertBefore(
    filteringControls,
    settingsPanel.querySelector('[data-action="passthrough"]'),
  );
  const filterMode = filteringControls.querySelector<HTMLSelectElement>('[data-filter-mode]');
  const filterAnisotropy = filteringControls.querySelector<HTMLSelectElement>(
    '[data-filter-anisotropy]',
  );
  const filterGaze = filteringControls.querySelector<HTMLInputElement>('[data-filter-gaze]');
  const filterDistance =
    filteringControls.querySelector<HTMLInputElement>('[data-filter-distance]');
  const filterAnisotropyRow = filteringControls.querySelector<HTMLElement>(
    '[data-filter-anisotropy-row]',
  );
  const filterDistanceRow = filteringControls.querySelector<HTMLElement>(
    '[data-filter-distance-row]',
  );
  if (
    !filterMode ||
    !filterAnisotropy ||
    !filterGaze ||
    !filterDistance ||
    !filterAnisotropyRow ||
    !filterDistanceRow
  )
    throw new Error('Filtering controls missing');
  const updateFilteringVisibility = (): void => {
    const mipmapMode =
      filterMode.value === 'mipmap-nearest' || filterMode.value === 'mipmap-linear';
    filterAnisotropyRow.hidden = !mipmapMode;
    filterDistanceRow.hidden = !mipmapMode || !filterGaze.checked;
  };
  const showFiltering = (): void => {
    filterMode.value = current().filtering.mode;
    filterAnisotropy.value = String(current().filtering.anisotropy);
    filterGaze.checked = current().filtering.gazeClarity;
    filterDistance.value = String(current().filtering.gazeMaxDistance);
    updateFilteringVisibility();
  };
  const changeFiltering = (): void =>
    saveSettings({
      filtering: validateTerminalFiltering({
        mode: filterMode.value,
        anisotropy: Number(filterAnisotropy.value),
        gazeClarity: filterGaze.checked,
        gazeMaxDistance: Number(filterDistance.value),
      }),
    });
  bindSettings(['filtering'], showFiltering);
  filterMode.addEventListener('change', changeFiltering);
  filterAnisotropy.addEventListener('change', changeFiltering);
  filterGaze.addEventListener('change', changeFiltering);
  filterDistance.addEventListener('change', changeFiltering);
  showFiltering();
  const hierarchyStyle = document.createElement('label');
  hierarchyStyle.innerHTML =
    '<span>Hierarchy style</span><select data-hierarchy-style aria-label="Hierarchy style"><option value="helix">Helix Navigator</option><option value="spatial-docks">Spatial Docks</option></select>';
  settingsPanel.insertBefore(
    hierarchyStyle,
    settingsPanel.querySelector('[data-action="passthrough"]'),
  );
  hierarchyStyleSelect = hierarchyStyle.querySelector('[data-hierarchy-style]');
  if (!hierarchyStyleSelect) throw new Error('Hierarchy style control missing');
  const hierarchySelect = hierarchyStyleSelect;
  bindSettings(['hierarchyStyle'], () => {
    hierarchySelect.value = current().hierarchyStyle;
  });
  hierarchyStyleSelect.value = current().hierarchyStyle;
  const agentControls = document.createElement('fieldset');
  agentControls.dataset.agentRoster = 'true';
  agentControls.innerHTML = `<legend>Agent roster</legend><label>Rows<select data-agent-rows aria-label="Agent roster rows"><option value="full">Full (state, agent, title / workspace, project, pane / message)</option><option value="default">par-mux default (state, workspace, project / agent)</option><option value="compact">Compact (state, agent)</option><option value="detailed">Detailed (state, workspace, project / agent, pane)</option><option value="verbose">Verbose (state, agent / message)</option><option value="custom">Custom</option></select></label><label data-agent-rows-custom-row>Custom rows<input data-agent-rows-custom type="text" spellcheck="false" placeholder="state_icon, workspace, project / agent" aria-label="Custom agent roster rows"><small data-agent-rows-hint></small></label><label>Order<select data-agents-sort aria-label="Agent order"><option value="pane">Pane (rows stay put)</option><option value="grouped">Grouped by workspace, urgent first</option><option value="priority">Priority, most urgent first</option></select></label>`;
  settingsPanel.insertBefore(agentControls, settingsPanel.querySelector('[data-action="reset"]'));
  const hostClipboard = document.createElement('fieldset');
  hostClipboard.dataset.hostClipboard = 'true';
  hostClipboard.innerHTML =
    '<legend>Host clipboard</legend><label>Pairing secret<input data-host-clipboard-secret type="password" autocomplete="off" spellcheck="false" aria-label="Host clipboard pairing secret" placeholder="Contents of .local/clipboard-secret"></label><div class="dictation-actions"><button data-action="host-clipboard-save" class="secondary">Save</button><button data-action="host-clipboard-forget" class="text-btn" title="Remove the pairing secret from this browser">Forget</button></div><small data-host-clipboard-status></small>';
  settingsPanel.insertBefore(hostClipboard, settingsPanel.querySelector('[data-action="reset"]'));
  const agentRowsSelect = agentControls.querySelector<HTMLSelectElement>('[data-agent-rows]');
  const agentRowsCustom = agentControls.querySelector<HTMLInputElement>('[data-agent-rows-custom]');
  const agentRowsCustomRow = agentControls.querySelector<HTMLElement>(
    '[data-agent-rows-custom-row]',
  );
  const agentRowsHint = agentControls.querySelector<HTMLElement>('[data-agent-rows-hint]');
  agentSortSelect = agentControls.querySelector('[data-agents-sort]');
  if (
    !agentRowsSelect ||
    !agentRowsCustom ||
    !agentRowsCustomRow ||
    !agentRowsHint ||
    !agentSortSelect
  )
    throw new Error('Agent roster controls missing');
  const sortSelect = agentSortSelect;
  const updateAgentControls = (): void => {
    agentRowsSelect.value = current().agentRows;
    agentRowsCustom.value = current().agentRowsCustom;
    sortSelect.value = current().agentsSort;
    agentRowsCustomRow.hidden = current().agentRows !== 'custom';
    const { rows, unknown } = parseAgentRows(current().agentRowsCustom);
    agentRowsHint.textContent = `${
      unknown.length ? `Unknown, skipped: ${unknown.join(', ')}. ` : ''
    }${rows.length ? '' : 'No known token yet, so the Full rows show. '}Separate lines with / and tokens with commas. Tokens: ${AGENT_TOKENS.join(', ')}.`;
    agentRowsHint.classList.toggle('warn', unknown.length > 0);
  };
  const changeAgentLayout = (): void => {
    saveSettings({
      agentRows: agentRowsSelect.value as AgentRowsChoice,
      agentRowsCustom: agentRowsCustom.value.slice(0, 500),
      agentsSort: sortSelect.value as AgentsSort,
    });
    renderAgents();
  };
  bindSettings(['agentRows', 'agentRowsCustom', 'agentsSort'], updateAgentControls);
  agentRowsSelect.addEventListener('change', changeAgentLayout);
  agentRowsCustom.addEventListener('change', changeAgentLayout);
  sortSelect.addEventListener('change', changeAgentLayout);
  updateAgentControls();
  const windowControls = document.createElement('div');
  windowControls.dataset.windowPreferences = 'true';
  windowControls.innerHTML = `<fieldset><legend>Window and focus preferences</legend><label>New window glass opacity <span data-window-opacity-value>100%</span><input data-window-opacity type="range" min="10" max="100" step="1" aria-label="New window glass opacity percentage"><small>Applies to new windows only. Existing panes are unchanged.</small></label><label>New window warp <span data-window-warp-value>0°</span><input data-window-warp type="range" min="0" max="${MAX_TERMINAL_CURVATURE_DEGREES}" step="5" aria-label="New window curvature in degrees"><small>Applies to new windows only. Existing panes are unchanged.</small></label><label>Focus distance <span data-focus-distance-value>1.5 m</span><input data-focus-distance type="range" min="0.5" max="5" step="0.1" aria-label="Focus distance in meters"><small>Distance in front of you when focusing any window.</small></label><label>Focus warp <select data-focus-warp-mode><option value="custom">Custom</option><option value="inherit">Inherit from terminal</option></select></label><label>Focus warp angle <span data-focus-curvature-value>0°</span><input data-focus-curvature type="range" min="0" max="${MAX_TERMINAL_CURVATURE_DEGREES}" step="5" aria-label="Focus curvature in degrees"><small>Temporary focus curvature. The original curvature restores when focus ends.</small></label><label>Scroll strip <select data-scroll-strip-side aria-label="Scroll strip side"><option value="right">Right</option><option value="left">Left</option><option value="both">Both sides</option></select><small>Pinch and drag the strip beside each pane to scroll it.</small></label><label><input data-frame-chin type="checkbox" aria-label="Show the chin under each pane frame"> Frame chin<small>Adds the instrument strip under each pane frame.</small></label></fieldset>`;
  settingsPanel.insertBefore(
    windowControls,
    settingsPanel.querySelector('[data-action="passthrough"]'),
  );
  const windowOpacity = windowControls.querySelector<HTMLInputElement>('[data-window-opacity]');
  const windowWarp = windowControls.querySelector<HTMLInputElement>('[data-window-warp]');
  const windowDistance = windowControls.querySelector<HTMLInputElement>('[data-focus-distance]');
  const focusWarpMode = windowControls.querySelector<HTMLSelectElement>('[data-focus-warp-mode]');
  const windowCurvature = windowControls.querySelector<HTMLInputElement>('[data-focus-curvature]');
  const stripSide = windowControls.querySelector<HTMLSelectElement>('[data-scroll-strip-side]');
  const frameChin = windowControls.querySelector<HTMLInputElement>('[data-frame-chin]');
  const windowOpacityValue = windowControls.querySelector<HTMLElement>(
    '[data-window-opacity-value]',
  );
  const windowWarpValue = windowControls.querySelector<HTMLElement>('[data-window-warp-value]');
  const windowDistanceValue = windowControls.querySelector<HTMLElement>(
    '[data-focus-distance-value]',
  );
  const windowCurvatureValue = windowControls.querySelector<HTMLElement>(
    '[data-focus-curvature-value]',
  );
  if (
    !windowOpacity ||
    !windowWarp ||
    !windowWarpValue ||
    !windowDistance ||
    !windowCurvature ||
    !focusWarpMode ||
    !stripSide ||
    !frameChin ||
    !windowOpacityValue ||
    !windowDistanceValue ||
    !windowCurvatureValue
  )
    throw new Error('Window preference controls missing');
  updateWindowPreferenceControls = (): void => {
    windowOpacity.value = String(Math.round(current().windowPreferences.defaultOpacity * 100));
    windowWarp.value = String(current().windowPreferences.defaultCurvature);
    windowDistance.value = String(current().windowPreferences.focusDistance);
    focusWarpMode.value = current().windowPreferences.focusWarpMode;
    windowCurvature.disabled = focusWarpMode.value === 'inherit';
    windowCurvature.value = String(current().windowPreferences.focusCurvature);
    stripSide.value = current().windowPreferences.scrollStripSide;
    frameChin.checked = current().windowPreferences.frameChin;
    windowOpacityValue.textContent = `${windowOpacity.value}%`;
    windowWarpValue.textContent = `${windowWarp.value}°`;
    windowDistanceValue.textContent = `${windowDistance.value} m`;
    windowCurvatureValue.textContent = `${windowCurvature.value}°`;
  };
  const changeWindowPreferences = (): void =>
    saveSettings({
      windowPreferences: validateWindowPreferences({
        defaultOpacity: Number(windowOpacity.value) / 100,
        defaultCurvature: Number(windowWarp.value),
        focusDistance: Number(windowDistance.value),
        focusWarpMode: focusWarpMode.value,
        focusCurvature: Number(windowCurvature.value),
        scrollStripSide: stripSide.value,
        frameChin: frameChin.checked,
        buttonMap: current().windowPreferences.buttonMap,
      }),
    });
  windowOpacity.addEventListener('input', changeWindowPreferences);
  windowWarp.addEventListener('input', changeWindowPreferences);
  windowDistance.addEventListener('input', changeWindowPreferences);
  focusWarpMode.addEventListener('change', changeWindowPreferences);
  windowCurvature.addEventListener('input', changeWindowPreferences);
  stripSide.addEventListener('change', changeWindowPreferences);
  frameChin.addEventListener('change', changeWindowPreferences);
  updateWindowPreferenceControls();
  const buttonControls = document.createElement('div');
  buttonControls.dataset.controllerButtons = 'true';
  const functionOptions = BUTTON_FUNCTIONS.map(
    (choice) => `<option value="${choice}">${BUTTON_FUNCTION_LABELS[choice]}</option>`,
  ).join('');
  buttonControls.innerHTML = `<fieldset><legend>Controller buttons</legend>${CONTROLLER_BUTTONS.map(
    (button) =>
      `<label>${CONTROLLER_BUTTON_LABELS[button]} <select data-controller-button="${button}" aria-label="${CONTROLLER_BUTTON_LABELS[button]} button function">${functionOptions}</select></label>`,
  ).join(
    '',
  )}<button data-action="reset-controller-buttons" class="secondary">Reset buttons</button><small>While warping a pane, right A saves and right B cancels.</small></fieldset>`;
  settingsPanel.insertBefore(
    buttonControls,
    settingsPanel.querySelector('[data-action="passthrough"]'),
  );
  const buttonSelects = [
    ...buttonControls.querySelectorAll<HTMLSelectElement>('[data-controller-button]'),
  ];
  const updateButtonControls = (): void => {
    for (const select of buttonSelects)
      select.value =
        current().windowPreferences.buttonMap[select.dataset.controllerButton as ControllerButton];
  };
  const saveButtonMap = (buttonMap: unknown): void =>
    saveSettings({
      windowPreferences: validateWindowPreferences({ ...current().windowPreferences, buttonMap }),
    });
  for (const select of buttonSelects)
    select.addEventListener('change', () =>
      saveButtonMap(
        Object.fromEntries(
          buttonSelects.map((entry) => [entry.dataset.controllerButton, entry.value]),
        ),
      ),
    );
  buttonControls
    .querySelector('[data-action="reset-controller-buttons"]')
    ?.addEventListener('click', () => saveButtonMap(DEFAULT_BUTTON_MAP));
  const refreshWindowControls = updateWindowPreferenceControls;
  updateWindowPreferenceControls = (): void => {
    refreshWindowControls();
    updateButtonControls();
  };
  bindSettings(['windowPreferences'], () => updateWindowPreferenceControls());
  updateButtonControls();
  const grid = document.createElement('div');
  grid.dataset.gridControls = 'true';
  grid.innerHTML = `<label>Selected terminal grid <span data-grid-caption>None selected</span></label><div class="grid-inputs"><label>Columns<input data-grid-cols type="number" min="2" max="300" step="1" aria-label="Terminal columns"></label><label>Rows<input data-grid-rows type="number" min="2" max="150" step="1" aria-label="Terminal rows"></label></div><button data-action="apply-grid" class="secondary">Apply grid</button><small data-grid-status>Resize changes the process display size and do not restart it.</small><label>Terminal curvature <span data-terminal-curvature-value>0°</span><input data-terminal-curvature type="range" min="0" max="${MAX_TERMINAL_CURVATURE_DEGREES}" step="1" value="0" aria-label="Terminal curvature in degrees"></label><label>Terminal glass opacity <span data-terminal-opacity-value>100%</span><input data-terminal-opacity type="range" min="10" max="100" step="5" value="100" aria-label="Terminal glass opacity"><small>Foreground text remains opaque.</small></label><button data-action="reset-terminal-appearance" class="secondary" title="Forget this pane's saved glass opacity and warp so it follows the new-window defaults">Reset to defaults</button>`;
  settingsPanel.insertBefore(
    grid,
    settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
  );
  const arrangement = document.createElement('div');
  arrangement.dataset.arrangementControls = 'true';
  arrangement.innerHTML =
    '<label for="arrangement-pattern">3D arrangement</label><select id="arrangement-pattern" data-arrangement aria-label="3D terminal arrangement"><option value="row">Row</option><option value="grid">Grid</option><option value="arc">Arc</option><option value="sphere">Sphere</option></select><small>Applies to attached terminals in 3D. Sphere uses a front hemisphere. Terminals remain individually adjustable.</small><button data-action="apply-arrangement" class="secondary" title="Apply this 3D arrangement to attached terminals">Apply arrangement</button>';
  const distanceRow = document.createElement('div');
  distanceRow.className = 'grid-inputs';
  for (const [label, direction] of [
    ['Closer', -1],
    ['Farther', 1],
  ] as const) {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = label;
    button.dataset.action = direction < 0 ? 'layout-closer' : 'layout-farther';
    button.title =
      direction < 0
        ? 'Move all terminals closer without resizing them'
        : 'Move all terminals farther without resizing them';
    button.addEventListener('click', () => callbacks.onMoveLayout?.(direction));
    distanceRow.append(button);
  }
  arrangement.append(distanceRow);
  settingsPanel.insertBefore(
    arrangement,
    settingsPanel.querySelector('[data-action="passthrough"]') ?? null,
  );
  arrangementSelect = arrangement.querySelector('[data-arrangement]');
  arrangementApply = arrangement.querySelector('[data-action="apply-arrangement"]');
  if (!arrangementSelect || !arrangementApply) throw new Error('Missing arrangement controls');
  const select = arrangementSelect;
  select.value = current().arrangement;
  bindSettings(['arrangement'], () => {
    select.value = current().arrangement;
  });
  arrangementApply.addEventListener('click', () => {
    const pattern = select.value as PanelArrangement;
    saveSettings({ arrangement: pattern });
    callbacks.onArrange?.(pattern);
  });
  root
    .querySelector<HTMLInputElement>('[data-terminal-curvature]')
    ?.addEventListener('input', (event) => {
      const paneId = activePane();
      if (!paneId) return;
      const degrees = Math.max(
        0,
        Math.min(MAX_TERMINAL_CURVATURE_DEGREES, Number((event.target as HTMLInputElement).value)),
      );
      terminalCurvature.set(paneId, degrees);
      qs<HTMLElement>('[data-terminal-curvature-value]').textContent = `${degrees}°`;
      callbacks.onTerminalCurvature?.(paneId, degrees);
    });
  root
    .querySelector<HTMLInputElement>('[data-terminal-opacity]')
    ?.addEventListener('input', (event) => {
      const paneId = activePane();
      if (!paneId) return;
      const rawOpacity = Number((event.target as HTMLInputElement).value);
      const opacity = Number.isFinite(rawOpacity) ? Math.max(10, Math.min(100, rawOpacity)) : 100;
      terminalOpacity.set(paneId, opacity);
      qs<HTMLElement>('[data-terminal-opacity-value]').textContent = `${opacity}%`;
      callbacks.onTerminalOpacity?.(paneId, opacity);
    });
  root
    .querySelector<HTMLButtonElement>('[data-action="reset-terminal-appearance"]')
    ?.addEventListener('click', () => {
      const paneId = activePane();
      if (paneId) callbacks.onTerminalReset?.(paneId);
    });
  return {
    setArrangementAvailable(available) {
      if (arrangementApply) arrangementApply.disabled = !available;
    },
  };
}
