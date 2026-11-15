import type * as THREE from 'three';
import type { KeyModifiers } from '../../contracts';
import { commandFromDraft, editCommandDraft } from '../command-editor';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const commandEditorPanel: PanelModule = {
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
        { inputAction: 'commandField', field, wrap: true },
      );
      button.position.y = y;
      setModifierVisual(button, active);
      root.add(button);
    }
    const scope = createLabelButton(draft.scope === 'global' ? 'Global' : 'Workspace', 0.5, 0.09, {
      inputAction: 'commandScope',
    });
    scope.position.set(-0.55, 1.04, 0);
    const enter = createLabelButton(`Enter: ${draft.sendNewline ? 'on' : 'off'}`, 0.5, 0.09, {
      inputAction: 'commandNewline',
    });
    enter.position.set(0, 1.04, 0);
    const save = createLabelButton('Save', 0.4, 0.09, { inputAction: 'commandSave' });
    save.position.set(0.55, 1.04, 0);
    const clear = createLabelButton('Clear field', 0.45, 0.09, { inputAction: 'commandClear' });
    clear.position.set(-0.28, -0.53, 0);
    const cancel = createLabelButton('Cancel', 0.4, 0.09, { inputAction: 'commandCancel' });
    cancel.position.set(0.28, -0.53, 0);
    const confirm = createLabelButton(
      `Confirm before running: ${draft.confirm ? 'on' : 'off'}`,
      0.9,
      0.09,
      { inputAction: 'commandConfirm' },
    );
    confirm.position.set(0, 1.18, 0);
    root.add(scope, enter, save, clear, cancel, confirm);
  },
  handleEarly(action, hit, ctx) {
    if (action === 'commandCancel') {
      ctx.commandDraft = null;
      ctx.commandEditorMessage = '';
      ctx.refreshInputRoot('commands');
      return true;
    }
    const draft = ctx.commandDraft;
    if (
      draft &&
      [
        'commandField',
        'commandScope',
        'commandNewline',
        'commandConfirm',
        'commandClear',
        'commandSave',
      ].includes(action ?? '')
    ) {
      ctx.commandEditorMessage = '';
      if (action === 'commandField') {
        draft.field = hit.userData.field as 'label' | 'text';
        draft.cursor = Array.from(draft[draft.field]).length;
      } else if (action === 'commandScope') {
        if (ctx.commandWorkspaceId) draft.scope = draft.scope === 'global' ? 'workspace' : 'global';
        else ctx.commandEditorMessage = 'Select a pane for workspace scope';
      } else if (action === 'commandNewline') draft.sendNewline = !draft.sendNewline;
      else if (action === 'commandConfirm') draft.confirm = !draft.confirm;
      else if (action === 'commandClear') {
        draft[draft.field] = '';
        draft.cursor = 0;
      } else {
        const command = commandFromDraft(draft, ctx.commandWorkspaceId);
        if (!command) ctx.commandEditorMessage = 'Enter a name and command';
        else if (!ctx.actions.saveCommand?.(command))
          ctx.commandEditorMessage = 'Could not save on this device';
        else {
          ctx.commandDraft = null;
          ctx.snapshotMenuCommands();
          ctx.clearArmedModifiers();
          ctx.refreshInputRoot('commands');
          return true;
        }
      }
      ctx.clearArmedModifiers();
      ctx.refreshInputRoot('command-editor');
      return true;
    }
    return false;
  },
  handle(action, hit, ctx) {
    if (action !== 'key' || !ctx.commandDraft) return false;
    const modifier = hit.userData.modifier as keyof KeyModifiers | undefined;
    if (modifier) ctx.modifierState.tap(modifier);
    else {
      ctx.commandDraft = editCommandDraft(
        ctx.commandDraft,
        hit.userData.key as string,
        ctx.modifierState.active,
      );
      ctx.consumeArmedModifiers();
    }
    ctx.commandEditorMessage = '';
    ctx.refreshInputRoot('command-editor');
    return true;
  },
};
