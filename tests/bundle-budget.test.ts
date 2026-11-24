import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type BundleBudget, classifyChunk, evaluateBudget } from '../scripts/bundle-budget';

const BUDGET: BundleBudget = {
  entry: 770000,
  lazyChunkMax: 110000,
  vendor: { 'vendor-three': 740000, 'vendor-xterm': 370000, 'vendor-troika': 140000 },
  total: 2210000,
};

const VENDOR_KEYS = Object.keys(BUDGET.vendor);

describe('chunk classifier', () => {
  it('separates entry, vendor and lazy chunks', () => {
    expect(classifyChunk('index-CmQ1PEpq.js', VENDOR_KEYS)).toBe('entry');
    expect(classifyChunk('vendor-three-B-WdS-17.js', VENDOR_KEYS)).toBe('vendor');
    expect(classifyChunk('vendor-xterm-D19GWk_S.js', VENDOR_KEYS)).toBe('vendor');
    expect(classifyChunk('koi-garden-fALW6Gtd.js', VENDOR_KEYS)).toBe('lazy');
    expect(classifyChunk('heif-worker-a8Z3aTHZ.js', VENDOR_KEYS)).toBe('lazy');
  });

  it('treats an unknown vendor chunk as lazy', () => {
    expect(classifyChunk('vendor-foo-abc.js', VENDOR_KEYS)).toBe('lazy');
  });

  it('only classifies .js files', () => {
    expect(classifyChunk('index-CmQ1PEpq.js.map', VENDOR_KEYS)).toBe('lazy');
    expect(classifyChunk('index.js', VENDOR_KEYS)).toBe('lazy');
  });
});

describe('budget evaluation', () => {
  it('passes a file list within limits', () => {
    const files = [
      { name: 'index-CmQ1PEpq.js', bytes: 698540 },
      { name: 'vendor-three-B-WdS-17.js', bytes: 669224 },
      { name: 'vendor-xterm-D19GWk_S.js', bytes: 330972 },
      { name: 'vendor-troika-CvlNtfAL.js', bytes: 122454 },
      { name: 'heif-worker-a8Z3aTHZ.js', bytes: 91739 },
      { name: 'koi-garden-fALW6Gtd.js', bytes: 22018 },
    ];
    const result = evaluateBudget(files, BUDGET);
    expect(result.ok).toBe(true);
    expect(result.totalBytes).toBe(1934947);
  });

  it('fails when the entry chunk is over and names chunk, file, size and limit', () => {
    const files = [
      { name: 'index-OverTheLimit.js', bytes: BUDGET.entry + 1 },
      { name: 'vendor-three-ok.js', bytes: 1000 },
      { name: 'koi-garden-ok.js', bytes: 1000 },
    ];
    const result = evaluateBudget(files, BUDGET);
    expect(result.ok).toBe(false);
    const entry = result.rows.find((row) => row.chunk === 'entry');
    expect(entry?.status).toBe('over');
    expect(entry?.file).toBe('index-OverTheLimit.js');
    expect(entry?.bytes).toBe(BUDGET.entry + 1);
    expect(entry?.limit).toBe(BUDGET.entry);
  });

  it('fails on the largest lazy chunk over lazyChunkMax', () => {
    const files = [
      { name: 'index-ok.js', bytes: 1000 },
      { name: 'vendor-three-ok.js', bytes: 1000 },
      { name: 'koi-garden-small.js', bytes: 22018 },
      { name: 'heif-worker-big.js', bytes: BUDGET.lazyChunkMax + 1 },
    ];
    const result = evaluateBudget(files, BUDGET);
    expect(result.ok).toBe(false);
    const lazy = result.rows.find((row) => row.chunk === 'lazy');
    expect(lazy?.status).toBe('over');
    expect(lazy?.file).toBe('heif-worker-big.js');
    expect(lazy?.bytes).toBe(BUDGET.lazyChunkMax + 1);
  });

  it('bounds an unknown vendor chunk through the lazy limit', () => {
    const files = [
      { name: 'index-ok.js', bytes: 1000 },
      { name: 'vendor-newlib-abc.js', bytes: BUDGET.lazyChunkMax + 1 },
      { name: 'koi-garden-ok.js', bytes: 1000 },
    ];
    const result = evaluateBudget(files, BUDGET);
    expect(result.ok).toBe(false);
    const lazy = result.rows.find((row) => row.chunk === 'lazy');
    expect(lazy?.file).toBe('vendor-newlib-abc.js');
  });

  it('fails when the total exceeds budget', () => {
    const budget = { ...BUDGET, total: 300000 };
    const files = [
      { name: 'index-ok.js', bytes: 1000 },
      { name: 'koi-garden-a.js', bytes: 100000 },
      { name: 'koi-garden-b.js', bytes: 100000 },
      { name: 'koi-garden-c.js', bytes: 100000 },
    ];
    const result = evaluateBudget(files, budget);
    const total = result.rows.find((row) => row.chunk === 'total');
    expect(total?.status).toBe('over');
    expect(result.ok).toBe(false);
  });

  it('fails on an empty file list', () => {
    expect(evaluateBudget([], BUDGET).ok).toBe(false);
  });

  it('fails when the entry or a budgeted vendor chunk is missing', () => {
    const result = evaluateBudget([{ name: 'koi-garden-ok.js', bytes: 1000 }], BUDGET);
    expect(result.ok).toBe(false);
    const entry = result.rows.find((row) => row.chunk === 'entry');
    expect(entry?.status).toBe('missing');
    const troika = result.rows.find((row) => row.chunk === 'vendor-troika');
    expect(troika?.status).toBe('missing');
  });

  it('loads the checked-in budget file at the repo root', () => {
    const budget = JSON.parse(readFileSync('bundle-budget.json', 'utf8')) as BundleBudget;
    expect(budget.entry).toBeGreaterThan(0);
    expect(budget.lazyChunkMax).toBeGreaterThan(0);
    expect(Object.keys(budget.vendor).length).toBeGreaterThan(0);
    for (const [key, limit] of Object.entries(budget.vendor)) {
      expect(key.startsWith('vendor-')).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
    expect(budget.total).toBeGreaterThan(0);
  });
});
