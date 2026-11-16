import { previewCommandText } from './quick-commands';
import { sanitizePasteContent } from './terminal/protocol';

/** When a paste asks for a second press before it reaches the terminal. */
export type PasteReviewMode = 'always' | 'multiline' | 'off';

export const PASTE_REVIEW_MODES: readonly PasteReviewMode[] = ['always', 'multiline', 'off'];

export function validatePasteReviewMode(value: unknown): PasteReviewMode {
  return PASTE_REVIEW_MODES.includes(value as PasteReviewMode)
    ? (value as PasteReviewMode)
    : 'multiline';
}

/** What a paste would send, and whether it needs a confirming press. */
export interface PasteSummary {
  /** The sanitized text a confirming press sends; what the user reviewed. */
  text: string;
  /** LF-separated lines after CRLF normalization, ignoring one trailing newline. */
  lines: number;
  /** Code points of the sanitized text. */
  characters: number;
  /** Control characters `sanitizePasteContent` stripped from the raw clipboard text. */
  removed: number;
  /** The first line, control characters shown as symbols, for the prompt. */
  preview: string;
  needsReview: boolean;
}

/** Paste prompts show one preview line, matching the XR quick-command preview budget. */
export const XR_PASTE_PREVIEW_LENGTH = 60;

/** Classifies clipboard text for the paste review prompt. Pure; no clipboard or scene access. */
export function summarizePaste(raw: string, mode: PasteReviewMode): PasteSummary {
  const text = sanitizePasteContent(raw);
  const removed = raw.length - text.length;
  const normalized = text.replace(/\r\n/g, '\n');
  const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  const lines = withoutTrailingNewline === '' ? 1 : withoutTrailingNewline.split('\n').length;
  const preview = previewCommandText(normalized.split('\n', 1)[0] ?? '', XR_PASTE_PREVIEW_LENGTH);
  const needsReview = mode === 'always' || (mode === 'multiline' && (lines > 1 || removed > 0));
  return { text, lines, characters: [...text].length, removed, preview, needsReview };
}
