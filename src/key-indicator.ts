export const KEY_INDICATOR_TTL_MS = 1800;

export function formatKeyIndicator(label: string, sent: boolean, prefix = '⌨'): string {
  return `${prefix} ${label}${sent ? '' : ' (not sent)'}`;
}

/** Shows text through `show`, then clears it after the TTL unless a newer key arrived. */
export function createKeyFlash(
  show: (text: string | null) => void,
  ttlMs: number = KEY_INDICATOR_TTL_MS,
): { flash(text: string): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    flash(text) {
      clear();
      show(text);
      timer = setTimeout(() => {
        timer = null;
        show(null);
      }, ttlMs);
    },
    dispose() {
      clear();
      show(null);
    },
  };
}

export function mountPageKeyIndicator(parent: HTMLElement): (text: string | null) => void {
  const element = document.createElement('div');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'off');
  element.dataset.keyIndicator = '';
  element.hidden = true;
  element.style.cssText =
    'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;padding:6px 12px;' +
    'border:1px solid #38505e;border-radius:6px;background:#111a24ee;color:#edf4f8;' +
    'font:12px ui-monospace,SFMono-Regular,monospace;pointer-events:none';
  parent.append(element);
  return (text) => {
    element.hidden = text === null;
    element.textContent = text ?? '';
  };
}
