import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSSEChannel,
  decodeSSE,
  eventStreamResponse
} from '../src/index.js';
import { collect } from './helpers.mjs';

test('SSE channel sends text, JSON and comments with production headers', async () => {
  const channel = createSSEChannel();
  assert.equal(channel.open, true);
  channel.comment('ready');
  channel.send({ id: '1', event: 'message', data: 'hello' });
  channel.sendJSON({ count: 2 }, { id: '2', event: 'json' });
  channel.close();

  const response = channel.toResponse({ headers: { 'x-test': 'yes' } });
  assert.throws(() => channel.toResponse(), /already been created/);
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.equal(response.headers.get('x-test'), 'yes');

  const events = await collect(decodeSSE(response));
  assert.deepEqual(events.map((event) => [event.event, event.data]), [
    ['message', 'hello'],
    ['json', '{"count":2}']
  ]);
  assert.equal(channel.open, false);
  await channel.closed;
});

test('SSE channel exposes backpressure through send and ready', async () => {
  const channel = createSSEChannel({ highWaterMark: 1 });
  assert.equal(channel.send({ data: 'larger-than-one-byte' }), false);
  let ready = false;
  channel.ready.then(() => {
    ready = true;
  });
  await Promise.resolve();
  assert.equal(ready, false);
  const reader = channel.stream.getReader();
  const item = await reader.read();
  assert.ok(item.value.byteLength > 1);
  await channel.ready;
  assert.equal(ready, true);
  channel.close();
  await reader.read();
});

test('closing a backpressured channel releases ready waiters', async () => {
  const closed = createSSEChannel({ highWaterMark: 1 });
  closed.send({ data: 'queued' });
  const readyAfterClose = closed.ready;
  closed.close();
  await readyAfterClose;

  const failed = createSSEChannel({ highWaterMark: 1 });
  failed.send({ data: 'queued' });
  const readyAfterError = failed.ready;
  failed.error(new Error('closed'));
  await readyAfterError;
});

test('SSE channel handles cancellation, stream errors and closed writes', async () => {
  const cancelled = createSSEChannel();
  const reader = cancelled.stream.getReader();
  await reader.cancel('consumer-left');
  assert.equal(await cancelled.closed, 'consumer-left');
  assert.throws(() => cancelled.send({ data: 'late' }), /closed/);

  const failed = createSSEChannel();
  const failureReader = failed.stream.getReader();
  failed.error(new Error('server-failed'));
  await assert.rejects(failureReader.read(), /server-failed/);
  assert.equal(failed.open, false);
  failed.error(new Error('ignored'));
  failed.close();
});

test('SSE channel heartbeat emits comments without holding the process open', async () => {
  const channel = createSSEChannel({ heartbeatInterval: 5, heartbeatComment: 'pulse' });
  const reader = channel.stream.getReader();
  await new Promise((resolve) => setTimeout(resolve, 12));
  const item = await reader.read();
  assert.equal(new TextDecoder().decode(item.value), ': pulse\n\n');
  channel.close();
  await reader.cancel();

  const empty = createSSEChannel({ heartbeatInterval: 1, heartbeatComment: '' });
  const emptyReader = empty.stream.getReader();
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.equal(new TextDecoder().decode((await emptyReader.read()).value), ':\n\n');
  empty.close();
});

test('eventStreamResponse converts sync and async event iterables with backpressure', async () => {
  const sync = eventStreamResponse([
    { data: 'one', id: '1' },
    { data: 'two', id: '2' }
  ]);
  assert.deepEqual((await collect(decodeSSE(sync))).map((event) => event.data), ['one', 'two']);

  async function* generated() {
    yield { data: { value: 1 }, event: 'json' };
  }
  const asyncResponse = eventStreamResponse(generated(), {
    json: true,
    headers: { 'x-stream': 'yes' },
    status: 201
  });
  assert.equal(asyncResponse.status, 201);
  assert.equal(asyncResponse.headers.get('x-stream'), 'yes');
  const [event] = await collect(decodeSSE(asyncResponse));
  assert.equal(event.data, '{"value":1}');
});

test('eventStreamResponse forwards source failures and cancellation', async () => {
  async function* failed() {
    yield { data: 'first' };
    throw new Error('source-failed');
  }
  const response = eventStreamResponse(failed());
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  await assert.rejects(reader.read(), /source-failed/);

  let returned = false;
  const source = {
    [Symbol.iterator]() {
      return {
        next: () => ({ done: false, value: { data: 'forever' } }),
        return: () => {
          returned = true;
          return { done: true };
        }
      };
    }
  };
  const cancellable = eventStreamResponse(source);
  await cancellable.body.cancel('done');
  assert.equal(returned, true);

  const doublyFailed = eventStreamResponse({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw new Error('primary-failure');
        },
        async return() {
          throw new Error('cleanup-failure');
        }
      };
    }
  });
  await assert.rejects(doublyFailed.body.getReader().read(), /primary-failure/);
});

test('server helpers validate runtime support and queuing options', () => {
  assert.throws(() => createSSEChannel({ highWaterMark: 0 }), RangeError);
  assert.throws(() => createSSEChannel({ heartbeatInterval: -1 }), RangeError);
  assert.throws(
    () => createSSEChannel({ heartbeatInterval: 1, heartbeatComment: {} }),
    { code: 'ERR_SSE_ENCODE' }
  );
  assert.throws(() => eventStreamResponse(null), TypeError);
  assert.throws(() => eventStreamResponse({}, {}), TypeError);

  const original = globalThis.ReadableStream;
  const originalResponse = globalThis.Response;
  try {
    globalThis.ReadableStream = undefined;
    assert.throws(() => createSSEChannel(), /ReadableStream/);
    assert.throws(() => eventStreamResponse([]), /ReadableStream/);
  } finally {
    globalThis.ReadableStream = original;
  }

  try {
    const channel = createSSEChannel();
    globalThis.Response = undefined;
    assert.throws(() => channel.toResponse(), /Response/);
    channel.close();
  } finally {
    globalThis.Response = originalResponse;
  }
});
