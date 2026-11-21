import type * as THREE from 'three';
import type { ClipboardBridge } from '../../clipboard';
import type { PaneDescriptor, WorkspaceActions } from '../../contracts';
import { summarizePaste } from '../../paste-review';
import type { TerminalPanel, WorkspaceSceneState } from '../scene';
import type { InputMode, PictureUrlDraft } from '../scene-context';
import type { UICue } from '../ui-feedback';
import { CONFIRM_MIN_MS, CONFIRM_WINDOW_MS } from './arming';

/** Null or empty means nothing to paste; an error object carries its own notice. */
type PasteText = string | null | { error: string };

type ArmedPaste = {
  paneId: string;
  summary: ReturnType<typeof summarizePaste>;
  prompt: string;
  flavor: 'clipboard' | 'host';
  at: number;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Everything the clipboard controller needs from the scene closure. Getters keep live values,
 * matching the closure reads the code replaces.
 */
export interface ClipboardDeps {
  bridge: ClipboardBridge;
  actions: Pick<WorkspaceActions, 'readHostClipboard' | 'writeHostClipboard'>;
  mutableState: WorkspaceSceneState;
  panels: ReadonlyMap<string, TerminalPanel>;
  availablePanes: readonly PaneDescriptor[];
  cue(kind: UICue, source?: THREE.Group | number | null): void;
  setNotice(message: string | null): void;
  showToast(message: string | null): void;
  notify(): void;
  disposed(): boolean;
  lastSelectSource(): THREE.Group | null;
  inputRoot(): THREE.Group | null;
  inputMode(): InputMode;
  refreshInputRoot(mode: InputMode): void;
  getPictureUrl(): PictureUrlDraft;
  setPictureUrl(draft: PictureUrlDraft): void;
  getPicturePanelMessage(): string;
  setPicturePanelMessage(value: string): void;
  /** The sentinel pane id that pastes into the open picture URL field. */
  pictureUrlPasteToken: string;
}

export interface ClipboardController {
  pasteClipboard(paneId?: string, source?: THREE.Group | null): Promise<boolean>;
  pasteHostClipboard(paneId?: string, source?: THREE.Group | null): Promise<boolean>;
  copyHostToQuest(source?: THREE.Group | null): Promise<boolean>;
  copyQuestToHost(source?: THREE.Group | null): Promise<boolean>;
  /** Bumps the generation (invalidating in-flight host reads) and drops any armed paste. */
  beginClipboardAction(): number;
  /** True while `generation` is still the live clipboard action counter value. */
  isCurrentClipboardGeneration(generation: number): boolean;
  /** Drops the armed paste and, if its prompt is on screen, the prompt with it. */
  clearArmedPaste(): void;
  /** Drops the armed paste only when it targets `id`. */
  clearArmedPasteForPane(id: string): void;
  /** Clears the armed-paste timer; the scene's dispose calls this. */
  dispose(): void;
}

/**
 * Quest and host clipboard flows for the selected terminal, with the paste-review arming window
 * and the generation guard that supersedes slow host reads.
 */
export const createClipboard = (deps: ClipboardDeps): ClipboardController => {
  let clipboardGeneration = 0;
  let hostPasteInFlight = false;
  let armedPaste: ArmedPaste | null = null;

  /** Drops the armed paste and, if its prompt is on screen, the prompt with it. */
  const clearArmedPaste = (): void => {
    if (!armedPaste) return;
    clearTimeout(armedPaste.timer);
    const prompt = armedPaste.prompt;
    armedPaste = null;
    deps.mutableState.pastePrompt = null;
    if (deps.mutableState.notice === prompt) deps.setNotice(null);
    else deps.notify();
  };
  /** Arms the review prompt: the paste sends only after a second Paste press in the window. */
  const armPaste = (
    paneId: string,
    summary: ArmedPaste['summary'],
    flavor: 'clipboard' | 'host',
    title: string,
    source: THREE.Group | null,
  ): void => {
    clearArmedPaste();
    const lines = summary.lines === 1 ? 'line' : 'lines';
    const characters = summary.characters === 1 ? 'character' : 'characters';
    const removed =
      summary.removed > 0
        ? `, ${summary.removed} control character${summary.removed === 1 ? '' : 's'} removed`
        : '';
    const prompt =
      `Paste ${summary.lines} ${lines}, ${summary.characters} ${characters} to ${title}? ` +
      `Press Paste again. First line: ${summary.preview}${removed}`;
    armedPaste = {
      paneId,
      summary,
      prompt,
      flavor,
      at: Date.now(),
      timer: setTimeout(() => {
        clearArmedPaste();
        if (!deps.disposed()) deps.notify();
      }, CONFIRM_WINDOW_MS),
    };
    deps.mutableState.pastePrompt = prompt;
    deps.setNotice(prompt);
    deps.cue('armed', source);
  };
  /** Bumps the generation (invalidating in-flight host reads) and drops any armed paste. */
  const beginClipboardAction = (): number => {
    const generation = ++clipboardGeneration;
    clearArmedPaste();
    return generation;
  };
  const pasteFrom = async (
    paneId: string | undefined,
    source: THREE.Group | null,
    read: () => Promise<PasteText>,
    pastedToast: string,
    supersedable = false,
  ): Promise<boolean> => {
    const generation = ++clipboardGeneration;
    if (
      deps.inputRoot() &&
      deps.inputMode() === 'picture-url' &&
      (paneId === undefined || paneId === deps.pictureUrlPasteToken)
    ) {
      const received = await read();
      if (deps.disposed() || (supersedable && generation !== clipboardGeneration)) return false;
      // URLs hold no whitespace, so a copied line break or indent is dropped.
      const text = typeof received === 'string' ? received.replace(/\s+/g, '') : '';
      if (!text) {
        deps.setNotice(
          received && typeof received === 'object'
            ? received.error
            : 'Clipboard is empty or unavailable. Copy an image URL first.',
        );
        deps.cue('error', source);
        return false;
      }
      if (!deps.inputRoot() || deps.inputMode() !== 'picture-url') return false;
      const draft = deps.getPictureUrl();
      const characters = Array.from(draft.text);
      const cursor = Math.min(draft.cursor, characters.length);
      const inserted = Array.from(text);
      characters.splice(cursor, 0, ...inserted);
      deps.setPictureUrl({ text: characters.join(''), cursor: cursor + inserted.length });
      deps.setPicturePanelMessage('');
      deps.refreshInputRoot('picture-url');
      deps.showToast(pastedToast);
      return true;
    }
    const id = paneId ?? deps.mutableState.inputTargetId ?? deps.mutableState.selectedTerminalId;
    const panel = id ? deps.panels.get(id) : undefined;
    if (
      !id ||
      !panel ||
      panel.surface.status !== 'connected' ||
      deps.mutableState.selectedTerminalId !== id
    ) {
      deps.setNotice('Select a connected terminal before pasting.');
      deps.cue('error', source);
      return false;
    }
    // A confirming press pastes the reviewed text without reading the clipboard again.
    if (armedPaste) {
      const armed = armedPaste;
      if (armed.paneId !== id || armed.flavor !== (supersedable ? 'host' : 'clipboard')) {
        clearArmedPaste();
      } else {
        const elapsed = Date.now() - armed.at;
        if (elapsed < CONFIRM_MIN_MS) return false;
        if (elapsed > CONFIRM_WINDOW_MS) {
          clearArmedPaste();
        } else {
          if (
            deps.disposed() ||
            deps.panels.get(id) !== panel ||
            deps.mutableState.selectedTerminalId !== id ||
            panel.surface.status !== 'connected'
          ) {
            clearArmedPaste();
            deps.setNotice('The paste target changed. Select it and paste again.');
            deps.cue('error', source);
            return false;
          }
          const summary = armed.summary;
          clearArmedPaste();
          try {
            if (!panel.surface.paste(summary.text)) throw new Error('Paste rejected');
            deps.showToast(pastedToast);
            return true;
          } catch {
            deps.setNotice('The terminal rejected the paste. Reconnect and try again.');
            deps.cue('error', source);
            return false;
          }
        }
      }
    }
    const received = await read();
    if (deps.disposed()) return false;
    // A slow host read loses to any clipboard action started while it was in flight.
    if (supersedable && generation !== clipboardGeneration) return false;
    if (
      deps.panels.get(id) !== panel ||
      deps.mutableState.selectedTerminalId !== id ||
      panel.surface.status !== 'connected'
    ) {
      deps.setNotice('The paste target changed. Select it and paste again.');
      deps.cue('error', source);
      return false;
    }
    if (typeof received !== 'string' || received === '') {
      deps.setNotice(
        received && typeof received === 'object'
          ? received.error
          : 'Clipboard is empty or unavailable. Highlight text to copy it first.',
      );
      deps.cue('error', source);
      return false;
    }
    const summary = summarizePaste(received, deps.mutableState.pasteReview);
    if (!summary.needsReview) {
      try {
        if (!panel.surface.paste(summary.text)) throw new Error('Paste rejected');
        deps.showToast(pastedToast);
        return true;
      } catch {
        deps.setNotice('The terminal rejected the paste. Reconnect and try again.');
        deps.cue('error', source);
        return false;
      }
    }
    armPaste(
      id,
      summary,
      supersedable ? 'host' : 'clipboard',
      deps.availablePanes.find((pane) => pane.id === id)?.title ?? id,
      source,
    );
    return false;
  };
  const readHostText = async (): Promise<string | { error: string }> => {
    if (!deps.actions.readHostClipboard) return { error: 'Host clipboard is not available here.' };
    const result = await deps.actions.readHostClipboard();
    if (!result.ok) return { error: result.message };
    return result.value || { error: 'The host clipboard has no text.' };
  };
  const pasteClipboard = (
    paneId?: string,
    source: THREE.Group | null = deps.lastSelectSource(),
  ): Promise<boolean> => pasteFrom(paneId, source, () => deps.bridge.read(), 'Pasted.');
  const pasteHostClipboard = (
    paneId?: string,
    source: THREE.Group | null = deps.lastSelectSource(),
  ): Promise<boolean> => {
    if (hostPasteInFlight) return Promise.resolve(false);
    hostPasteInFlight = true;
    return pasteFrom(paneId, source, readHostText, 'Pasted host clipboard.', true).finally(() => {
      hostPasteInFlight = false;
    });
  };
  const copyHostToQuest = async (
    source: THREE.Group | null = deps.lastSelectSource(),
  ): Promise<boolean> => {
    const generation = beginClipboardAction();
    const result = await readHostText();
    if (deps.disposed()) return false;
    if (typeof result !== 'string') {
      deps.setNotice(result.error);
      deps.cue('error', source);
      return false;
    }
    const systemCopied = await deps.bridge.copy(result, { fromHost: true });
    if (deps.disposed() || generation !== clipboardGeneration) return systemCopied;
    deps.showToast(
      systemCopied
        ? 'Host clipboard copied to Quest.'
        : 'Host text kept in Mux XR. The Quest clipboard refused it, so use Paste.',
    );
    return systemCopied;
  };
  const copyQuestToHost = async (
    source: THREE.Group | null = deps.lastSelectSource(),
  ): Promise<boolean> => {
    // The read starts before any await so the browser still sees the user gesture.
    beginClipboardAction();
    const pending = deps.bridge.read({ excludeHost: true, preferLocal: true });
    if (!deps.actions.writeHostClipboard) {
      deps.setNotice('Host clipboard is not available here.');
      deps.cue('error', source);
      return false;
    }
    const text = await pending;
    if (deps.disposed()) return false;
    if (!text) {
      deps.setNotice(
        'The Quest clipboard is empty or unavailable here. Copy text in the browser, or highlight terminal text, first.',
      );
      deps.cue('error', source);
      return false;
    }
    const result = await deps.actions.writeHostClipboard(text);
    if (deps.disposed()) return false;
    if (!result.ok) {
      deps.setNotice(result.message);
      deps.cue('error', source);
      return false;
    }
    deps.showToast('Copied to host clipboard.');
    return true;
  };

  return {
    pasteClipboard,
    pasteHostClipboard,
    copyHostToQuest,
    copyQuestToHost,
    beginClipboardAction,
    isCurrentClipboardGeneration: (generation: number): boolean =>
      generation === clipboardGeneration,
    clearArmedPaste,
    clearArmedPasteForPane: (id: string): void => {
      if (armedPaste?.paneId === id) clearArmedPaste();
    },
    dispose: clearArmedPaste,
  };
};
