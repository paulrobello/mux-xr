import { describe, expect, it, vi } from 'vitest';
import type { QuickCommand, QuickCommandEntry } from '../src/contracts';
import {
  executeQuickCommand,
  isCommand,
  orderQuickCommands,
  parseCommandFile,
  previewCommandText,
  quickStripCommands,
  splitTemplate,
  toSharedCommands,
} from '../src/quick-commands';

const command = (text: string, sendNewline = true): QuickCommand => ({
  id: 'id',
  label: 'Label',
  text,
  sendNewline,
});

const fakeSurface = (withPaste = true) => ({
  sendText: vi.fn(() => true),
  sendKey: vi.fn(() => true),
  ...(withPaste ? { paste: vi.fn(() => true) } : {}),
});

describe('quick command validation', () => {
  it('accepts optional confirm and pinned flags and rejects non-boolean values', () => {
    expect(isCommand(command('ls'))).toBe(true);
    expect(isCommand({ ...command('ls'), confirm: true, pinned: false })).toBe(true);
    expect(isCommand({ ...command('ls'), confirm: 'yes' })).toBe(false);
    expect(isCommand({ ...command('ls'), pinned: 1 })).toBe(false);
  });

  it('rejects an empty id or empty text', () => {
    expect(isCommand({ ...command('ls'), id: '' })).toBe(false);
    expect(isCommand({ ...command('ls'), id: '  ' })).toBe(false);
    expect(isCommand(command(''))).toBe(false);
    expect(isCommand(command(' '))).toBe(true);
  });

  it('keeps only the first command for a repeated id when parsing a file', () => {
    const parsed = parseCommandFile({
      version: 1,
      commands: [
        { ...command('first'), id: 'x' },
        { ...command('second'), id: 'x', confirm: true },
        { ...command('blank'), id: '' },
      ],
    });
    expect(parsed?.commands).toEqual([{ ...command('first'), id: 'x' }]);
    expect(parsed?.skipped).toBe(2);
  });

  it('dedupes shared ids after prefixing and drops shared pins', () => {
    const shared = toSharedCommands([
      { ...command('plain'), id: 'x', pinned: true },
      { ...command('prefixed'), id: 'shared:x' },
      { ...command('other'), id: 'y', confirm: true },
    ]);
    expect(shared).toEqual([
      { ...command('plain'), id: 'shared:x' },
      { ...command('other'), id: 'shared:y', confirm: true },
    ]);
  });
});

describe('quick command reachability', () => {
  const entry = (id: string, extra: Partial<QuickCommandEntry> = {}): QuickCommandEntry => ({
    ...command(`echo ${id}`),
    id,
    ...extra,
  });

  it('orders pinned first, then most recently run, then saved order', () => {
    const ordered = orderQuickCommands([
      entry('a'),
      entry('b', { lastRunAt: 10, runCount: 1 }),
      entry('c', { pinned: true }),
      entry('d', { lastRunAt: 20, runCount: 5 }),
      entry('e'),
      entry('f', { pinned: true, lastRunAt: 5, runCount: 1 }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['f', 'c', 'd', 'b', 'a', 'e']);
  });

  it('fills the quick strip with up to four pinned commands', () => {
    const strip = quickStripCommands(
      ['a', 'b', 'c', 'd', 'e'].map((id) => entry(id, { pinned: true })).concat(entry('x')),
    );
    expect(strip.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to the four most used commands when none are pinned', () => {
    const strip = quickStripCommands([
      entry('never'),
      entry('once', { runCount: 1, lastRunAt: 50 }),
      entry('often', { runCount: 9, lastRunAt: 1 }),
      entry('twice', { runCount: 2, lastRunAt: 2 }),
      entry('thrice', { runCount: 3, lastRunAt: 3 }),
      entry('tie', { runCount: 2, lastRunAt: 4 }),
    ]);
    expect(strip.map((item) => item.id)).toEqual(['often', 'thrice', 'tie', 'twice']);
    expect(quickStripCommands([entry('never')])).toEqual([]);
  });
});

describe('quick command execution', () => {
  it('sends single-line commands as text followed by Enter', () => {
    const surface = fakeSurface();
    expect(executeQuickCommand(surface, command('ls -la'))).toBe('sent');
    expect(surface.sendText).toHaveBeenCalledWith('ls -la');
    expect(surface.paste).not.toHaveBeenCalled();
    expect(surface.sendKey).toHaveBeenCalledWith('Enter');
  });

  it('pastes multi-line commands, then sends Enter only when enabled', () => {
    const surface = fakeSurface();
    expect(executeQuickCommand(surface, command('cd /tmp\nls'))).toBe('sent');
    expect(surface.paste).toHaveBeenCalledWith('cd /tmp\nls');
    expect(surface.sendText).not.toHaveBeenCalled();
    expect(surface.sendKey).toHaveBeenCalledWith('Enter');
    const quiet = fakeSurface();
    expect(executeQuickCommand(quiet, command('a\r\nb', false))).toBe('sent');
    expect(quiet.paste).toHaveBeenCalledWith('a\r\nb');
    expect(quiet.sendKey).not.toHaveBeenCalled();
  });

  it('falls back to sendText for multi-line commands when the surface cannot paste', () => {
    const surface = fakeSurface(false);
    expect(executeQuickCommand(surface, command('one\ntwo'))).toBe('sent');
    expect(surface.sendText).toHaveBeenCalledWith('one\ntwo');
  });

  it('sends only the text before a {{}} placeholder and never Enter', () => {
    expect(splitTemplate('git commit -m "{{}}"')).toEqual({
      prefix: 'git commit -m "',
      suffix: '"',
    });
    expect(splitTemplate('ls')).toBeNull();
    const surface = fakeSurface();
    expect(executeQuickCommand(surface, command('git commit -m "{{}}"'))).toBe('template');
    expect(surface.sendText).toHaveBeenCalledWith('git commit -m "');
    expect(surface.sendKey).not.toHaveBeenCalled();
    const empty = fakeSurface();
    expect(executeQuickCommand(empty, command('{{}} --help'))).toBe('template');
    expect(empty.sendText).not.toHaveBeenCalled();
    const noEnter = fakeSurface();
    expect(executeQuickCommand(noEnter, command('make', false))).toBe('sent');
    expect(noEnter.sendText).toHaveBeenCalledWith('make');
    expect(noEnter.sendKey).not.toHaveBeenCalled();
  });

  it('previews command text with visible control characters and a length limit', () => {
    expect(previewCommandText('echo\u001b[A\r\nls\tx\u0003\u007f')).toBe('echo␛[A⏎ls⇥x␃␡');
    expect(previewCommandText('a\rb\nc')).toBe('a⏎b⏎c');
    const long = previewCommandText('x'.repeat(200));
    expect([...long]).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
    expect(previewCommandText('x'.repeat(120))).toBe('x'.repeat(120));
  });

  it('runs commands containing a plain {} unchanged', () => {
    for (const text of ['find . -name "*.tmp" -exec rm {} +', 'xargs -I{} echo {}', "awk '{}'"]) {
      expect(splitTemplate(text)).toBeNull();
      const surface = fakeSurface();
      expect(executeQuickCommand(surface, command(text))).toBe('sent');
      expect(surface.sendText).toHaveBeenCalledWith(text);
      expect(surface.sendKey).toHaveBeenCalledWith('Enter');
    }
  });

  it('reports an unavailable target and a lost Enter', () => {
    expect(executeQuickCommand(undefined, command('ls'))).toBe('unavailable');
    const offline = { ...fakeSurface(), sendText: vi.fn(() => false) };
    expect(executeQuickCommand(offline, command('ls'))).toBe('unavailable');
    expect(offline.sendKey).not.toHaveBeenCalled();
    const dropped = { ...fakeSurface(), sendKey: vi.fn(() => false) };
    expect(executeQuickCommand(dropped, command('ls'))).toBe('enter-failed');
  });
});
