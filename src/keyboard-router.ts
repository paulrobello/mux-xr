import { describeKey, type KeyEventLike, keyEventToTerminalBytes } from './keyboard-input';

export interface KeyboardEventLike extends KeyEventLike {
  readonly isComposing?: boolean;
  readonly target: EventTarget | null;
  composedPath?(): EventTarget[];
  preventDefault(): void;
}

export interface KeyRouterDeps {
  selectedPaneId(): string | null;
  isConnected(paneId: string): boolean;
  applicationCursor(paneId: string): boolean;
  sendBytes(paneId: string, bytes: string): void;
  /** True while an in-scene text field owns typing. */
  textEntryActive(): boolean;
  /** Types a key into the open in-scene text field; true when the field took it. */
  typeTextEntry?(key: string): boolean;
  /** True while an XR session is presenting, when page focus no longer matters. */
  xrPresenting(): boolean;
  /** True while the first-gesture XR entry fallback will consume this keydown. */
  xrEntryFallbackArmed(): boolean;
  /** Called for every keydown outside editable fields, so delivery is observable. */
  onKey(label: string, sent: boolean): void;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const NEUTRAL_TAGS = new Set(['BODY', 'HTML', 'CANVAS']);

interface ElementLike {
  tagName?: unknown;
  isContentEditable?: unknown;
  closest?(selector: string): unknown;
  hasAttribute?(name: string): boolean;
  matches?(selector: string): boolean;
}

const asElement = (target: EventTarget | null): ElementLike | null => {
  const element = target as ElementLike | null;
  return element && typeof element.tagName === 'string' ? element : null;
};

/** xterm's hidden input under each surface; it never takes typing, the router does. */
const isXtermHelper = (element: ElementLike): boolean => {
  try {
    return element.matches?.('textarea.xterm-helper-textarea') === true;
  } catch {
    return false;
  }
};

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element || isXtermHelper(element)) return false;
  return (
    element.isContentEditable === true ||
    EDITABLE_TAGS.has((element.tagName as string).toUpperCase())
  );
}

const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Tab']);

function hasKeyboardFocus(target: EventTarget | null): boolean {
  try {
    return asElement(target)?.matches?.(':focus-visible') === true;
  } catch {
    return false;
  }
}

/** A focused button, link or summary, wherever it sits: it keeps only its own activation and navigation keys. */
export function isActivatableControl(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element) return false;
  const tag = (element.tagName as string).toUpperCase();
  return (
    tag === 'BUTTON' ||
    tag === 'SUMMARY' ||
    (tag === 'A' && element.hasAttribute?.('href') === true)
  );
}

/** Focus on the document, the canvas or the scene host, where no page control would use the key. */
export function isNeutralFocusTarget(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element) return true;
  if (NEUTRAL_TAGS.has((element.tagName as string).toUpperCase()) || isXtermHelper(element))
    return true;
  return Boolean(element.closest?.('[data-scene-host]'));
}

function focusAllows(target: EventTarget | null, key: string): boolean {
  if (isActivatableControl(target)) return !(hasKeyboardFocus(target) && ACTIVATION_KEYS.has(key));
  return isNeutralFocusTarget(target);
}

export function routeKeydown(event: KeyboardEventLike, deps: KeyRouterDeps): boolean {
  const target = event.composedPath?.()[0] ?? event.target;
  if (!deps.xrPresenting() && isEditableTarget(target)) return false;
  const label = describeKey(event);
  if (deps.textEntryActive()) {
    const typed =
      !event.isComposing &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      (deps.xrPresenting() || focusAllows(event.composedPath?.()[0] ?? event.target, event.key)) &&
      deps.typeTextEntry?.(event.key) === true;
    if (typed) event.preventDefault();
    deps.onKey(label, typed);
    return typed;
  }
  const paneId = deps.selectedPaneId();
  const eligible =
    !event.isComposing &&
    !deps.textEntryActive() &&
    !deps.xrEntryFallbackArmed() &&
    (deps.xrPresenting() || focusAllows(target, event.key)) &&
    paneId !== null &&
    deps.isConnected(paneId);
  const bytes =
    eligible && paneId !== null
      ? keyEventToTerminalBytes(event, { applicationCursor: deps.applicationCursor(paneId) })
      : null;
  if (bytes === null || paneId === null) {
    deps.onKey(label, false);
    return false;
  }
  event.preventDefault();
  deps.sendBytes(paneId, bytes);
  deps.onKey(label, true);
  return true;
}

export function installKeyboardRouter(doc: Document, deps: KeyRouterDeps): () => void {
  const listener = (event: KeyboardEvent): void => {
    routeKeydown(event, deps);
  };
  doc.addEventListener('keydown', listener);
  return () => doc.removeEventListener('keydown', listener);
}
