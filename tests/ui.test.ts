// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { QuickCommand } from '../src/contracts';
import {
  createCommandStore,
  mountWorkspaceUI,
  reorderCommands,
  validateSettings,
  workspaceScope,
} from '../src/ui';

const command = (id: string, workspaceId?: string): QuickCommand => ({
  id,
  label: id,
  text: `echo ${id}`,
  sendNewline: true,
  workspaceId,
});
const query = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
};

describe('mux XR local UI state', () => {
  it('falls back safely for malformed or outdated settings', () => {
    expect(validateSettings(null)).toMatchObject({
      version: 1,
      background: 'observatory',
      gazeEmphasis: true,
    });
    expect(
      validateSettings({ version: 9, endpoint: 42, background: 'laser', gazeEmphasis: 'yes' }),
    ).toMatchObject({ version: 1, endpoint: '', background: 'observatory', gazeEmphasis: true });
    expect(
      validateSettings({ endpoint: 'WSS://LAN', background: 'black', gazeEmphasis: false }),
    ).toMatchObject({
      version: 1,
      endpoint: 'WSS://LAN',
      background: 'black',
      gazeEmphasis: false,
    });
  });

  it('isolates command lists by endpoint and workspace and preserves order', () => {
    const storage = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    } as unknown as Storage;
    const store = createCommandStore(fakeStorage);
    const firstScope = workspaceScope('wss://one', 'alpha');
    const secondScope = workspaceScope('wss://one', 'beta');
    store.set(firstScope, [command('one'), command('two')]);
    store.set(secondScope, [command('other')]);
    expect(store.get(firstScope).map((item) => item.id)).toEqual(['one', 'two']);
    expect(store.get(secondScope).map((item) => item.id)).toEqual(['other']);
    expect(reorderCommands(store.get(firstScope), 1, 0).map((item) => item.id)).toEqual([
      'two',
      'one',
    ]);
    expect(store.get(firstScope).map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('rejects malformed persisted commands', () => {
    const storage = new Map<string, string>([
      ['mux-xr:commands:v1', JSON.stringify({ scope: [command('good'), { id: 'bad' }] })],
    ]);
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => undefined,
    } as unknown as Storage;
    expect(
      createCommandStore(fakeStorage)
        .get('scope')
        .map((item) => item.id),
    ).toEqual(['good']);
  });

  it('returns false and keeps persisted commands when storage throws', () => {
    const stored = JSON.stringify({ scope: [command('kept')] });
    const storage = {
      getItem: () => stored,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    } as unknown as Storage;
    const store = createCommandStore(storage);
    expect(store.set('scope', [command('new')])).toBe(false);
    expect(store.get('scope').map((item) => item.id)).toEqual(['kept']);
  });

  it('captures the input target when the drawer opens', () => {
    const sent: string[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSendText: (paneId) => sent.push(paneId),
    });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'A',
        },
        {
          id: 'b',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'B',
        },
      ],
    });
    ui.setActivePane('a');
    query<HTMLButtonElement>(root, '[data-action="commands"]').click();
    ui.setActivePane('b');
    const compose = query<HTMLTextAreaElement>(root, '[data-compose]');
    compose.value = 'echo stable';
    query<HTMLButtonElement>(root, '[data-action="send-text"]').click();
    expect(sent).toEqual(['a']);
    ui.destroy();
  });

  it('routes public commands to endpoint-global or exact workspace buckets', () => {
    localStorage.clear();
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, { onConnect: () => undefined });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'alpha',
          workspaceName: 'Alpha',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'w',
          windowName: 'Code',
          title: 'A',
        },
        {
          id: 'b',
          workspaceId: 'beta',
          workspaceName: 'Beta',
          sessionId: 's',
          sessionName: 'Ops',
          windowId: 'w',
          windowName: 'Shell',
          title: 'B',
        },
      ],
    });
    ui.addCommand(command('global'));
    ui.addCommand(command('alpha', 'alpha'));
    expect(ui.getCommandsForPane('a').map((item) => item.id)).toEqual(['global', 'alpha']);
    expect(ui.getCommandsForPane('b').map((item) => item.id)).toEqual(['global']);
    ui.destroy();
  });

  it('detaches a captured pane without sending to the replacement selection', () => {
    const sent: string[] = [];
    const closed: string[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onSendText: (id) => sent.push(id),
      onClosePane: (pane) => closed.push(pane.id),
    });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'A',
        },
        {
          id: 'b',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'B',
        },
      ],
    });
    ui.setActivePane('a');
    ui.openInput('commands');
    ui.setActivePane('b');
    query<HTMLButtonElement>(root, '[data-action="close-drawer"]').click();
    expect(query<HTMLElement>(root, '[data-detail]').textContent).toContain('Input target: B');
    expect(closed).toEqual([]);
    expect(sent).toEqual([]);
    ui.destroy();
  });

  it('reset preserves command data', () => {
    localStorage.clear();
    const root = document.createElement('div');
    document.body.append(root);
    const ui = mountWorkspaceUI(root, {
      onConnect: () => undefined,
      onResetLayout: () => undefined,
    });
    ui.update({
      panes: [
        {
          id: 'a',
          workspaceId: 'w',
          workspaceName: 'Main',
          sessionId: 's',
          sessionName: 'Dev',
          windowId: 'win',
          windowName: 'Code',
          title: 'A',
        },
      ],
    });
    ui.addCommand(command('keep'));
    query<HTMLButtonElement>(root, '[data-action="settings"]').click();
    query<HTMLButtonElement>(root, '[data-action="reset"]').click();
    expect(ui.getCommands().map((item) => item.id)).toContain('keep');
    ui.destroy();
  });
});
