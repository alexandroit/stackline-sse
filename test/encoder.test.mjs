import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SSEEncodeError,
  createEncoderStream,
  createParser,
  encode,
  encodeComment,
  encodeJSON,
  encodeSSE
} from '../src/index.js';
import { collect } from './helpers.mjs';

test('encoder emits complete, multiline and comment messages', () => {
  assert.equal(
    encodeSSE({ comment: 'heartbeat', event: 'update', id: '42', retry: 3000, data: 'one\r\ntwo\rthree' }),
    ': heartbeat\nevent: update\nid: 42\nretry: 3000\ndata: one\ndata: two\ndata: three\n\n'
  );
  assert.equal(encode({ data: '' }), 'data: \n\n');
  assert.equal(encodeSSE({ event: '', data: 'default' }), 'data: default\n\n');
  assert.equal(encodeComment('one\ntwo'), ': one\n: two\n\n');
  assert.equal(encodeSSE({ data: 'ok' }, { newline: '\r\n' }), 'data: ok\r\n\r\n');
});

test('encoder prevents field and Last-Event-ID line injection', () => {
  for (const [field, value] of [
    ['id', 'safe\ndata: injected'],
    ['id', 'safe\0bad'],
    ['event', 'safe\rretry: 0']
  ]) {
    assert.throws(() => encodeSSE({ data: 'x', [field]: value }), (error) => {
      assert.ok(error instanceof SSEEncodeError);
      assert.equal(error.field, field);
      return true;
    });
  }
});

test('encoder validates messages, primitives, retry and newline', () => {
  assert.throws(() => encodeSSE(null), TypeError);
  assert.throws(() => encodeSSE({}), { code: 'ERR_SSE_ENCODE' });
  assert.throws(() => encodeSSE({ data: {} }), { code: 'ERR_SSE_ENCODE' });
  assert.throws(() => encodeSSE({ retry: -1 }), { code: 'ERR_SSE_ENCODE' });
  assert.throws(() => encodeSSE({ retry: Infinity }), { code: 'ERR_SSE_ENCODE' });
  assert.throws(() => encodeSSE({ data: 'x' }, { newline: '\r' }), { code: 'ERR_SSE_ENCODE' });
  assert.equal(encodeSSE({ data: 12n, event: true, id: 7 }), 'event: true\nid: 7\ndata: 12\n\n');
});

test('JSON encoder preserves fields and wraps serialization failures', () => {
  assert.equal(
    encodeJSON({ ok: true }, { event: 'result', id: '7' }),
    'event: result\nid: 7\ndata: {"ok":true}\n\n'
  );
  assert.equal(encodeJSON({ secret: 1 }, {}, { replacer: (key, value) => key === 'secret' ? undefined : value }), 'data: {}\n\n');
  assert.throws(() => encodeJSON(undefined), { code: 'ERR_SSE_ENCODE' });
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => encodeJSON(cyclic), (error) => error.code === 'ERR_SSE_ENCODE' && error.cause instanceof TypeError);
});

test('encoded messages round-trip through the parser without ambiguity', () => {
  const messages = [
    { data: 'alpha', id: '1' },
    { data: 'line one\nline two', event: 'delta', id: '2', retry: 25 },
    { data: '', id: '' }
  ];
  const events = [];
  const parser = createParser({ onEvent: (event) => events.push(event) });
  for (const message of messages) parser.feed(encodeSSE(message));
  assert.deepEqual(events.map(({ data, event, lastEventId }) => ({ data, event, lastEventId })), [
    { data: 'alpha', event: undefined, lastEventId: '1' },
    { data: 'line one\nline two', event: 'delta', lastEventId: '2' },
    { data: '', event: undefined, lastEventId: '' }
  ]);
});

test('encoder TransformStream supports strings, bytes and JSON mode', async () => {
  const stringWriter = createEncoderStream({ bytes: false });
  const stringOutput = collect(stringWriter.readable);
  const writer = stringWriter.writable.getWriter();
  await writer.write({ data: 'one' });
  await writer.close();
  assert.deepEqual(await stringOutput, ['data: one\n\n']);

  const byteWriter = createEncoderStream({ json: true });
  const byteOutput = collect(byteWriter.readable);
  const bytes = byteWriter.writable.getWriter();
  await bytes.write({ data: { ok: true }, event: 'json' });
  await bytes.close();
  assert.equal(new TextDecoder().decode((await byteOutput)[0]), 'event: json\ndata: {"ok":true}\n\n');
});

test('stream encoder reports unavailable Web Stream primitives at call time', () => {
  const originalTransform = globalThis.TransformStream;
  const originalEncoder = globalThis.TextEncoder;
  try {
    globalThis.TransformStream = undefined;
    assert.throws(() => createEncoderStream(), /TransformStream/);
    globalThis.TransformStream = originalTransform;
    globalThis.TextEncoder = undefined;
    assert.throws(() => createEncoderStream(), /TextEncoder/);
  } finally {
    globalThis.TransformStream = originalTransform;
    globalThis.TextEncoder = originalEncoder;
  }
});
