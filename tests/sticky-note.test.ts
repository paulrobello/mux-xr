import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import {
  createStickyNoteWidget,
  STICKY_NOTE_CONFIRM_MS,
  STICKY_NOTE_HEIGHT,
  STICKY_NOTE_WIDTH,
  stickyNotePages,
  stickyNoteSpawnOffset,
} from '../src/xr/sticky-note';
import {
  createStickyNoteStore,
  isStickyNoteId,
  newStickyNoteId,
  normalizeStickyNoteText,
} from '../src/xr/sticky-note-store';
import { widgetKey, widgetKeyKind } from '../src/xr/widget-registry';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe('sticky note store', () => {
  it('mints ids that are valid sticky-note pose keys', () => {
    const id = newStickyNoteId(1_700_000_000_000, () => 0.5);
    expect(isStickyNoteId(id)).toBe(true);
    expect(widgetKeyKind(widgetKey('sticky-note', id))).toBe('sticky-note');
    expect(isStickyNoteId('bad id')).toBe(false);
  });

  it('keeps and pages through the complete transcript, including long words', () => {
    expect(normalizeStickyNoteText('  a \n  b  ')).toBe('a b');
    const full = `Start ${'x'.repeat(340)} finish`;
    const store = createStickyNoteStore(memoryStorage());
    expect(store.save('note-long', full)).toBe(true);
    expect(store.read()['note-long']).toBe(full);
    const pages = stickyNotePages(store.read()['note-long']);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.join('').replace(/\s/g, '')).toBe(full.replace(/\s/g, ''));
    expect(pages.every((page) => page.split('\n').length <= 5)).toBe(true);
  });

  it('saves, reads and removes notes, refusing empty text and bad ids', () => {
    const store = createStickyNoteStore(memoryStorage());
    expect(store.save('note-a', ' Buy  milk ')).toBe(true);
    expect(store.save('note-b', '   ')).toBe(false);
    expect(store.save('bad id', 'x')).toBe(false);
    expect(store.read()).toEqual({ 'note-a': 'Buy milk' });
    expect(store.remove('note-a')).toBe(true);
    expect(store.read()).toEqual({});
    expect(store.remove('note-missing')).toBe(true);
  });

  it('drops malformed documents and entries on read', () => {
    const bad = createStickyNoteStore(memoryStorage({ 'mux-xr:sticky-notes:v1': '{' }));
    expect(bad.read()).toEqual({});
    const mixed = createStickyNoteStore(
      memoryStorage({
        'mux-xr:sticky-notes:v1': JSON.stringify({
          version: 1,
          notes: { 'note-a': 'ok', 'bad id': 'x', 'note-b': 42, 'note-c': '  ' },
        }),
      }),
    );
    expect(mixed.read()).toEqual({ 'note-a': 'ok' });
    expect(createStickyNoteStore(null).save('note-a', 'x')).toBe(false);
  });

  it('reports a storage write failure', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    expect(createStickyNoteStore(storage).save('note-a', 'x')).toBe(false);
  });
});

describe('sticky note widget', () => {
  it('shows its text and keeps the corner button flush in the top-right corner', () => {
    const widget = createStickyNoteWidget(null, { id: 'note-a', text: 'Hello' });
    expect(widget.root.userData.noteId).toBe('note-a');
    expect(widget.root.getObjectByName('sticky-note-text')?.userData.labelText).toBe('Hello');
    const close = widget.root.getObjectByName('sticky-note-close') as THREE.Mesh;
    const { width } = (close.geometry as THREE.PlaneGeometry).parameters;
    expect(close.position.x + width / 2).toBeCloseTo(STICKY_NOTE_WIDTH / 2, 6);
    expect(close.position.y + width / 2).toBeCloseTo(STICKY_NOTE_HEIGHT / 2, 6);
    widget.dispose();
  });

  it('arms Delete on the first press and disarms after the confirm window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const widget = createStickyNoteWidget(null, { id: 'note-a', text: 'Hello' });
      const close = widget.root.getObjectByName('sticky-note-close') as THREE.Object3D;
      const confirm = widget.root.getObjectByName('sticky-note-confirm') as THREE.Object3D;
      expect(close.userData.inputAction).toBe('widgetControl');
      expect(confirm.userData.inputAction).toBe('closeWidget');
      expect(confirm.visible).toBe(false);
      widget.activate?.(close);
      expect(confirm.visible).toBe(true);
      expect(close.visible).toBe(false);
      widget.update(10_000 + STICKY_NOTE_CONFIRM_MS - 1);
      expect(confirm.visible).toBe(true);
      widget.update(10_000 + STICKY_NOTE_CONFIRM_MS);
      expect(confirm.visible).toBe(false);
      expect(close.visible).toBe(true);
      widget.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('steps later notes nearer and toward the centre, wrapping after six', () => {
    const base = [1.45, 0.7, -1.1] as const;
    expect(stickyNoteSpawnOffset(base, 0)).toEqual([1.45, 0.7, -1.1]);
    const [x, y, z] = stickyNoteSpawnOffset(base, 1);
    expect(Math.abs(x)).toBeLessThan(Math.abs(base[0]));
    expect(y).toBeLessThan(base[1]);
    expect(z).toBeGreaterThan(base[2]);
    expect(stickyNoteSpawnOffset(base, 6)).toEqual(stickyNoteSpawnOffset(base, 0));
  });
});
