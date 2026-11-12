// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWorkspaceUI } from '../src/ui';

afterEach(() => localStorage.clear());

describe('host clipboard browser controls', () => {
  it('places Host → Quest and Quest → Host beside Paste and routes them', () => {
    const root = document.createElement('div');
    const onHostToQuest = vi.fn();
    const onQuestToHost = vi.fn();
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined, onHostToQuest, onQuestToHost });
    const actions = [
      ...root.querySelectorAll<HTMLButtonElement>('.dictation-actions > button'),
    ].map((button) => button.dataset.action);
    expect(actions.slice(0, 3)).toEqual(['paste-clipboard', 'host-to-quest', 'quest-to-host']);
    root.querySelector<HTMLButtonElement>('[data-action="host-to-quest"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-action="quest-to-host"]')?.click();
    expect(onHostToQuest).toHaveBeenCalledTimes(1);
    expect(onQuestToHost).toHaveBeenCalledTimes(1);
    ui.destroy();
  });

  it('saves the pairing secret from a password field, clears it, and forgets on request', () => {
    const root = document.createElement('div');
    let paired = false;
    const onHostClipboardSecret = vi.fn((secret: string | null) => {
      paired = secret !== null && secret.trim() !== '';
      return secret === null || paired;
    });
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      isHostClipboardPaired: () => paired,
      onHostClipboardSecret,
    });
    const input = root.querySelector<HTMLInputElement>('[data-host-clipboard-secret]');
    const status = root.querySelector<HTMLElement>('[data-host-clipboard-status]');
    expect(input?.type).toBe('password');
    expect(input?.autocomplete).toBe('off');
    expect(status?.textContent).toContain('openssl rand -base64 32');
    if (input) input.value = 'not-a-real-pairing-value';
    root.querySelector<HTMLButtonElement>('[data-action="host-clipboard-save"]')?.click();
    expect(onHostClipboardSecret).toHaveBeenLastCalledWith('not-a-real-pairing-value');
    expect(input?.value).toBe('');
    expect(status?.textContent).toContain('Paired');
    expect(JSON.stringify(ui.getSettings())).not.toContain('not-a-real-pairing-value');
    root.querySelector<HTMLButtonElement>('[data-action="host-clipboard-forget"]')?.click();
    expect(onHostClipboardSecret).toHaveBeenLastCalledWith(null);
    expect(status?.textContent).toContain('Forgotten');
    ui.destroy();
  });

  it('refuses to save an empty secret', () => {
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onHostClipboardSecret: () => false,
    });
    root.querySelector<HTMLButtonElement>('[data-action="host-clipboard-save"]')?.click();
    expect(root.querySelector('[data-host-clipboard-status]')?.textContent).toContain(
      'Enter the secret',
    );
    ui.destroy();
  });
});
