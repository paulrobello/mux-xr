import type { RadialMenu } from './radial-menu';

/** One frame of thumbstick input: XR stick axes (x right, y down) and whether the stick is clicked. */
export interface StickInput {
  x: number;
  y: number;
  pressed: boolean;
}

/** Options for `createStickRadialNavigation`. */
export interface StickRadialNavigationOptions<Action extends string, Controller> {
  /** The menu to drive; only its isOpen, interactive and setHovered members are used. */
  menu: Pick<RadialMenu<Action>, 'isOpen' | 'interactive' | 'setHovered'>;
  /** Wedge ids in the menu's clockwise-from-top order, the same order given to createRadialMenu. */
  items: readonly Action[];
  /** Stick magnitude below which the stick counts as centred. Defaults to 0.35. */
  deadZone?: number;
  /** When true a stick click is ignored, so a host modal such as warp or grip keeps the stick. */
  isBusy?: () => boolean;
  /** Opens the menu; `controller` becomes the navigation owner once the menu reports open. */
  onOpen(controller: Controller): void;
  /** Closes the menu; called for a second stick click while the menu is open. */
  onClose(): void;
}

/**
 * Drives a radial menu from one thumbstick. A stick click toggles the menu open and closed so
 * choosing never requires holding the stick; the live stick angle highlights the wedge it points
 * at (wedges counted clockwise from the top, where createRadialMenu places its first item) and a
 * centred stick highlights cancel; the host's trigger path confirms the highlight with `confirm`.
 * The menu's own isOpen/interactive state is read live every frame, so a host-driven close (wedge
 * activation, warp, session end, dispose) ends navigation ownership without a host reset.
 */
export interface StickRadialNavigation<Action extends string, Controller> {
  /** Feed one frame of stick input for the navigating hand. */
  update(controller: Controller, input: StickInput): void;
  /** Whether a stick currently owns menu navigation; the host's ray hover must defer to it. */
  readonly active: boolean;
  /** Whether this controller's stick opened the open menu and its trigger should confirm. */
  owns(controller: Controller): boolean;
  /** The wedge the stick highlights while navigating, or null when centred or after a confirm. */
  choice(): Action | null;
  /** Confirm the highlight from the host's trigger path: returns the wedge and frees the stick. */
  confirm(): Action | null;
  /** Forget ownership after a host-driven close; safe to call redundantly. */
  reset(): void;
}

/**
 * Resolves a stick direction to a wedge index. Wedges are counted clockwise from the top, where
 * `createRadialMenu` places its first item, so the stick's up direction (-y) points at index 0.
 * Returns null when the stick sits inside the dead zone or `wedgeCount` is below one.
 */
export function wedgeIndexFromStick(
  x: number,
  y: number,
  wedgeCount: number,
  deadZone = 0.35,
): number | null {
  if (wedgeCount < 1 || Math.hypot(x, y) < deadZone) return null;
  const step =
    Math.round(
      ((Math.atan2(y, x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) /
        ((2 * Math.PI) / wedgeCount),
    ) % wedgeCount;
  return step;
}

export function createStickRadialNavigation<Action extends string, Controller>(
  options: StickRadialNavigationOptions<Action, Controller>,
): StickRadialNavigation<Action, Controller> {
  const { menu, items, deadZone = 0.35, isBusy, onOpen, onClose } = options;
  let owner: Controller | null = null;
  let choice: Action | null = null;
  let latched = false;
  const navigation: StickRadialNavigation<Action, Controller> = {
    update(controller, input) {
      if (owner && !menu.isOpen) owner = null;
      if (input.pressed && !latched) {
        latched = true;
        if (menu.isOpen) {
          onClose();
          owner = null;
          choice = null;
        } else if (!isBusy?.()) {
          onOpen(controller);
          if (menu.isOpen) {
            owner = controller;
            choice = null;
          }
        }
      } else if (!input.pressed) {
        latched = false;
      }
      if (owner && menu.isOpen && menu.interactive) {
        const step = wedgeIndexFromStick(input.x, input.y, items.length, deadZone);
        choice = step === null ? null : (items[step] as Action);
        menu.setHovered(choice ?? 'cancel');
      }
    },
    get active(): boolean {
      return owner !== null;
    },
    owns(controller) {
      return owner !== null && owner === controller && menu.isOpen;
    },
    choice() {
      return choice;
    },
    confirm() {
      if (!owner) return null;
      const confirmed = choice;
      owner = null;
      choice = null;
      return confirmed;
    },
    reset() {
      owner = null;
      choice = null;
    },
  };
  return navigation;
}
