import { resolveAccentCss } from '@par/xr-workspace';
import type * as THREE from 'three';
import { createCommandDraft } from '../command-editor';
import {
  ARMED_STYLE,
  COMMAND_TOOL_HINTS,
  COMMAND_TOOLS,
  type CommandTool,
  createLabelButton,
  PINNED_BORDER,
  setModifierVisual,
} from '../panel-ui';
import type { PanelModule, SceneContext } from '../scene-context';

export const commandsPanel: PanelModule = {
  title: (ctx) =>
    `Quick commands · ${
      ctx.mutableState.inputTargetTitle
        ? `Target: ${ctx.mutableState.inputTargetTitle}`
        : 'No target selected'
    }`,
  build(root: THREE.Group, ctx: SceneContext): void {
    const add = createLabelButton('New command', 0.5, 0.09, { inputAction: 'newCommand' });
    add.position.set(0, 0.7, 0);
    root.add(add);
    const commandStart = ctx.commandPage * 8;
    ctx.menuCommands.slice(commandStart, commandStart + 8).forEach((command, index) => {
      const button = createLabelButton(ctx.commandButtonLabel(command, 'command'), 0.7, 0.11, {
        inputAction: 'command',
        commandId: command.id,
        ...(command.pinned
          ? {
              pinned: true,
              labelBorder: resolveAccentCss(ctx.mutableState.accentColor, PINNED_BORDER),
            }
          : {}),
        ...(ctx.isArmed(command.id, 'command') ? ARMED_STYLE : {}),
      });
      const row = Math.floor(index / 2);
      button.position.set(index % 2 ? 0.4 : -0.4, 0.4 - row * 0.14, 0);
      root.add(button);
    });
    if (ctx.menuCommands.length > 8) {
      const page = createLabelButton(
        `Commands ${commandStart + 1}-${Math.min(commandStart + 8, ctx.menuCommands.length)} · Next`,
        0.7,
        0.1,
        { inputAction: 'commandPage' },
      );
      page.position.set(0, -0.45, 0);
      root.add(page);
    }
    COMMAND_TOOLS.forEach(([tool, label], index) => {
      const button = createLabelButton(label, 0.36, 0.09, { inputAction: 'commandTool', tool });
      button.position.set((index - (COMMAND_TOOLS.length - 1) / 2) * 0.4, -0.22, 0);
      setModifierVisual(button, ctx.commandTool === tool);
      root.add(button);
    });
    const preview = ctx.armedPreview('command');
    const message = preview ?? (ctx.commandsMessage || COMMAND_TOOL_HINTS[ctx.commandTool]);
    if (message) {
      const status = createLabelButton(message, 1.1, 0.08, { inputAction: 'noop' });
      status.name = preview ? 'xr-command-preview' : 'xr-commands-message';
      status.position.set(0, -0.33, 0);
      root.add(status);
    }
  },
  handleEarly(action, _hit, ctx) {
    if (action === 'newCommand') {
      ctx.commandDraft = createCommandDraft(crypto.randomUUID());
      ctx.commandWorkspaceId = ctx.availablePanes.find(
        (pane) => pane.id === ctx.mutableState.inputTargetId,
      )?.workspaceId;
      ctx.commandEditorMessage = '';
      ctx.clearArmedModifiers();
      ctx.refreshInputRoot('command-editor');
      return true;
    }
    return false;
  },
  handle(action, hit, ctx) {
    if (action === 'commandPage') {
      ctx.commandPage = (ctx.commandPage + 1) % Math.max(1, Math.ceil(ctx.menuCommands.length / 8));
      ctx.refreshInputRoot(ctx.inputMode);
      return true;
    }
    if (action === 'commandTool') {
      const tool = hit.userData.tool as CommandTool;
      ctx.commandTool = ctx.commandTool === tool ? 'run' : tool;
      ctx.commandsMessage = '';
      ctx.refreshInputRoot('commands');
      return true;
    }
    if (action === 'command' && ctx.commandTool !== 'run') {
      const command = ctx.menuCommands.find((item) => item.id === hit.userData.commandId);
      if (command) ctx.manageCommand(command, action);
      return true;
    }
    return false;
  },
};
