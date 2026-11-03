// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWorkspaceUI, validateSettings } from '../src/ui';

afterEach(() => localStorage.clear());

describe('keyboard dictation review', () => {
  it('routes virtual Enter to insertion and keeps draft editing local', () => {
    const root = document.createElement('div');
    const onSendKey = vi.fn();
    const onDictationAction = vi.fn();
    const onDictationDraftChange = vi.fn();
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSendKey,
      onDictationAction,
      onDictationDraftChange,
    });
    ui.update({
      panes: [
        {
          id: 'p',
          title: 'Shell',
          workspaceId: 'w',
          workspaceName: 'Work',
          sessionId: 's',
          sessionName: 'Session',
          windowId: 'win',
          windowName: 'Window',
        },
      ],
    });
    ui.setActivePane('p');
    ui.setAttachedPaneIds(['p']);
    ui.openInput('keyboard');
    ui.setDictationState({ supported: true, status: 'review', transcript: 'echo', error: null });
    root.querySelector<HTMLButtonElement>('[data-key="Enter"]')?.click();
    expect(onDictationAction).toHaveBeenCalledWith('insert');
    expect(onSendKey).not.toHaveBeenCalled();
    ui.setDictationState({ supported: true, status: 'review', transcript: '', error: null });
    root.querySelector<HTMLButtonElement>('[data-key="q"]')?.click();
    expect(onDictationDraftChange).toHaveBeenCalledWith('q');
    expect(onSendKey).not.toHaveBeenCalled();
    ui.destroy();
  });

  it('validates and persists keyboard curvature through browser controls', () => {
    expect(validateSettings({ keyboardCurvature: 500 }).keyboardCurvature).toBe(100);
    expect(validateSettings({ keyboardCurvature: '90' }).keyboardCurvature).toBe(0);
    const root = document.createElement('div');
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    const input = root.querySelector<HTMLInputElement>('[data-keyboard-curvature]');
    if (!input) throw new Error('Keyboard curvature missing');
    input.value = '70';
    input.dispatchEvent(new Event('input'));
    expect(ui.getSettings().keyboardCurvature).toBe(70);
    expect(JSON.parse(localStorage.getItem('mux-xr:settings:v1') ?? '{}').keyboardCurvature).toBe(
      70,
    );
    ui.destroy();
  });
});
