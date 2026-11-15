import type * as THREE from 'three';
import { validateKeyborbMode } from '../../workspace/keyborb';
import { createLabelButton, setModifierVisual } from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const settingsPanel: PanelModule = {
  title: () => 'Settings',
  subsumes: [
    'settings',
    'display',
    'world',
    'backgrounds',
    'weather-zip',
    'accent',
    'terminal',
    'filtering',
    'buttons',
  ] as const,
  closePosition: () => ({ x: 0, y: -0.89 }),
  build(root: THREE.Group, ctx: SceneContext): void {
    for (const [index, [label, destination]] of (
      [
        ['Display', 'display'],
        ['World', 'world'],
        ['Selected terminal', 'terminal'],
        ['Controller buttons', 'buttons'],
      ] as const
    ).entries()) {
      const button = createLabelButton(label, 1.15, 0.13, {
        inputAction: 'openInput',
        mode: destination,
      });
      button.position.set(0, 0.36 - index * 0.17, 0);
      root.add(button);
    }
    const caption = createLabelButton('Keyborb keyboard', 1.15, 0.1, { inputAction: 'noop' });
    caption.position.y = -0.3;
    root.add(caption);
    for (const [index, keyborbMode] of (['off', 'on', 'auto'] as const).entries()) {
      const button = createLabelButton(
        keyborbMode[0].toUpperCase() + keyborbMode.slice(1),
        0.34,
        0.12,
        { inputAction: 'keyborbMode', keyborbMode },
      );
      button.position.set((index - 1) * 0.4, -0.44, 0);
      setModifierVisual(button, ctx.mutableState.keyborbMode === keyborbMode);
      root.add(button);
    }
    const help = createLabelButton('Auto: Keyborb with hand tracking', 1.6, 0.07, {
      inputAction: 'noop',
    });
    help.position.y = -0.56;
    root.add(help);
    const sounds = createLabelButton(
      `UI sounds: ${ctx.mutableState.uiSounds ? 'on' : 'off'}`,
      0.7,
      0.1,
      { inputAction: 'uiSounds' },
    );
    sounds.position.y = -0.71;
    setModifierVisual(sounds, ctx.mutableState.uiSounds);
    root.add(sounds);
  },
  handleEarly(action, hit, ctx) {
    if (action === 'keyborbMode') {
      ctx.setKeyborbMode(validateKeyborbMode(hit.userData.keyborbMode));
      return true;
    }
    if (action === 'uiSounds') {
      ctx.setUISounds(!ctx.mutableState.uiSounds);
      return true;
    }
    return false;
  },
};
