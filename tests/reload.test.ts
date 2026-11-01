import { describe, expect, it, vi } from 'vitest';
import { reloadAfterXR } from '../src/reload';

describe('explicit update reload', () => {
  it('awaits immersive exit and preserves the URL while bypassing cached HTML', async () => {
    let finish: (() => void) | undefined;
    const end = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const replace = vi.fn();
    const work = reloadAfterXR(() => end, { href: 'https://host/?demo=1#view', replace });
    expect(replace).not.toHaveBeenCalled();
    finish?.();
    await work;
    const target = new URL(replace.mock.calls[0][0]);
    expect(target.searchParams.get('demo')).toBe('1');
    expect(target.searchParams.has('_reload')).toBe(true);
    expect(target.hash).toBe('#view');
  });
  it('does not navigate when immersive exit fails', async () => {
    const replace = vi.fn();
    await expect(
      reloadAfterXR(() => Promise.reject(new Error('end failed')), {
        href: 'https://host/',
        replace,
      }),
    ).rejects.toThrow('end failed');
    expect(replace).not.toHaveBeenCalled();
  });
});
