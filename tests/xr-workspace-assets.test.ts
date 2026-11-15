import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stageWorkspaceAssets } from '../packages/xr-workspace/stage-assets';

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const PAIRS: [packaged: string, served: string][] = [
  ['packages/xr-workspace/assets/fonts', 'public/fonts'],
  ['packages/xr-workspace/assets/xr-hands', 'public/assets/xr-hands'],
];

describe('packaged XR workspace assets', () => {
  it('match the files Mux XR serves, byte for byte', () => {
    for (const [packaged, served] of PAIRS)
      for (const name of readdirSync(served))
        expect(sha(join(packaged, name)), `${packaged}/${name}`).toBe(sha(join(served, name)));
  });

  it('stages fonts and hand models at the default request paths', async () => {
    const target = mkdtempSync(join(tmpdir(), 'xr-workspace-assets-'));
    try {
      await stageWorkspaceAssets(target);
      expect(readdirSync(join(target, 'fonts'))).toContain('NotoSans-Regular.ttf');
      expect(readdirSync(join(target, 'assets/xr-hands')).sort()).toEqual(
        expect.arrayContaining(['left.glb', 'right.glb']),
      );
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
