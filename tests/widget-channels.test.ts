import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', async (importOriginal) => {
  const THREE = await import('three');
  const actual = await importOriginal<typeof import('troika-three-text')>();
  return {
    ...actual,
    Text: class MockText extends THREE.Mesh {
      sync(callback?: () => void): void {
        callback?.();
      }
      dispose(): void {
        /* test double */
      }
    },
    configureTextBuilder: vi.fn(),
  };
});

import { getWidgetEntry } from '../src/xr/widget-registry';
import {
  createChannel,
  createFocusedPaneChannel,
  createWidgetChannels,
} from '../src/xr/widget-types';
import { createTestWidgetContext } from './helpers/widget-context';

describe('widget channels', () => {
  it('replays the current value to a new subscriber only when asked to', () => {
    const replaying = createChannel('a', true);
    const live = createChannel('a', false);
    replaying.publish('b');
    live.publish('b');
    const replayed = vi.fn();
    const heard = vi.fn();
    replaying.subscribe(replayed);
    live.subscribe(heard);
    expect(replayed).toHaveBeenCalledExactlyOnceWith('b');
    expect(heard).not.toHaveBeenCalled();
    live.publish('c');
    expect(heard).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('stops calling a listener once it unsubscribes', () => {
    const channel = createChannel(0, false);
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);
    channel.publish(1);
    unsubscribe();
    channel.publish(2);
    expect(listener).toHaveBeenCalledExactlyOnceWith(1);
    expect(channel.hasSubscribers()).toBe(false);
  });

  it('replays the agent board max rows to subscribers that join late', () => {
    const channels = createWidgetChannels({
      bellFeed: [],
      textureAnisotropy: 4,
      weatherZip: '',
      agentBoardMaxRows: 6,
    });
    expect(channels.agentBoardMaxRows.get()).toBe(6);
    const joined = vi.fn();
    channels.agentBoardMaxRows.subscribe(joined);
    expect(joined).toHaveBeenCalledExactlyOnceWith(6);
    channels.agentBoardMaxRows.publish(9);
    expect(joined).toHaveBeenCalledTimes(2);
    expect(joined).toHaveBeenLastCalledWith(9);
    const late = vi.fn();
    channels.agentBoardMaxRows.subscribe(late);
    expect(late).toHaveBeenCalledExactlyOnceWith(9);
  });

  it('calls each focused-pane subscriber only when its own last value differs', () => {
    const channel = createFocusedPaneChannel();
    const first = vi.fn();
    channel.subscribe(first);
    channel.publish('pane-a', '/a', null);
    channel.publish('pane-a', '/a', null);
    expect(first).toHaveBeenCalledTimes(1);
    // A later subscriber hears the next publish even though the value did not change, and is
    // never given the earlier value on subscribe.
    const second = vi.fn();
    channel.subscribe(second);
    expect(second).not.toHaveBeenCalled();
    channel.publish('pane-a', '/a', null);
    expect(second).toHaveBeenCalledExactlyOnceWith('pane-a', '/a', null);
    expect(first).toHaveBeenCalledTimes(1);
    channel.publish('pane-a', '/a', 'other-mac');
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe('registry wiring', () => {
  it('feeds a new agent board the roster that arrived before it was created', () => {
    const { context, channels } = createTestWidgetContext();
    const row = { paneId: 'pane-a', state: 'working' } as never;
    channels.agentRoster.publish([row]);
    const widget = getWidgetEntry('agent-board').create(context);
    expect(widget.root.getObjectByName('agent-board-row-1')?.visible).toBe(true);
    widget.dispose();
  });

  it('ends a widget subscriptions on dispose', () => {
    const { context, channels } = createTestWidgetContext();
    const widget = getWidgetEntry('perf-gauge').create(context);
    expect(channels.perfSample.hasSubscribers()).toBe(true);
    widget.dispose();
    expect(channels.perfSample.hasSubscribers()).toBe(false);
  });

  it('asks the host for repo status through the context host, not window.location', () => {
    const { context, channels, requests } = createTestWidgetContext();
    const widget = getWidgetEntry('repo-status').create(context);
    channels.focusedPane.publish('pane-a', '/Users/me/alpha', 'build-box');
    widget.update(Date.now());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'ws://host.test/repo-status',
      material: 'build-box\n/Users/me/alpha',
    });
    widget.dispose();
  });
});
