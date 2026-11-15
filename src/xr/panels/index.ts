import type { InputMode, PanelModule } from '../scene-context';

/**
 * One XR panel module per `InputMode`. Each module owns its controls (build), the actions only
 * its buttons emit (handleEarly/handle), and its drag-handle title and Close/Back placement.
 */
export const PANELS: Partial<Record<InputMode, PanelModule>> = {};
