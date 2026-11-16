import { describe, expect, it } from 'vitest';
import { PASTE_REVIEW_MODES, summarizePaste, validatePasteReviewMode } from '../src/paste-review';

describe('summarizePaste line counting', () => {
  it('needs no review for a single line with the default multiline mode', () => {
    const summary = summarizePaste('ls -la', 'multiline');
    expect(summary.lines).toBe(1);
    expect(summary.characters).toBe(6);
    expect(summary.removed).toBe(0);
    expect(summary.needsReview).toBe(false);
  });

  it('asks for review when the text spans two lines', () => {
    const summary = summarizePaste('line1\nline2', 'multiline');
    expect(summary.lines).toBe(2);
    expect(summary.needsReview).toBe(true);
  });

  it('counts a CRLF pair as one break', () => {
    expect(summarizePaste('line1\r\nline2', 'multiline').lines).toBe(2);
    expect(summarizePaste('a\r\nb\r\nc', 'multiline').lines).toBe(3);
  });

  it('does not count one trailing newline as an extra line', () => {
    const summary = summarizePaste('single\n', 'multiline');
    expect(summary.lines).toBe(1);
    expect(summary.needsReview).toBe(false);
    expect(summarizePaste('two\r\nlines\r\n', 'multiline').lines).toBe(2);
  });

  it('counts one line for empty text', () => {
    expect(summarizePaste('', 'multiline').lines).toBe(1);
  });
});

describe('summarizePaste removed control characters', () => {
  it('asks for review when an ESC was removed and reports it', () => {
    const summary = summarizePaste('a\u001bb', 'multiline');
    expect(summary.removed).toBe(1);
    expect(summary.text).toBe('ab');
    expect(summary.needsReview).toBe(true);
  });

  it('keeps tab, LF and CR so those never trigger review alone', () => {
    const summary = summarizePaste('a\tb', 'multiline');
    expect(summary.removed).toBe(0);
    expect(summary.text).toBe('a\tb');
    expect(summary.needsReview).toBe(false);
  });
});

describe('summarizePaste modes', () => {
  it('never asks for review with off', () => {
    expect(summarizePaste('a\nb\u0000c', 'off').needsReview).toBe(false);
    expect(summarizePaste('a\nb', 'off').needsReview).toBe(false);
  });

  it('always asks for review with always', () => {
    expect(summarizePaste('single', 'always').needsReview).toBe(true);
    expect(summarizePaste('a\nb', 'always').needsReview).toBe(true);
    expect(summarizePaste('', 'always').needsReview).toBe(true);
  });
});

describe('summarizePaste preview', () => {
  it('previews the first line only', () => {
    expect(summarizePaste('head\ntail', 'multiline').preview).toBe('head');
  });

  it('previews the sanitized text, without removed control characters', () => {
    expect(summarizePaste('\u001b[31mred', 'multiline').preview).toBe('[31mred');
  });

  it('truncates a long first line to the preview budget', () => {
    expect(summarizePaste('x'.repeat(80), 'multiline').preview.length).toBeLessThanOrEqual(61);
  });
});

describe('validatePasteReviewMode', () => {
  it('accepts the three modes and falls back to multiline', () => {
    for (const mode of PASTE_REVIEW_MODES) expect(validatePasteReviewMode(mode)).toBe(mode);
    expect(validatePasteReviewMode('sometimes')).toBe('multiline');
    expect(validatePasteReviewMode(undefined)).toBe('multiline');
  });
});
