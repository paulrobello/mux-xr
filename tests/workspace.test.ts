import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { paneWebSocketURL } from '../src/terminal/surface';
import {
  MuxTreePaneSchema,
  MuxTreeSessionSchema,
  MuxTreeSnapshotSchema,
  MuxTreeWindowSchema,
  MuxTreeWorkspaceSchema,
} from '../src/terminal/vendor/terminal_pb';
import { hierarchyURL, normalizeTree } from '../src/workspace/hierarchy';

describe('workspace metadata connection', () => {
  it('uses the metadata-only selector without accidentally pinning a pane', () => {
    const url = new URL(hierarchyURL('http://localhost:4241/ws?session=pane-3'));
    expect(url.protocol).toBe('ws:');
    expect(url.searchParams.get('metadata')).toBe('1');
    expect(url.searchParams.has('session')).toBe(false);
    const pane = new URL(paneWebSocketURL(url.toString(), '%3'));
    expect(pane.searchParams.get('session')).toBe('pane-3');
    expect(pane.searchParams.has('metadata')).toBe(false);
  });

  it('preserves all hierarchy identities and applies full replacement snapshots', () => {
    const tree = create(MuxTreeSnapshotSchema, {
      workspaces: [
        create(MuxTreeWorkspaceSchema, {
          id: '+1',
          name: 'Work',
          sessions: [
            create(MuxTreeSessionSchema, {
              id: '$2',
              name: 'Dev',
              windows: [
                create(MuxTreeWindowSchema, {
                  id: '@3',
                  name: 'Build',
                  panes: [
                    create(MuxTreePaneSchema, { id: '%4', title: 'Shell', cols: 100, rows: 30 }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(normalizeTree(tree).panes[0]).toEqual({
      id: '%4',
      title: 'Shell',
      workspaceId: '+1',
      workspaceName: 'Work',
      sessionId: '$2',
      sessionName: 'Dev',
      windowId: '@3',
      windowName: 'Build',
      cols: 100,
      rows: 30,
    });
    expect(normalizeTree(create(MuxTreeSnapshotSchema)).panes).toEqual([]);
  });
});
