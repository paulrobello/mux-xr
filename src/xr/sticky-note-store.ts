const STORAGE_KEY = 'mux-xr:sticky-notes:v1';
const VERSION = 1;

/** Longest note kept; dictation beyond this is cut so a note stays readable at arm's length. */
export const STICKY_NOTE_MAX_CHARS = 280;

/** Matches the widget registry's instance id rule, so a note id is always a valid pose key. */
const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isStickyNoteId(id: unknown): id is string {
  return typeof id === 'string' && NOTE_ID.test(id);
}

export function newStickyNoteId(now = Date.now(), random = Math.random): string {
  return `note-${now.toString(36)}-${Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`;
}

/** Collapses whitespace and caps the length; empty when nothing printable is left. */
export function normalizeStickyNoteText(text: string): string {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length <= STICKY_NOTE_MAX_CHARS
    ? characters.join('')
    : `${characters
        .slice(0, STICKY_NOTE_MAX_CHARS - 1)
        .join('')
        .trimEnd()}…`;
}

/** Note text by id; headset-local, kept beside the widget poses that place each note. */
export type StickyNotes = Record<string, string>;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readNotes(storage: Storage): StickyNotes {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const document = parsed as { version?: unknown; notes?: unknown };
    if (document.version !== VERSION || typeof document.notes !== 'object' || !document.notes)
      return {};
    const notes: StickyNotes = {};
    for (const [id, text] of Object.entries(document.notes)) {
      if (!isStickyNoteId(id) || typeof text !== 'string') continue;
      const normalized = normalizeStickyNoteText(text);
      if (normalized) notes[id] = normalized;
    }
    return notes;
  } catch {
    return {};
  }
}

function writeNotes(storage: Storage, notes: StickyNotes): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, notes }));
    return true;
  } catch {
    return false;
  }
}

export function createStickyNoteStore(storage: Storage | null = defaultStorage()): {
  read(): StickyNotes;
  /** Stores normalized text; false for an invalid id, empty text or a storage failure. */
  save(id: string, text: string): boolean;
  remove(id: string): boolean;
} {
  return {
    read: () => (storage ? readNotes(storage) : {}),
    save(id, text) {
      const normalized = normalizeStickyNoteText(text);
      if (!storage || !isStickyNoteId(id) || !normalized) return false;
      const notes = readNotes(storage);
      notes[id] = normalized;
      return writeNotes(storage, notes);
    },
    remove(id) {
      if (!storage || !isStickyNoteId(id)) return false;
      const notes = readNotes(storage);
      if (!(id in notes)) return true;
      delete notes[id];
      return writeNotes(storage, notes);
    },
  };
}
