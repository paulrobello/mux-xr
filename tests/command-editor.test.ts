import { describe, expect, it } from 'vitest';
import {
  type CommandDraft,
  commandFromDraft,
  createCommandDraft,
  editCommandDraft,
} from '../src/xr/command-editor';

const textDraft = (text: string, cursor = Array.from(text).length): CommandDraft => ({
  ...createCommandDraft('id'),
  text,
  field: 'text',
  cursor,
});

describe('XR command editor', () => {
  it('edits shifted punctuation literally and tracks a Unicode code-point cursor', () => {
    const shifted = editCommandDraft(textDraft(''), '4', { shift: true });
    expect(shifted.text).toBe('$');
    const draft = editCommandDraft(textDraft('a😀b', 2), 'Backspace');
    expect(draft.text).toBe('ab');
    expect(draft.cursor).toBe(1);
  });

  it('supports cursor movement, deletion, spaces, tabs, and text newlines', () => {
    let draft = textDraft('ab', 1);
    draft = editCommandDraft(draft, 'ArrowRight');
    draft = editCommandDraft(draft, 'Space');
    draft = editCommandDraft(draft, 'Tab');
    draft = editCommandDraft(draft, 'Enter');
    expect(draft.text).toBe('ab \t\n');
    draft = editCommandDraft(draft, 'Home');
    draft = editCommandDraft(draft, 'Delete');
    expect(draft.text).toBe('b \t\n');
  });

  it('ignores control and alt input without mutating the caller', () => {
    const original = textDraft('run');
    const changed = editCommandDraft(original, 'c', { ctrl: true });
    expect(changed).toEqual(original);
    expect(changed).not.toBe(original);
    expect(editCommandDraft(original, 'x', { alt: true }).text).toBe('run');
  });

  it('validates command fields and applies global or workspace scope', () => {
    const draft = {
      ...createCommandDraft('id'),
      label: ' Build ',
      text: ' make all ',
      sendNewline: false,
    };
    expect(commandFromDraft(draft)).toEqual({
      id: 'id',
      label: ' Build ',
      text: ' make all ',
      sendNewline: false,
    });
    expect(commandFromDraft({ ...draft, scope: 'workspace' })).toBeNull();
    expect(commandFromDraft({ ...draft, scope: 'workspace' }, 'w')).toMatchObject({
      workspaceId: 'w',
    });
    expect(commandFromDraft({ ...draft, label: '   ' })).toBeNull();
    expect(commandFromDraft({ ...draft, text: '\n\t' })).toBeNull();
  });
});
