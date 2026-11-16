import { HOST_CLIPBOARD_SETUP } from '../host-clipboard';
import type { UICallbacks } from './index';

/**
 * The buttons that only hand their action to the host app, keyed by `data-action`. Buttons that
 * read or change presenter state (connect, the drawer, send, paste and sort) stay with the
 * presenter.
 */
export function forwardedActions(callbacks: UICallbacks): Record<string, () => void> {
  return {
    refresh: () => callbacks.onRefresh?.(),
    xr: () => callbacks.onEnterXR?.(),
    'reload-update': () => callbacks.onReloadApp?.(),
    'dictation-start': () => callbacks.onDictationAction?.('start'),
    'dictation-stop': () => callbacks.onDictationAction?.('stop'),
    'dictation-insert': () => callbacks.onDictationAction?.('insert'),
    'dictation-clear': () => callbacks.onDictationAction?.('clear'),
    'dictation-cancel': () => callbacks.onDictationAction?.('cancel'),
    'host-to-quest': () => callbacks.onHostToQuest?.(),
    'quest-to-host': () => callbacks.onQuestToHost?.(),
    passthrough: () => callbacks.onPassthrough?.('ar'),
    'desk-window': () => callbacks.onPassthrough?.('desk'),
    demo: () => callbacks.onDemo?.(),
    reset: () => callbacks.onResetLayout?.(),
  };
}

export interface HostClipboardControlsDeps {
  root: HTMLElement;
  callbacks: UICallbacks;
}

export interface HostClipboardControls {
  /** Shows whether the host clipboard is paired, or `message` when one is given. */
  updateStatus(message?: string | null): void;
  /** Handles the Save and Forget buttons; false when `action` is neither. */
  handleAction(action: string): boolean;
}

/** The pairing secret field and its Save and Forget buttons in the settings panel. */
export function mountHostClipboardControls(deps: HostClipboardControlsDeps): HostClipboardControls {
  const { root, callbacks } = deps;
  const secretInput = (): HTMLInputElement => {
    const input = root.querySelector<HTMLInputElement>('[data-host-clipboard-secret]');
    if (!input) throw new Error('Missing workspace control: [data-host-clipboard-secret]');
    return input;
  };
  const updateStatus = (message: string | null = null): void => {
    const status = root.querySelector<HTMLElement>('[data-host-clipboard-status]');
    if (!status) return;
    status.textContent =
      message ??
      (callbacks.isHostClipboardPaired?.()
        ? 'Paired. The secret is stored only in this browser.'
        : `Not paired. ${HOST_CLIPBOARD_SETUP}`);
  };
  updateStatus();
  return {
    updateStatus,
    handleAction(action) {
      if (action === 'host-clipboard-save') {
        const input = secretInput();
        const saved = callbacks.onHostClipboardSecret?.(input.value) ?? false;
        input.value = '';
        updateStatus(saved ? null : 'Enter the secret before saving.');
        return true;
      }
      if (action === 'host-clipboard-forget') {
        callbacks.onHostClipboardSecret?.(null);
        secretInput().value = '';
        updateStatus('Forgotten. Host clipboard transfers are off in this browser.');
        return true;
      }
      return false;
    },
  };
}
