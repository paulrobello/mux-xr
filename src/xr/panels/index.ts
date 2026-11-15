import type { InputMode, PanelModule } from '../scene-context';
import { accentPanel } from './accent';

/** Modes that show the virtual keyboard and edit text with it. */
export const isTypingMode = (mode: InputMode): boolean =>
  mode === 'keyboard' || mode === 'command-editor' || mode === 'picture-url';

import { arrangePanel } from './arrange';
import { backgroundsPanel } from './backgrounds';
import { buttonsPanel } from './buttons';
import { commandEditorPanel } from './command-editor';
import { commandsPanel } from './commands';
import { displayPanel } from './display';
import { filteringPanel } from './filtering';
import { keyboardPanel } from './keyboard';
import { panesPanel } from './panes';
import { pictureGalleryPanel } from './picture-gallery';
import { pictureUrlPanel } from './picture-url';
import { settingsPanel } from './settings';
import { stickyNoteReaderPanel } from './sticky-note-reader';
import { terminalPanel } from './terminal';
import { warpPanel } from './warp';
import { weatherZipPanel } from './weather-zip';
import { widgetsPanel } from './widgets';
import { worldPanel } from './world';

/**
 * One XR panel module per `InputMode`. Each module owns its controls (build), the actions only
 * its buttons emit (handleEarly/handle), and its drag-handle title and Close/Back placement.
 */
export const PANELS: Record<InputMode, PanelModule> = {
  accent: accentPanel,
  arrange: arrangePanel,
  'command-editor': commandEditorPanel,
  commands: commandsPanel,
  display: displayPanel,
  keyboard: keyboardPanel,
  panes: panesPanel,
  'picture-gallery': pictureGalleryPanel,
  'picture-url': pictureUrlPanel,
  'sticky-note-reader': stickyNoteReaderPanel,
  terminal: terminalPanel,
  widgets: widgetsPanel,
  warp: warpPanel,
  backgrounds: backgroundsPanel,
  buttons: buttonsPanel,
  filtering: filteringPanel,
  settings: settingsPanel,
  world: worldPanel,
  'weather-zip': weatherZipPanel,
};
