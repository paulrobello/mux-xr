import { create } from '@bufbuild/protobuf';
import type { PaneDescriptor, WorkspaceSnapshot } from '../contracts';
import { decodeServerMessage, encodeClientMessage } from '../terminal/protocol';
import {
  ClientMessageSchema,
  MuxTreeRequestSchema,
  type MuxTreeSnapshot,
} from '../terminal/vendor/terminal_pb';

export function normalizeTree(tree: MuxTreeSnapshot): WorkspaceSnapshot {
  const panes: PaneDescriptor[] = [];
  for (const workspace of tree.workspaces) {
    for (const session of workspace.sessions) {
      for (const window of session.windows) {
        for (const pane of window.panes) {
          panes.push({
            id: pane.id,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            sessionId: session.id,
            sessionName: session.name,
            windowId: window.id,
            windowName: window.name,
            title: pane.title || `${window.name} · ${pane.id}`,
            cols: pane.cols,
            rows: pane.rows,
            active: pane.active,
            windowActive: window.active,
          });
        }
      }
    }
  }
  return { panes };
}

export function hierarchyURL(endpoint: string): string {
  const url = new URL(endpoint || location.origin, location.href);
  if (!['https:', 'http:', 'ws:', 'wss:'].includes(url.protocol))
    throw new Error('Use an HTTP or WebSocket streamer endpoint.');
  url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:';
  if (location.protocol === 'https:' && url.protocol === 'ws:')
    throw new Error('A secure workspace requires a WSS streamer endpoint.');
  if (!url.pathname.endsWith('/ws')) url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  url.searchParams.delete('session');
  url.searchParams.set('metadata', '1');
  return url.toString();
}

export async function connectHierarchy(
  endpoint: string,
  onSnapshot: (snapshot: WorkspaceSnapshot) => void,
  onError: (message: string) => void,
): Promise<{ disconnect(): void; refresh(): void }> {
  const url = hierarchyURL(endpoint);
  let socket: WebSocket | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const start = (): void => {
    if (stopped) return;
    if (retry) {
      clearTimeout(retry);
      retry = undefined;
    }
    const current = new WebSocket(url);
    socket = current;
    current.binaryType = 'arraybuffer';
    timer = setTimeout(() => {
      if (socket !== current || stopped) return;
      onError('No mux hierarchy received. Check the streamer version and endpoint.');
      current.close();
    }, 8000);
    current.onopen = () =>
      current.send(
        encodeClientMessage(
          create(ClientMessageSchema, {
            message: { case: 'muxTreeRequest', value: create(MuxTreeRequestSchema) },
          }),
        ),
      );
    current.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket !== current || stopped) return;
      try {
        const message = decodeServerMessage(event.data);
        if (message.message.case === 'muxTreeSnapshot') {
          clearTimeout(timer);
          attempts = 0;
          onSnapshot(normalizeTree(message.message.value));
        } else if (message.message.case === 'error') onError(message.message.value.message);
      } catch {
        onError('The streamer sent an unsupported message. Check its protocol version.');
        current.close();
      }
    };
    current.onerror = () => {
      if (!stopped) onError('Cannot reach the streamer. Check its LAN address and certificate.');
    };
    current.onclose = () => {
      if (socket !== current || stopped) return;
      clearTimeout(timer);
      attempts += 1;
      retry = setTimeout(start, Math.min(500 * 2 ** attempts, 10000));
    };
  };
  start();
  return {
    disconnect() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(retry);
      socket?.close();
    },
    refresh() {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(
          encodeClientMessage(
            create(ClientMessageSchema, {
              message: { case: 'muxTreeRequest', value: create(MuxTreeRequestSchema) },
            }),
          ),
        );
    },
  };
}
