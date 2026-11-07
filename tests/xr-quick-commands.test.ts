vi.mock('../src/xr/labels', () => import('./helpers/labels'));
vi.mock('../src/xr/standard-hand', async () => ({
  createStandardHand: (await import('../src/xr/cartoon-hand')).createCartoonHand,
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeXR = vi.hoisted(() => ({
  controllers: [] as unknown[],
  hands: [] as unknown[],
  presenting: false,
  camera: null as unknown,
  frame: null as ((time: number) => void) | null,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  fakeXR.controllers = [new actual.Group(), new actual.Group()];
  fakeXR.hands = [new actual.Group(), new actual.Group()];
  class FakeRenderer {
    xr = {
      enabled: false,
      get isPresenting() {
        return fakeXR.presenting;
      },
      getController: (index: number) => fakeXR.controllers[index],
      getHand: (index: number) => fakeXR.hands[index],
      getCamera: () => fakeXR.camera,
      setReferenceSpaceType: vi.fn(),
      setSession: vi.fn(async () => undefined),
    };
    capabilities = { getMaxAnisotropy: () => 1 };
    setPixelRatio(_ratio: number): void {}
    setSize(_width: number, _height: number, _updateStyle?: boolean): void {}
    setAnimationLoop(callback: ((time: number) => void) | null): void {
      fakeXR.frame = callback;
    }
    render(scene: { updateMatrixWorld(force?: boolean): void }): void {
      scene.updateMatrixWorld(true);
    }
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import * as THREE from 'three';
import type {
  PaneDescriptor,
  QuickCommandEntry,
  TerminalSurface,
  WorkspaceActions,
} from '../src/contracts';
import { createWorkspaceScene } from '../src/xr/scene';

type Workspace = ReturnType<typeof createWorkspaceScene>;

const pane = (id: string, title = id): PaneDescriptor => ({
  id,
  title,
  workspaceId: 'workspace',
  workspaceName: 'Workspace',
  sessionId: 'session',
  sessionName: 'Session',
  windowId: 'window',
  windowName: 'Window',
});

function surface(descriptor: PaneDescriptor): TerminalSurface {
  return {
    canvas: document.createElement('canvas'),
    pane: descriptor,
    revision: 0,
    cols: 80,
    rows: 24,
    status: 'connected',
    error: null,
    connect() {},
    disconnect() {},
    sendText: () => true,
    sendKey: () => true,
    paste: () => true,
    focus() {},
    resizeGrid: () => true,
    canResizeGrid: true,
    setColorMode: () => undefined,
    dispose() {},
    subscribe() {
      return () => undefined;
    },
  };
}

const cleanups: Array<() => void> = [];

function fixture() {
  const actions: WorkspaceActions = {
    selectPane: vi.fn(),
    closePane: vi.fn(),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    runCommand: vi.fn(),
    openKeyboard: vi.fn(),
    openCommands: vi.fn(),
    saveCommand: vi.fn(() => true),
    removeCommand: vi.fn(() => true),
  };
  const container = document.createElement('div');
  const workspace = createWorkspaceScene(container, actions);
  fakeXR.camera = workspace.camera;
  const left = surface(pane('pane-a', 'Alpha'));
  const right = surface(pane('pane-b', 'Beta'));
  workspace.addTerminal(left);
  workspace.addTerminal(right);
  workspace.setAvailablePanes([left.pane, right.pane]);
  workspace.selectTerminal('pane-a');
  workspace.scene.updateMatrixWorld(true);
  cleanups.push(() => {
    workspace.dispose();
    container.remove();
  });
  return { workspace, actions };
}

function find(workspace: Workspace, data: Record<string, unknown>): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  workspace.scene.traverse((object) => {
    let visible = true;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent)
      if (!parent.visible) visible = false;
    if (
      visible &&
      !found &&
      Object.entries(data).every(([key, value]) => object.userData[key] === value)
    )
      found = object;
  });
  return found;
}

function hit(workspace: Workspace, data: Record<string, unknown>): void {
  const button = find(workspace, data);
  if (!button) throw new Error(`Control not found: ${JSON.stringify(data)}`);
  workspace.scene.updateMatrixWorld(true);
  const controller = fakeXR.controllers[0] as THREE.Group;
  const orientation = button.getWorldQuaternion(new THREE.Quaternion());
  controller.position.copy(
    button
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, 0, 0.3).applyQuaternion(orientation)),
  );
  controller.quaternion.copy(orientation);
  workspace.scene.updateMatrixWorld(true);
  controller.dispatchEvent({ type: 'selectstart' } as never);
}

const entry = (id: string, extra: Partial<QuickCommandEntry> = {}): QuickCommandEntry => ({
  id,
  label: id,
  text: `echo ${id}`,
  sendNewline: true,
  ...extra,
});

describe('XR quick commands', () => {
  beforeEach(() => {
    fakeXR.presenting = true;
    localStorage.clear();
    for (const controller of fakeXR.controllers as THREE.Group[]) {
      controller.position.set(0, 0, 0);
      controller.rotation.set(0, 0, 0);
      controller.visible = true;
    }
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.useRealTimers();
  });

  it('sends a template prefix, then opens the keyboard on the same pane with the suffix hint', () => {
    const { workspace, actions } = fixture();
    const template = entry('commit', { text: 'git commit -m "{{}}"', sendNewline: true });
    workspace.setQuickCommands([template]);
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'command', commandId: 'commit' });
    expect(actions.runCommand).toHaveBeenCalledWith(template, 'pane-a');
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    expect(workspace.state.inputTargetId).toBe('pane-a');
    expect(workspace.scene.getObjectByName('xr-template-hint')?.userData.labelText).toBe(
      'Then type: "',
    );
    hit(workspace, { inputAction: 'key', key: 'a' });
    expect(workspace.scene.getObjectByName('xr-template-hint')).toBeDefined();
    hit(workspace, { inputAction: 'close' });
    workspace.showInput('keyboard');
    expect(workspace.scene.getObjectByName('xr-template-hint')).toBeUndefined();
  });

  it('arms a confirm command on first press and runs it on the second', () => {
    vi.useFakeTimers();
    const { workspace, actions } = fixture();
    const deploy = entry('deploy', { confirm: true });
    workspace.setQuickCommands([deploy]);
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(actions.runCommand).not.toHaveBeenCalled();
    const armed = find(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(armed?.userData.armed).toBe(true);
    expect(armed?.userData.labelText).toBe('Run deploy?');
    vi.advanceTimersByTime(400);
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(actions.runCommand).toHaveBeenCalledWith(deploy, 'pane-a');
    const settled = find(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(settled?.userData.armed).toBeUndefined();
    expect(settled?.userData.labelText).toBe('deploy');
  });

  it('ignores a confirming press that lands within 350 ms of arming', () => {
    vi.useFakeTimers();
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('deploy', { confirm: true }), entry('old')]);
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    vi.advanceTimersByTime(120);
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(actions.runCommand).not.toHaveBeenCalled();
    expect(find(workspace, { inputAction: 'command', commandId: 'deploy' })?.userData.armed).toBe(
      true,
    );
    vi.advanceTimersByTime(300);
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(actions.runCommand).toHaveBeenCalledTimes(1);
    hit(workspace, { inputAction: 'commandTool', tool: 'remove' });
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    vi.advanceTimersByTime(120);
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    expect(actions.removeCommand).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    expect(actions.removeCommand).toHaveBeenCalledWith('old');
  });

  it('shows the armed command text with visible control characters', () => {
    const { workspace } = fixture();
    workspace.setQuickCommands([
      entry('deploy', { text: 'make deploy\u001b\n', confirm: true, pinned: true }),
      entry('old', { text: 'x'.repeat(90) }),
    ]);
    workspace.showInput('commands');
    const preview = () => workspace.scene.getObjectByName('xr-command-preview')?.userData.labelText;
    expect(preview()).toBeUndefined();
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(preview()).toBe('Sends: make deploy␛⏎');
    expect(workspace.scene.getObjectByName('xr-commands-message')).toBeUndefined();
    hit(workspace, { inputAction: 'commandTool', tool: 'remove' });
    expect(preview()).toBeUndefined();
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    expect(preview()).toBe(`Removes: ${'x'.repeat(59)}…`);
    hit(workspace, { inputAction: 'close' });
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'stripCommand', commandId: 'deploy' });
    expect(preview()).toBe('Sends: make deploy␛⏎');
  });

  it('disarms on timeout, another button, retarget and closing the panel', () => {
    vi.useFakeTimers();
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('deploy', { confirm: true }), entry('other')]);
    workspace.showInput('commands');
    const armedLabel = () =>
      find(workspace, { inputAction: 'command', commandId: 'deploy' })?.userData.labelText;
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    vi.advanceTimersByTime(3001);
    expect(armedLabel()).toBe('deploy');
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(actions.runCommand).not.toHaveBeenCalled();
    hit(workspace, { inputAction: 'command', commandId: 'other' });
    expect(actions.runCommand).toHaveBeenCalledTimes(1);
    expect(armedLabel()).toBe('deploy');
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    workspace.selectTerminal('pane-b');
    expect(armedLabel()).toBe('deploy');
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(actions.runCommand).toHaveBeenCalledTimes(1);
    hit(workspace, { inputAction: 'close' });
    workspace.showInput('commands');
    expect(armedLabel()).toBe('deploy');
    hit(workspace, { inputAction: 'command', commandId: 'deploy' });
    expect(actions.runCommand).toHaveBeenCalledTimes(1);
  });

  it('shows the target pane title and updates it on retarget', () => {
    const { workspace } = fixture();
    workspace.showInput('commands');
    expect(find(workspace, { labelText: 'Quick commands · Target: Alpha' })).toBeDefined();
    workspace.selectTerminal('pane-b');
    expect(find(workspace, { labelText: 'Quick commands · Target: Beta' })).toBeDefined();
    expect(find(workspace, { labelText: 'Quick commands · Target: Alpha' })).toBeUndefined();
  });

  it('saves the confirm toggle from the XR command editor', () => {
    const { workspace, actions } = fixture();
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'newCommand' });
    hit(workspace, { inputAction: 'key', key: 'x' });
    hit(workspace, { inputAction: 'commandField', field: 'text' });
    hit(workspace, { inputAction: 'key', key: 'x' });
    hit(workspace, { inputAction: 'commandConfirm' });
    expect(find(workspace, { inputAction: 'commandConfirm' })?.userData.labelText).toBe(
      'Confirm before running: on',
    );
    hit(workspace, { inputAction: 'commandSave' });
    expect(actions.saveCommand).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'x', text: 'x', confirm: true }),
    );
  });

  it('edits a local command in place with its own id, scope and flags', () => {
    const { workspace, actions } = fixture();
    const saved = entry('build', {
      label: 'Build',
      workspaceId: 'other-workspace',
      confirm: true,
      pinned: true,
    });
    workspace.setQuickCommands([saved]);
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'commandTool', tool: 'edit' });
    hit(workspace, { inputAction: 'command', commandId: 'build' });
    expect(actions.runCommand).not.toHaveBeenCalled();
    expect(workspace.scene.getObjectByName('xr-command-editor-controls')).toBeDefined();
    expect(find(workspace, { labelText: 'Edit quick command' })).toBeDefined();
    expect(find(workspace, { labelText: 'Workspace' })).toBeDefined();
    hit(workspace, { inputAction: 'key', key: 's' });
    hit(workspace, { inputAction: 'commandSave' });
    expect(actions.saveCommand).toHaveBeenCalledWith({
      id: 'build',
      label: 'Builds',
      text: 'echo build',
      sendNewline: true,
      workspaceId: 'other-workspace',
      confirm: true,
      pinned: true,
    });
    expect(workspace.scene.getObjectByName('xr-commands-controls')).toBeDefined();
  });

  it('removes a local command only after a second press', () => {
    vi.useFakeTimers();
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('old'), entry('keep')]);
    vi.mocked(actions.removeCommand as (id: string) => boolean).mockImplementation(() => {
      workspace.setQuickCommands([entry('keep')]);
      return true;
    });
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'commandTool', tool: 'remove' });
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    expect(actions.removeCommand).not.toHaveBeenCalled();
    expect(find(workspace, { inputAction: 'command', commandId: 'old' })?.userData.labelText).toBe(
      'Remove old?',
    );
    vi.advanceTimersByTime(400);
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    expect(actions.removeCommand).toHaveBeenCalledWith('old');
    expect(find(workspace, { inputAction: 'command', commandId: 'old' })).toBeUndefined();
    expect(find(workspace, { labelText: 'Removed old' })).toBeDefined();
  });

  it('keeps the remove tool after a removal so the command that shifts up is not run', () => {
    vi.useFakeTimers();
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('old'), entry('next')]);
    vi.mocked(actions.removeCommand as (id: string) => boolean).mockImplementation(() => {
      workspace.setQuickCommands([entry('next')]);
      return true;
    });
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'commandTool', tool: 'remove' });
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    vi.advanceTimersByTime(400);
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    expect(actions.removeCommand).toHaveBeenCalledWith('old');
    expect(
      find(workspace, { inputAction: 'commandTool', tool: 'remove' })?.userData.activeState,
    ).toBe(true);
    hit(workspace, { inputAction: 'command', commandId: 'next' });
    expect(actions.runCommand).not.toHaveBeenCalled();
    expect(find(workspace, { inputAction: 'command', commandId: 'next' })?.userData.labelText).toBe(
      'Remove next?',
    );
  });

  it('cancels an armed removal when another tool is chosen', () => {
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('old')]);
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'commandTool', tool: 'remove' });
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    hit(workspace, { inputAction: 'commandTool', tool: 'remove' });
    hit(workspace, { inputAction: 'command', commandId: 'old' });
    expect(actions.removeCommand).not.toHaveBeenCalled();
    expect(actions.runCommand).toHaveBeenCalledTimes(1);
  });

  it('refuses to edit or remove shared commands', () => {
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('shared:deploy', { label: 'Deploy', shared: true })]);
    workspace.showInput('commands');
    expect(find(workspace, { commandId: 'shared:deploy' })?.userData.labelText).toBe(
      'Shared · Deploy',
    );
    for (const tool of ['edit', 'remove']) {
      hit(workspace, { inputAction: 'commandTool', tool });
      hit(workspace, { inputAction: 'command', commandId: 'shared:deploy' });
      hit(workspace, { inputAction: 'command', commandId: 'shared:deploy' });
      expect(find(workspace, { labelText: 'Shared commands are read-only' })).toBeDefined();
      hit(workspace, { inputAction: 'commandTool', tool });
    }
    expect(workspace.scene.getObjectByName('xr-command-editor-controls')).toBeUndefined();
    expect(actions.removeCommand).not.toHaveBeenCalled();
    expect(actions.saveCommand).not.toHaveBeenCalled();
  });

  it('orders the XR panel pinned first, then by recent runs, then saved order', () => {
    const { workspace } = fixture();
    workspace.setQuickCommands([
      entry('saved-1'),
      entry('recent', { lastRunAt: 100, runCount: 1 }),
      entry('pinned', { pinned: true }),
      entry('saved-2'),
    ]);
    workspace.showInput('commands');
    const root = workspace.scene.getObjectByName('xr-commands-controls');
    const ids = (root?.children ?? [])
      .filter((child) => child.userData.inputAction === 'command')
      .map((child) => child.userData.commandId);
    expect(ids).toEqual(['pinned', 'recent', 'saved-1', 'saved-2']);
    expect(find(workspace, { commandId: 'pinned' })?.userData.pinned).toBe(true);
  });

  it('pins and unpins a local command from the XR pin tool', () => {
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('a', { lastRunAt: 5, runCount: 2 })]);
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'commandTool', tool: 'pin' });
    hit(workspace, { inputAction: 'command', commandId: 'a' });
    expect(actions.saveCommand).toHaveBeenCalledWith({
      id: 'a',
      label: 'a',
      text: 'echo a',
      sendNewline: true,
      pinned: true,
    });
    expect(actions.runCommand).not.toHaveBeenCalled();
  });

  it('shows a quick strip above the keyboard that runs through the confirm path', () => {
    vi.useFakeTimers();
    const { workspace, actions } = fixture();
    const risky = entry('risky', { pinned: true, confirm: true });
    workspace.setQuickCommands([entry('plain', { runCount: 4 }), risky]);
    workspace.showInput('keyboard');
    const root = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!root) throw new Error('Keyboard missing');
    const strip = root.children.filter((child) => child.userData.inputAction === 'stripCommand');
    expect(strip.map((child) => child.userData.commandId)).toEqual(['risky']);
    const stripBox = new THREE.Box3().setFromObject(strip[0]);
    for (const child of root.children) {
      if (child === strip[0] || child.name === 'input-backdrop' || !child.userData.inputAction)
        continue;
      expect(stripBox.intersectsBox(new THREE.Box3().setFromObject(child))).toBe(false);
    }
    expect(Number(strip[0].userData.labelHeight)).toBeGreaterThanOrEqual(0.09);
    hit(workspace, { inputAction: 'stripCommand', commandId: 'risky' });
    expect(actions.runCommand).not.toHaveBeenCalled();
    expect(find(workspace, { inputAction: 'stripCommand' })?.userData.labelText).toBe('Run risky?');
    vi.advanceTimersByTime(400);
    hit(workspace, { inputAction: 'stripCommand', commandId: 'risky' });
    expect(actions.runCommand).toHaveBeenCalledWith(risky, 'pane-a');
  });

  it('falls back to the most used commands in the quick strip and hides it when unused', () => {
    const { workspace } = fixture();
    workspace.setQuickCommands([entry('never'), entry('used', { runCount: 2, lastRunAt: 1 })]);
    workspace.showInput('keyboard');
    expect(find(workspace, { inputAction: 'stripCommand' })?.userData.commandId).toBe('used');
    hit(workspace, { inputAction: 'close' });
    workspace.setQuickCommands([entry('never')]);
    workspace.showInput('keyboard');
    expect(find(workspace, { inputAction: 'stripCommand' })).toBeUndefined();
  });

  it('keeps the commands panel open for plain commands and omits an empty template hint', () => {
    const { workspace, actions } = fixture();
    workspace.setQuickCommands([entry('plain'), entry('ask', { text: 'ssh {{}}' })]);
    workspace.showInput('commands');
    hit(workspace, { inputAction: 'command', commandId: 'plain' });
    expect(workspace.scene.getObjectByName('xr-commands-controls')).toBeDefined();
    hit(workspace, { inputAction: 'command', commandId: 'ask' });
    expect(actions.runCommand).toHaveBeenCalledTimes(2);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    expect(workspace.scene.getObjectByName('xr-template-hint')).toBeUndefined();
  });
});
