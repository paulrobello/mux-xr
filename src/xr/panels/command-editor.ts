import type * as THREE from 'three';
import { commandFromDraft, editCommandDraft } from '../command-editor';
import { actionData } from '../panel-actions';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';
import { addKeyboardKeysSection } from './keyboard';

export const commandEditorPanel: PanelModule = {
  desktopSwap: 'keyboard',
  title: (ctx) =>
    ctx.commandEditorMessage ||
    (ctx.commandDraft?.editing ? 'Edit quick command' : 'New quick command'),
  titleY: 0.88,
  build(root: THREE.Group, ctx: SceneContext): void {
    const draft = ctx.commandDraft;
    if (!draft) return;
    for (const [field, y] of [
      ['label', 0.7],
      ['text', 0.56],
    ] as const) {
      const value = Array.from(draft[field]);
      const active = draft.field === field;
      if (active) value.splice(draft.cursor, 0, '|');
      const start = active ? Math.max(0, draft.cursor - 28) : 0;
      const button = createLabelButton(
        `${field === 'label' ? 'Name' : 'Command'}: ${start ? '…' : ''}${value.slice(start, start + 56).join('')}`,
        1.5,
        0.1,
        actionData({ type: 'commandField', field }, { wrap: true }),
      );
      button.position.y = y;
      setModifierVisual(button, active, ctx.accent.hex);
      root.add(button);
    }
    const scope = createLabelButton(
      draft.scope === 'global' ? 'Global' : 'Workspace',
      0.5,
      0.09,
      actionData({ type: 'commandScope' }),
    );
    scope.position.set(-0.55, 1.04, 0);
    const enter = createLabelButton(
      `Enter: ${draft.sendNewline ? 'on' : 'off'}`,
      0.5,
      0.09,
      actionData({ type: 'commandNewline' }),
    );
    enter.position.set(0, 1.04, 0);
    const save = createLabelButton('Save', 0.4, 0.09, actionData({ type: 'commandSave' }));
    save.position.set(0.55, 1.04, 0);
    const clear = createLabelButton(
      'Clear field',
      0.45,
      0.09,
      actionData({ type: 'commandClear' }),
    );
    clear.position.set(-0.28, -0.53, 0);
    const cancel = createLabelButton('Cancel', 0.4, 0.09, actionData({ type: 'commandCancel' }));
    cancel.position.set(0.28, -0.53, 0);
    const confirm = createLabelButton(
      `Confirm before running: ${draft.confirm ? 'on' : 'off'}`,
      0.9,
      0.09,
      actionData({ type: 'commandConfirm' }),
    );
    confirm.position.set(0, 1.18, 0);
    root.add(scope, enter, save, clear, cancel, confirm);
    addKeyboardKeysSection(root, ctx);
  },
  handleActionEarly(action, _hit, ctx) {
    if (action.type === 'commandCancel') {
      ctx.commandDraft = null;
      ctx.commandEditorMessage = '';
      ctx.refreshInputRoot('commands');
      return true;
    }
    const draft = ctx.commandDraft;
    if (!draft) return false;
    switch (action.type) {
      case 'commandField':
        ctx.commandEditorMessage = '';
        draft.field = action.field as 'label' | 'text';
        draft.cursor = Array.from(draft[draft.field]).length;
        break;
      case 'commandScope':
        ctx.commandEditorMessage = '';
        if (ctx.commandWorkspaceId) draft.scope = draft.scope === 'global' ? 'workspace' : 'global';
        else ctx.commandEditorMessage = 'Select a pane for workspace scope';
        break;
      case 'commandNewline':
        ctx.commandEditorMessage = '';
        draft.sendNewline = !draft.sendNewline;
        break;
      case 'commandConfirm':
        ctx.commandEditorMessage = '';
        draft.confirm = !draft.confirm;
        break;
      case 'commandClear':
        ctx.commandEditorMessage = '';
        draft[draft.field] = '';
        draft.cursor = 0;
        break;
      case 'commandSave': {
        ctx.commandEditorMessage = '';
        const command = commandFromDraft(draft, ctx.commandWorkspaceId);
        if (!command) ctx.commandEditorMessage = 'Enter a name and command';
        else if (!ctx.actions.saveCommand(command))
          ctx.commandEditorMessage = 'Could not save on this device';
        else {
          ctx.commandDraft = null;
          ctx.snapshotMenuCommands();
          ctx.clearArmedModifiers();
          ctx.refreshInputRoot('commands');
          return true;
        }
        break;
      }
      default:
        return false;
    }
    ctx.clearArmedModifiers();
    ctx.refreshInputRoot('command-editor');
    return true;
  },
  handleAction(action, _hit, ctx) {
    if (action.type !== 'key' || !ctx.commandDraft) return false;
    if (action.modifier) ctx.modifierState.tap(action.modifier);
    else {
      ctx.commandDraft = editCommandDraft(
        ctx.commandDraft,
        action.key as string,
        ctx.modifierState.active,
      );
      ctx.consumeArmedModifiers();
    }
    ctx.commandEditorMessage = '';
    ctx.refreshInputRoot('command-editor');
    return true;
  },
};
