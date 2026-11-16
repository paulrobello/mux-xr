import { createModifierState, keyboardKeys } from '@par/xr-workspace';
import type { KeyModifiers } from '../contracts';
import { getKeyHelp } from '../control-help';
import type { DictationAction, DictationState } from '../speech-input';
import { terminalKeyLabel } from '../terminal/protocol';

const LONG_PRESS_MS = 550;

/** The tooltip for a key, from the shared control help. */
export const keyboardTitle = (key: string): string => getKeyHelp(key) ?? '';

export interface KeyboardDeps {
  root: HTMLElement;
  /** The pane the drawer sends to; set when the drawer opens. */
  capturedTarget(): string | undefined;
  onSendKey?(paneId: string, key: string, modifiers?: KeyModifiers): void;
  onDictationAction?(action: DictationAction): void;
  onDictationDraftChange?(text: string): void;
}

export interface Keyboard {
  /** Releases held and locked modifiers and clears pending long presses. */
  clearModifiers(): void;
  setDictationState(state: DictationState): void;
  /** Handles a click on a key button; false when the button is not a key. */
  handleKeyClick(button: HTMLElement): boolean;
}

/**
 * The drawer's terminal keyboard: modifier taps and long-press locks, key presses sent to the
 * captured pane or into the dictation draft, and the dictation controls' enabled state.
 */
export function mountKeyboard(deps: KeyboardDeps): Keyboard {
  const { root } = deps;
  const qs = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  };
  const modifierState = createModifierState();
  const holdTimers = new Map<HTMLButtonElement, number>();
  let dictationState: DictationState | undefined;

  const keyboardLabel = (key: string, shift = false): string => {
    if (key.length === 1 && key !== ' ') return terminalKeyLabel(key, shift);
    return keyboardKeys.find((entry) => entry.key === key)?.label ?? key;
  };
  const syncModifierVisuals = (): void => {
    for (const key of root.querySelectorAll<HTMLButtonElement>('.key')) {
      const modifier = key.dataset.modifier as 'ctrl' | 'alt' | 'shift' | undefined;
      if (modifier) {
        const active = Boolean(modifierState.active[modifier]);
        const locked = Boolean(modifierState.locked[modifier]);
        key.classList.toggle('active', active);
        key.classList.toggle('locked', locked);
        key.setAttribute('aria-pressed', String(active));
        key.title = locked
          ? `${key.textContent ?? modifier} locked (click to unlock)`
          : keyboardTitle(key.dataset.key ?? '');
      } else {
        key.textContent = keyboardLabel(key.dataset.key ?? '', Boolean(modifierState.active.shift));
      }
    }
  };
  const clearModifiers = (): void => {
    for (const timer of holdTimers.values()) window.clearTimeout(timer);
    holdTimers.clear();
    modifierState.clear();
    for (const key of root.querySelectorAll<HTMLButtonElement>('.key'))
      delete key.dataset.longPressed;
    syncModifierVisuals();
  };
  const cancelModifierHold = (button: HTMLButtonElement): void => {
    const timer = holdTimers.get(button);
    if (timer !== undefined) window.clearTimeout(timer);
    holdTimers.delete(button);
  };

  root.addEventListener('pointerdown', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-modifier]');
    if (!button) return;
    const modifier = button.dataset.modifier as 'ctrl' | 'alt' | 'shift' | undefined;
    if (!modifier) return;
    delete button.dataset.longPressed;
    cancelModifierHold(button);
    button.setPointerCapture?.(event.pointerId);
    holdTimers.set(
      button,
      window.setTimeout(() => {
        modifierState.lock(modifier);
        button.dataset.longPressed = 'true';
        syncModifierVisuals();
        holdTimers.delete(button);
      }, LONG_PRESS_MS),
    );
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    root.addEventListener(eventName, (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-modifier]');
      if (button) {
        cancelModifierHold(button);
        if (eventName === 'pointercancel') delete button.dataset.longPressed;
      }
    });
  }
  qs<HTMLTextAreaElement>('[data-dictation-draft]').addEventListener('input', (event) => {
    deps.onDictationDraftChange?.((event.target as HTMLTextAreaElement).value);
  });

  const setDictationState = (state: DictationState): void => {
    dictationState = { ...state };
    const start = qs<HTMLButtonElement>('[data-action="dictation-start"]');
    const stop = qs<HTMLButtonElement>('[data-action="dictation-stop"]');
    const insert = qs<HTMLButtonElement>('[data-action="dictation-insert"]');
    const clear = qs<HTMLButtonElement>('[data-action="dictation-clear"]');
    const draft = qs<HTMLTextAreaElement>('[data-dictation-draft]');
    const status = qs<HTMLElement>('[data-dictation-status]');
    start.disabled = !state.supported || ['listening', 'transcribing'].includes(state.status);
    start.textContent = state.status === 'transcribing' ? 'Transcribing…' : 'Dictate';
    stop.hidden = state.status !== 'listening';
    insert.hidden = Boolean(state.forNote);
    insert.disabled =
      Boolean(state.forNote) ||
      !['review', 'error'].includes(state.status) ||
      !state.transcript.trim();
    clear.hidden = !['review', 'error'].includes(state.status) || !state.transcript.trim();
    draft.disabled =
      state.status === 'idle' ||
      state.status === 'listening' ||
      state.status === 'transcribing' ||
      (state.status === 'error' && !state.transcript.trim());
    if (draft.value !== state.transcript) draft.value = state.transcript;
    status.textContent = state.error ?? `Speech input is ${state.status}.`;
  };

  /** Types one key into the dictation draft, or runs Enter and Escape as its insert and cancel. */
  const editDraft = (key: string, state: DictationState): void => {
    const draft = qs<HTMLTextAreaElement>('[data-dictation-draft]');
    let start = draft.selectionStart;
    let end = draft.selectionEnd;
    if (key === 'Enter') {
      if (!state.forNote) deps.onDictationAction?.('insert');
    } else if (key === 'Escape') deps.onDictationAction?.('cancel');
    else {
      if (key === 'ArrowLeft')
        start = end =
          draft.value.slice(0, start).length -
          (Array.from(draft.value.slice(0, start)).at(-1)?.length ?? 0);
      else if (key === 'ArrowRight')
        start = end = end + (Array.from(draft.value.slice(end))[0]?.length ?? 0);
      else if (key === 'Home') start = end = 0;
      else if (key === 'End') start = end = draft.value.length;
      else if (key === 'Backspace' || key === 'Delete' || key.length === 1) {
        if (key === 'Backspace' && start === end)
          start -= Array.from(draft.value.slice(0, start)).at(-1)?.length ?? 0;
        if (key === 'Delete' && start === end)
          end += Array.from(draft.value.slice(end))[0]?.length ?? 0;
        const text =
          key.length === 1 ? terminalKeyLabel(key, Boolean(modifierState.active.shift)) : '';
        draft.setRangeText(text, start, end, 'end');
        start = end = draft.selectionEnd;
        deps.onDictationDraftChange?.(draft.value);
      }
      draft.setSelectionRange(start, end);
    }
  };

  const handleKeyClick = (button: HTMLElement): boolean => {
    const key = button.dataset.key;
    if (!key) return false;
    const modifier = button.dataset.modifier as 'ctrl' | 'alt' | 'shift' | '';
    if (modifier) {
      if (button.dataset.longPressed) {
        delete button.dataset.longPressed;
        return true;
      }
      modifierState.tap(modifier);
      syncModifierVisuals();
      return true;
    }
    if (['listening', 'transcribing'].includes(dictationState?.status ?? '')) return true;
    if (
      dictationState &&
      (dictationState.status === 'review' ||
        (dictationState.status === 'error' && dictationState.transcript))
    ) {
      editDraft(key, dictationState);
      modifierState.consume();
      syncModifierVisuals();
      return true;
    }
    const captured = deps.capturedTarget();
    if (captured) deps.onSendKey?.(captured, key, { ...modifierState.active });
    modifierState.consume();
    syncModifierVisuals();
    return true;
  };

  return { clearModifiers, setDictationState, handleKeyClick };
}
