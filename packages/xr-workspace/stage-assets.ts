#!/usr/bin/env bun
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = resolve(dirname(fileURLToPath(import.meta.url)), 'assets');

/**
 * Copies the label fonts and standard hand models into an app's public directory, at the paths
 * the package requests by default (`/fonts/` and `/assets/xr-hands/`). Build-time only: this
 * module uses the file system and must not be imported by browser code.
 */
export async function stageWorkspaceAssets(publicDir: string): Promise<void> {
  await mkdir(publicDir, { recursive: true });
  await cp(resolve(assets, 'fonts'), resolve(publicDir, 'fonts'), { recursive: true });
  await cp(resolve(assets, 'xr-hands'), resolve(publicDir, 'assets/xr-hands'), {
    recursive: true,
  });
}

if (import.meta.main) await stageWorkspaceAssets(process.argv[2] ?? 'public');
