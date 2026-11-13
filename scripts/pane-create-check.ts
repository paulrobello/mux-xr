import { create } from '@bufbuild/protobuf';
import type { PaneDescriptor } from '../src/contracts';
import { decodeServerMessage, encodeClientMessage } from '../src/terminal/protocol';
import { ClientMessageSchema, MuxTreeRequestSchema } from '../src/terminal/vendor/terminal_pb';
import { normalizeTree } from '../src/workspace/hierarchy';
import {
  PANE_CREATE_WINDOW_NAME,
  type PaneCreateOutcome,
  requestPaneCreate,
} from '../src/workspace/pane-create';

// Private-daemon check of the real pane-create wire contract. Run only against an isolated
// streamer and par-mux socket: the `created` case adds a real default-shell window.
type Expectation = 'created' | 'disabled' | 'read_only' | 'old';

const PRIVATE_TEST = process.env.MUX_XR_PRIVATE_TEST === '1';
const STREAMER = process.env.MUX_XR_STREAMER ?? '';
const EXPECT = process.env.MUX_XR_EXPECT as Expectation | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function tree(base: string): Promise<PaneDescriptor[]> {
  return new Promise((resolve, reject) => {
    const url = new URL(base);
    url.pathname = '/ws';
    url.search = '';
    url.searchParams.set('metadata', '1');
    const socket = new WebSocket(url.toString());
    socket.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('No mux tree snapshot'));
    }, 8000);
    socket.onopen = () =>
      socket.send(
        encodeClientMessage(
          create(ClientMessageSchema, {
            message: { case: 'muxTreeRequest', value: create(MuxTreeRequestSchema) },
          }),
        ),
      );
    socket.onmessage = (event) => {
      const message = decodeServerMessage(event.data as ArrayBuffer);
      if (message.message.case !== 'muxTreeSnapshot') return;
      clearTimeout(timer);
      socket.close();
      resolve(normalizeTree(message.message.value).panes);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Metadata socket failed'));
    };
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  assert(PRIVATE_TEST, 'MUX_XR_PRIVATE_TEST=1 is required: this check creates real panes');
  assert(STREAMER, 'MUX_XR_STREAMER (private ws://127.0.0.1:<port>) is required');
  assert(
    EXPECT && ['created', 'disabled', 'read_only', 'old'].includes(EXPECT),
    'MUX_XR_EXPECT must be created, disabled, read_only or old',
  );
  const host = new URL(STREAMER).hostname;
  assert(
    host === '127.0.0.1' || host === 'localhost',
    'Private checks must use a loopback streamer',
  );
  const before = await tree(STREAMER);
  assert(before.length > 0, 'The private daemon reports no panes');
  const anchor = before[0];
  const endpoint = EXPECT === 'read_only' ? `${STREAMER}?readonly=1` : STREAMER;
  const startedAt = Date.now();
  const outcome: PaneCreateOutcome = await requestPaneCreate(
    endpoint,
    anchor.id,
    anchor.sessionId,
    {
      timeoutMs: EXPECT === 'old' ? 4000 : 10000,
      lateGraceMs: 0,
    },
  );
  const elapsedMs = Date.now() - startedAt;
  let after = await tree(STREAMER);
  if (outcome.kind === 'created')
    for (let attempt = 0; attempt < 20 && !after.some((p) => p.id === outcome.paneId); attempt++) {
      await sleep(250);
      after = await tree(STREAMER);
    }
  else {
    await sleep(1500);
    after = await tree(STREAMER);
  }
  const added = after.filter((pane) => !before.some((old) => old.id === pane.id));
  const geometryChanged = before
    .map((old) => ({ old, now: after.find((pane) => pane.id === old.id) }))
    .filter(({ old, now }) => !now || now.cols !== old.cols || now.rows !== old.rows)
    .map(({ old, now }) => ({
      id: old.id,
      before: [old.cols, old.rows],
      after: now ? [now.cols, now.rows] : null,
    }));
  const result = {
    kind: 'pane-create-real-core',
    expect: EXPECT,
    streamer: STREAMER,
    anchor: { id: anchor.id, sessionId: anchor.sessionId, cols: anchor.cols, rows: anchor.rows },
    outcome,
    elapsedMs,
    panesBefore: before.map((pane) => `${pane.id}@${pane.sessionId} ${pane.cols}x${pane.rows}`),
    panesAfter: after.map((pane) => `${pane.id}@${pane.sessionId} ${pane.cols}x${pane.rows}`),
    added: added.map((pane) => `${pane.id} window ${pane.windowId} "${pane.windowName}"`),
    geometryChanged,
  };
  console.log(JSON.stringify(result, null, 2));
  assert(geometryChanged.length === 0, 'An existing pane was removed or resized');
  if (EXPECT === 'created') {
    assert(outcome.kind === 'created', `Expected pane_created, got ${outcome.kind}`);
    assert(outcome.sessionId === anchor.sessionId, 'Reply session does not echo the request');
    assert(/^%\d+$/.test(outcome.paneId) && /^@\d+$/.test(outcome.windowId), 'Malformed ids');
    assert(
      added.length === 1 && added[0].id === outcome.paneId,
      'Exactly the returned pane must appear',
    );
    assert(added[0].sessionId === anchor.sessionId, 'The new pane is in another session');
    assert(added[0].windowId === outcome.windowId, 'The new pane is not in the returned window');
    assert(
      added[0].windowName === PANE_CREATE_WINDOW_NAME,
      `The new window is named ${JSON.stringify(added[0].windowName)}, not ${PANE_CREATE_WINDOW_NAME}`,
    );
  } else {
    assert(added.length === 0, 'A refused or unanswered request created a pane');
    if (EXPECT === 'old')
      assert(outcome.kind === 'uncertain', 'Old servers must leave the outcome uncertain');
    else
      assert(
        outcome.kind === 'refused' && outcome.reason === EXPECT,
        `Expected ${EXPECT} refusal, got ${JSON.stringify(outcome)}`,
      );
  }
  console.log(`PASS ${EXPECT}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
