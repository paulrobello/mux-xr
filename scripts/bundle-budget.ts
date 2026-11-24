import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BundleBudget {
  entry: number;
  lazyChunkMax: number;
  vendor: Record<string, number>;
  total: number;
}

export interface BudgetRow {
  chunk: string;
  file: string;
  bytes: number;
  limit: number;
  status: 'ok' | 'over' | 'missing';
}

export interface BudgetResult {
  rows: BudgetRow[];
  ok: boolean;
  totalBytes: number;
}

export type ChunkKind = 'entry' | 'vendor' | 'lazy';

const JS_PATTERN = /\.js$/;

export function classifyChunk(fileName: string, vendorKeys: readonly string[]): ChunkKind {
  if (/^index-[^/]+\.js$/.test(fileName)) return 'entry';
  const sorted = [...vendorKeys].sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (fileName.startsWith(`${key}-`) && JS_PATTERN.test(fileName)) return 'vendor';
  }
  return 'lazy';
}

interface FileSize {
  name: string;
  bytes: number;
}

function pickLargest(files: readonly FileSize[]): FileSize | undefined {
  return files.reduce<FileSize | undefined>(
    (largest, file) => (largest === undefined || file.bytes > largest.bytes ? file : largest),
    undefined,
  );
}

export function evaluateBudget(files: ReadonlyArray<FileSize>, budget: BundleBudget): BudgetResult {
  const vendorKeys = Object.keys(budget.vendor);
  const rows: BudgetRow[] = [];
  let ok = true;
  const push = (row: BudgetRow): void => {
    if (row.status !== 'ok') ok = false;
    rows.push(row);
  };

  const entryFiles: FileSize[] = [];
  const lazyFiles: FileSize[] = [];
  const vendorFiles = new Map<string, FileSize[]>();
  for (const file of files) {
    const kind = classifyChunk(file.name, vendorKeys);
    if (kind === 'entry') {
      entryFiles.push(file);
      continue;
    }
    const key = vendorKeys.find((k) => classifyChunk(file.name, [k]) === 'vendor');
    if (key === undefined) lazyFiles.push(file);
    else {
      const list = vendorFiles.get(key) ?? [];
      list.push(file);
      vendorFiles.set(key, list);
    }
  }

  const entry = pickLargest(entryFiles);
  push(
    entry === undefined
      ? { chunk: 'entry', file: '', bytes: 0, limit: budget.entry, status: 'missing' }
      : {
          chunk: 'entry',
          file: entry.name,
          bytes: entry.bytes,
          limit: budget.entry,
          status: entry.bytes > budget.entry ? 'over' : 'ok',
        },
  );
  for (const key of vendorKeys) {
    const vendor = pickLargest(vendorFiles.get(key) ?? []);
    push(
      vendor === undefined
        ? { chunk: key, file: '', bytes: 0, limit: budget.vendor[key], status: 'missing' }
        : {
            chunk: key,
            file: vendor.name,
            bytes: vendor.bytes,
            limit: budget.vendor[key],
            status: vendor.bytes > budget.vendor[key] ? 'over' : 'ok',
          },
    );
  }
  const lazy = pickLargest(lazyFiles);
  push(
    lazy === undefined
      ? { chunk: 'lazy', file: '', bytes: 0, limit: budget.lazyChunkMax, status: 'ok' }
      : {
          chunk: 'lazy',
          file: lazy.name,
          bytes: lazy.bytes,
          limit: budget.lazyChunkMax,
          status: lazy.bytes > budget.lazyChunkMax ? 'over' : 'ok',
        },
  );
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  push({
    chunk: 'total',
    file: '',
    bytes: totalBytes,
    limit: budget.total,
    status: totalBytes > budget.total ? 'over' : 'ok',
  });
  return { rows, ok, totalBytes };
}

function repoPath(...parts: string[]): string {
  return join(fileURLToPath(new URL('..', import.meta.url)), ...parts);
}

export function loadBudget(): BundleBudget {
  return JSON.parse(readFileSync(repoPath('bundle-budget.json'), 'utf8')) as BundleBudget;
}

export function measureDist(): FileSize[] {
  const assetsDir = repoPath('dist', 'assets');
  if (!existsSync(assetsDir)) return [];
  return readdirSync(assetsDir)
    .filter((name) => JS_PATTERN.test(name))
    .map((name) => ({ name, bytes: statSync(join(assetsDir, name)).size }));
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} B`;
}

function printTable(result: BudgetResult): void {
  const width = Math.max(...result.rows.map((row) => row.chunk.length), 'chunk'.length);
  const lines = result.rows.map(
    (row) =>
      `${row.chunk.padEnd(width)}  ${formatBytes(row.bytes).padStart(14)}  ${formatBytes(
        row.limit,
      ).padStart(14)}  ${row.status.toUpperCase()}`,
  );
  console.log(`${'chunk'.padEnd(width)}  ${'bytes'.padStart(14)}  ${'limit'.padStart(14)}  status`);
  for (const line of lines) console.log(line);
}

function main(argv: readonly string[]): void {
  const budget = loadBudget();
  const files = measureDist();
  if (files.length === 0) {
    console.error(`bundle-budget: no JS chunks found under dist/assets. Run 'make build' first.`);
    process.exit(1);
  }
  const result = evaluateBudget(files, budget);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printTable(result);
  if (!result.ok) {
    const over = result.rows.filter((row) => row.status === 'over');
    console.error(
      `bundle-budget: ${over.length} row(s) over budget:\n` +
        over
          .map((row) => `  ${row.chunk} (${row.file || 'n/a'}): ${row.bytes} > ${row.limit}`)
          .join('\n'),
    );
    process.exit(1);
  }
}

if (import.meta.main) main(process.argv);
