import type { KeyModifiers, QuickCommand } from '../contracts';
import { terminalKeyLabel } from '../terminal/protocol';

export interface CommandDraft {
  id: string;
  label: string;
  text: string;
  sendNewline: boolean;
  scope: 'global' | 'workspace';
  field: 'label' | 'text';
  cursor: number;
}

export const createCommandDraft = (id: string): CommandDraft => ({
  id,
  label: '',
  text: '',
  sendNewline: true,
  scope: 'global',
  field: 'label',
  cursor: 0,
});

const copyDraft = (draft: CommandDraft, value: Partial<CommandDraft>): CommandDraft => ({
  ...draft,
  ...value,
});

export const editCommandDraft = (
  draft: CommandDraft,
  key: string,
  modifiers: KeyModifiers = {},
): CommandDraft => {
  if (modifiers.ctrl || modifiers.alt) return copyDraft(draft, {});
  const value = draft[draft.field];
  const codePoints = Array.from(value);
  const cursor = Math.max(0, Math.min(codePoints.length, draft.cursor));
  if (key === 'ArrowLeft') return copyDraft(draft, { cursor: Math.max(0, cursor - 1) });
  if (key === 'ArrowRight')
    return copyDraft(draft, { cursor: Math.min(codePoints.length, cursor + 1) });
  if (key === 'Home') return copyDraft(draft, { cursor: 0 });
  if (key === 'End') return copyDraft(draft, { cursor: codePoints.length });
  if (key === 'Backspace') {
    if (cursor === 0) return copyDraft(draft, { cursor });
    codePoints.splice(cursor - 1, 1);
    return copyDraft(draft, { [draft.field]: codePoints.join(''), cursor: cursor - 1 });
  }
  if (key === 'Delete') {
    if (cursor === codePoints.length) return copyDraft(draft, { cursor });
    codePoints.splice(cursor, 1);
    return copyDraft(draft, { [draft.field]: codePoints.join(''), cursor });
  }
  if (draft.field === 'label' && key === 'Enter') return copyDraft(draft, { cursor });
  const inserted =
    key === 'Space'
      ? ' '
      : key === 'Tab'
        ? '\t'
        : key === 'Enter'
          ? '\n'
          : key.length > 0
            ? terminalKeyLabel(key, Boolean(modifiers.shift))
            : '';
  if (!inserted || (key.length > 1 && !['Space', 'Tab', 'Enter'].includes(key)))
    return copyDraft(draft, { cursor });
  codePoints.splice(cursor, 0, ...Array.from(inserted));
  return copyDraft(draft, {
    [draft.field]: codePoints.join(''),
    cursor: cursor + Array.from(inserted).length,
  });
};

export const commandFromDraft = (
  draft: CommandDraft,
  workspaceId?: string,
): QuickCommand | null => {
  if (!draft.label.trim() || !draft.text.trim()) return null;
  if (draft.scope === 'workspace' && !workspaceId) return null;
  return {
    id: draft.id,
    label: draft.label,
    text: draft.text,
    sendNewline: draft.sendNewline,
    ...(draft.scope === 'workspace' ? { workspaceId } : {}),
  };
};
