import type { InputMode, PanelModule } from '../scene-context';
import { accentPanel } from './accent';
import { backgroundsPanel } from './backgrounds';
import { buttonsPanel } from './buttons';
import { filteringPanel } from './filtering';
import { settingsPanel } from './settings';
import { weatherZipPanel } from './weather-zip';
import { worldPanel } from './world';

/**
 * One XR panel module per `InputMode`. Each module owns its controls (build), the actions only
 * its buttons emit (handleEarly/handle), and its drag-handle title and Close/Back placement.
 */
export const PANELS: Partial<Record<InputMode, PanelModule>> = {
  accent: accentPanel,
  backgrounds: backgroundsPanel,
  buttons: buttonsPanel,
  filtering: filteringPanel,
  settings: settingsPanel,
  world: worldPanel,
  'weather-zip': weatherZipPanel,
};
