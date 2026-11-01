import type {
  PaneDescriptor,
  TerminalStatus,
  TerminalSurface,
  WorkspaceSnapshot,
} from './contracts';

export const demoSnapshot: WorkspaceSnapshot = {
  panes: [
    {
      id: 'demo-1',
      title: 'Build monitor',
      workspaceId: 'demo-work',
      workspaceName: 'Demo workspace',
      sessionId: 'demo-session',
      sessionName: 'Development',
      windowId: 'demo-window',
      windowName: 'Build',
      cols: 80,
      rows: 24,
    },
    {
      id: 'demo-2',
      title: 'Agent activity',
      workspaceId: 'demo-work',
      workspaceName: 'Demo workspace',
      sessionId: 'demo-session',
      sessionName: 'Development',
      windowId: 'demo-window-2',
      windowName: 'Agents',
      cols: 80,
      rows: 24,
    },
  ],
};

export function createDemoSurface(pane: PaneDescriptor): TerminalSurface {
  const canvas = document.createElement('canvas');
  let cols = pane.cols ?? 80;
  let rows = pane.rows ?? 24;
  canvas.width = cols * 14;
  canvas.height = rows * 28;
  const listeners = new Set<() => void>();
  let revision = 0;
  let status: TerminalStatus = 'connected';
  const entries =
    pane.id === 'demo-1'
      ? [
          '$ bun run build',
          '',
          '  MUX XR  /  WORKSPACE PREVIEW',
          '',
          '  TypeScript       ready',
          '  Terminal streams waiting for a live endpoint',
          '  Controller input available in WebXR',
          '',
          '  This is synthetic demonstration content.',
          '  Connect your streamer for real terminal output.',
          '',
          '$ _',
        ]
      : [
          '$ agent status',
          '',
          '  Demo workspace',
          '  ├─ Development',
          '  │  ├─ Build monitor',
          '  │  └─ Agent activity',
          '',
          '  Quick commands target the selected panel.',
          '  Looking at a panel never sends input.',
          '',
          '  DEMO • no commands execute on your computer',
          '',
          '$ _',
        ];
  const paint = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#080d14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '22px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    entries.slice(-24).forEach((line, index) => {
      ctx.fillStyle = line.startsWith('$')
        ? '#77d9d1'
        : line.includes('DEMO')
          ? '#d5b879'
          : '#c8d6e2';
      ctx.fillText(line, 22, 22 + index * 27);
    });
    revision += 1;
    for (const listener of listeners) listener();
  };
  const send = (text: string): boolean => {
    if (status !== 'connected') return false;
    entries.push(`demo input: ${JSON.stringify(text)}`);
    paint();
    return true;
  };
  paint();
  return {
    canvas,
    pane,
    get revision() {
      return revision;
    },
    get status() {
      return status;
    },
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    get canResizeGrid() {
      return status === 'connected';
    },
    connect: () => undefined,
    sendText: send,
    sendKey: send,
    paste: send,
    focus: () => undefined,
    resizeGrid: (nextCols, nextRows) => {
      if (status !== 'connected') return false;
      if (
        !Number.isInteger(nextCols) ||
        !Number.isInteger(nextRows) ||
        nextCols < 2 ||
        nextCols > 300 ||
        nextRows < 2 ||
        nextRows > 150
      )
        return false;
      cols = nextCols;
      rows = nextRows;
      canvas.width = cols * 14;
      canvas.height = rows * 28;
      paint();
      return true;
    },
    setColorMode: () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      status = 'closed';
      listeners.clear();
    },
  };
}
