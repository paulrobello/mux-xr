import { describe, expect, it } from 'vitest';
import {
  parseToastEnvelope,
  parseToastRequest,
  TOAST_MESSAGE_MAX,
  type Toast,
} from '../src/toast-contract';
import { createToastQueue, TOAST_QUEUE_LIMIT, TOASTS_PER_PLACEMENT } from '../src/xr/toast-queue';

const id = () => 'generated';

const toast = (overrides: Partial<Toast> = {}): Toast => ({
  id: 'a',
  message: 'hello',
  title: null,
  level: 'info',
  color: '#5ad1e6',
  timeout: 6,
  placement: 'top',
  paneId: null,
  source: null,
  ...overrides,
});

describe('parseToastRequest', () => {
  it('fills defaults per level and lowercases a custom color', () => {
    expect(parseToastRequest({ message: ' Disk full ', level: 'error' }, id)).toEqual({
      ok: true,
      value: {
        type: 'toast',
        toast: toast({
          id: 'generated',
          message: 'Disk full',
          level: 'error',
          color: '#ff7a6b',
          timeout: 15,
        }),
      },
    });
    const custom = parseToastRequest(
      {
        id: 'ci-42',
        message: 'ok',
        level: 'success',
        color: '#AABBCC',
        timeout: 0,
        placement: 'pane',
        paneId: '%17',
        title: 'CI',
        source: 'gh',
      },
      id,
    );
    expect(custom.ok && custom.value.type === 'toast' && custom.value.toast).toEqual(
      toast({
        id: 'ci-42',
        message: 'ok',
        level: 'success',
        color: '#aabbcc',
        timeout: 0,
        placement: 'pane',
        paneId: '%17',
        title: 'CI',
        source: 'gh',
      }),
    );
  });

  it('strips control and bidi characters but keeps newlines', () => {
    const parsed = parseToastRequest({ message: 'a\u0007b‮c\nd\te' }, id);
    expect(parsed.ok && parsed.value.type === 'toast' && parsed.value.toast.message).toBe(
      'abc\nd e',
    );
  });

  it('rejects out-of-range fields', () => {
    const bad = [
      [],
      'text',
      {},
      { message: '   ' },
      { message: 'x'.repeat(TOAST_MESSAGE_MAX + 1) },
      { message: 'x', title: 'x'.repeat(61) },
      { message: 'x', level: 'debug' },
      { message: 'x', placement: 'left' },
      { message: 'x', color: '#abc' },
      { message: 'x', timeout: 3601 },
      { message: 'x', timeout: '5' },
      { message: 'x', id: 'has space' },
      { message: 'x', paneId: 'pane/1' },
      { dismiss: true },
      { dismiss: 'yes', id: 'a' },
    ];
    for (const body of bad)
      expect(parseToastRequest(body, id).ok, JSON.stringify(body)).toBe(false);
  });

  it('turns dismiss with an id into a dismissal', () => {
    expect(parseToastRequest({ id: 'a', dismiss: true }, id)).toEqual({
      ok: true,
      value: { type: 'dismiss', id: 'a' },
    });
  });
});

describe('parseToastEnvelope', () => {
  it('accepts valid pushes and rejects anything else', () => {
    expect(parseToastEnvelope({ type: 'toast', toast: toast() })).toEqual({
      type: 'toast',
      toast: toast(),
    });
    expect(parseToastEnvelope({ type: 'dismiss', id: 'a' })).toEqual({ type: 'dismiss', id: 'a' });
    expect(parseToastEnvelope({ type: 'toast', toast: { ...toast(), id: undefined } })).toBeNull();
    expect(parseToastEnvelope({ type: 'toast', toast: { ...toast(), level: 'loud' } })).toBeNull();
    expect(parseToastEnvelope({ type: 'ready' })).toBeNull();
    expect(parseToastEnvelope(null)).toBeNull();
  });
});

describe('toast queue', () => {
  it('replaces a toast with the same id and restarts its timeout', () => {
    const queue = createToastQueue();
    queue.apply({ type: 'toast', toast: toast({ message: 'one' }) }, 0);
    queue.apply({ type: 'toast', toast: toast({ message: 'two' }) }, 5_000);
    expect(queue.size()).toBe(1);
    expect(queue.expire(6_000)).toBe(false);
    expect(queue.visible('top').map((entry) => entry.toast.message)).toEqual(['two']);
    expect(queue.expire(11_000)).toBe(true);
    expect(queue.size()).toBe(0);
  });

  it('keeps a zero-timeout toast until dismissed', () => {
    const queue = createToastQueue();
    queue.apply({ type: 'toast', toast: toast({ timeout: 0 }) }, 0);
    expect(queue.expire(1e12)).toBe(false);
    expect(queue.apply({ type: 'dismiss', id: 'a' }, 0)).toBe(true);
    expect(queue.dismiss('a')).toBe(false);
  });

  it('shows the newest few per placement and keeps placements apart', () => {
    const queue = createToastQueue();
    for (let index = 0; index < 5; index += 1)
      queue.apply({ type: 'toast', toast: toast({ id: `t${index}` }) }, index);
    queue.apply({ type: 'toast', toast: toast({ id: 'h', placement: 'hud' }) }, 10);
    expect(queue.visible('top').map((entry) => entry.toast.id)).toEqual(
      ['t4', 't3', 't2'].slice(0, TOASTS_PER_PLACEMENT),
    );
    expect(queue.visible('hud').map((entry) => entry.toast.id)).toEqual(['h']);
    queue.dismiss('t4');
    expect(queue.visible('top')[0].toast.id).toBe('t3');
  });

  it('drops the oldest past its limit', () => {
    const queue = createToastQueue();
    for (let index = 0; index <= TOAST_QUEUE_LIMIT; index += 1)
      queue.apply({ type: 'toast', toast: toast({ id: `t${index}`, placement: 'center' }) }, 0);
    expect(queue.size()).toBe(TOAST_QUEUE_LIMIT);
    expect(queue.dismiss('t0')).toBe(false);
  });
});
