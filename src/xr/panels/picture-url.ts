import type { KeyboardModifier } from '@par/xr-workspace';
import type * as THREE from 'three';
import { createCommandDraft, editCommandDraft } from '../command-editor';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const pictureUrlPanel: PanelModule = {
  title: () => 'Picture URL',
  titleY: 0.88,
  closePosition: () => ({ x: 1, y: 1.04 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const value = Array.from(ctx.pictureUrl.text);
    const cursor = Math.min(ctx.pictureUrl.cursor, value.length);
    value.splice(cursor, 0, '|');
    const start = Math.max(0, cursor - 40);
    const field = createLabelButton(
      `URL: ${start ? '…' : ''}${value.slice(start, start + 64).join('')}`,
      1.5,
      0.12,
      { inputAction: 'noop', wrap: true },
    );
    field.name = 'xr-picture-url-field';
    field.position.y = 0.7;
    setModifierVisual(field, true);
    root.add(field);
    // Every action sits in one row above the field, so the panel ends at the keyboard's last
    // row and never reaches down over the HUD bar.
    for (const [label, inputAction, x] of [
      ['Paste', 'pasteClipboard', -1],
      ['Paste host', 'pasteHostClipboard', -0.6],
      [ctx.pictureBusy ? 'Loading…' : 'Load', ctx.pictureBusy ? 'noop' : 'pictureUrlLoad', -0.2],
      ['Clear', 'pictureUrlClear', 0.2],
      ['Recent', 'pictureRecent', 0.6],
    ] as const) {
      const button = createLabelButton(label, 0.36, 0.12, { inputAction });
      button.position.set(x, 1.04, 0);
      root.add(button);
    }
  },
  handleEarly(action, _hit, ctx) {
    if (action === 'pictureUrlLoad') {
      ctx.submitPictureUrl();
      return true;
    }
    if (action === 'pictureUrlClear') {
      ctx.pictureUrl = { text: '', cursor: 0 };
      ctx.picturePanelMessage = '';
      ctx.refreshInputRoot('picture-url');
      return true;
    }
    return false;
  },
  handle(action, hit, ctx) {
    if (action !== 'key') return false;
    const key = String(hit.userData.key);
    const modifier = hit.userData.modifier as KeyboardModifier | undefined;
    if (modifier) ctx.modifierState.tap(modifier);
    else if (key === 'Enter') {
      ctx.submitPictureUrl();
      return true;
    } else if (key === 'Escape') {
      ctx.hideInput();
      return true;
    } else {
      const draft = editCommandDraft(
        {
          ...createCommandDraft('picture-url'),
          label: ctx.pictureUrl.text,
          cursor: ctx.pictureUrl.cursor,
        },
        key,
        ctx.modifierState.active,
      );
      ctx.pictureUrl = { text: draft.label, cursor: draft.cursor };
      ctx.consumeArmedModifiers();
    }
    ctx.picturePanelMessage = '';
    ctx.refreshInputRoot('picture-url');
    return true;
  },
};
