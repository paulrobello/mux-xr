import { validateWeatherZip } from '@par/xr-workspace';
import type * as THREE from 'three';
import { actionData, type PanelAction } from '../panel-actions';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const weatherZipPanel: PanelModule = {
  title: () => 'Weather ZIP code',
  onShow(ctx) {
    ctx.weatherZipDraft = ctx.mutableState.weatherZip;
    ctx.weatherZipMessage = '';
    return false;
  },
  closePosition: () => ({ x: 0.22, y: -0.6 }),
  back: () => ({ target: 'world', x: -0.22, y: -0.6 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    const draft = ctx.weatherZipDraft;
    const field = createLabelButton(`ZIP: ${draft}${draft.length < 5 ? '|' : ''}`, 0.76, 0.12, {
      ...actionData({ type: 'noop' }),
    });
    field.name = 'xr-weather-zip-field';
    field.position.y = 0.4;
    setModifierVisual(field, true);
    root.add(field);
    const keys = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['Clear', '0', '⌫'],
    ] as const;
    for (const [row, labels] of keys.entries())
      for (const [column, key] of labels.entries()) {
        const digit = /^\d$/.test(key);
        const button = createLabelButton(
          key,
          0.22,
          0.12,
          actionData({
            type: digit ? 'zipDigit' : key === 'Clear' ? 'zipClear' : 'zipDelete',
            ...(digit ? { zipDigit: key } : {}),
          } as PanelAction),
        );
        button.name = `xr-weather-zip-key-${digit ? key : key === 'Clear' ? 'clear' : 'delete'}`;
        button.position.set((column - 1) * 0.25, 0.24 - row * 0.14, 0);
        root.add(button);
      }
    const save = createLabelButton('Save', 0.36, 0.1, actionData({ type: 'zipSave' }));
    save.name = 'xr-weather-zip-save';
    save.position.set(-0.2, -0.36, 0);
    const unset = createLabelButton('Remove ZIP', 0.36, 0.1, actionData({ type: 'zipUnset' }));
    unset.name = 'xr-weather-zip-unset';
    unset.position.set(0.2, -0.36, 0);
    root.add(save, unset);
    const message = ctx.weatherZipMessage;
    if (message) {
      const note = createLabelButton(message, 0.76, 0.08, actionData({ type: 'noop' }));
      note.name = 'xr-weather-zip-message';
      note.position.y = -0.48;
      root.add(note);
    }
  },
  handleActionEarly(action, _hit, ctx) {
    switch (action.type) {
      case 'zipDigit':
      case 'zipDelete':
      case 'zipClear':
      case 'zipSave':
      case 'zipUnset':
        break;
      default:
        return false;
    }
    ctx.weatherZipMessage = '';
    const draft = ctx.weatherZipDraft;
    if (action.type === 'zipDigit' && draft.length < 5)
      ctx.weatherZipDraft =
        draft +
        String(action.zipDigit ?? '')
          .replace(/\D/g, '')
          .slice(0, 1);
    else if (action.type === 'zipDelete') ctx.weatherZipDraft = draft.slice(0, -1);
    else if (action.type === 'zipClear') ctx.weatherZipDraft = '';
    else if (action.type === 'zipUnset') {
      ctx.setWeatherZip('');
      ctx.showInput('world');
      return true;
    } else if (action.type === 'zipSave') {
      if (!validateWeatherZip(draft)) ctx.weatherZipMessage = 'Enter all five digits';
      else {
        ctx.setWeatherZip(draft);
        ctx.showInput('world');
        return true;
      }
    }
    if (ctx.inputRoot && ctx.inputMode === 'weather-zip') ctx.refreshInputRoot('weather-zip');
    return true;
  },
};
