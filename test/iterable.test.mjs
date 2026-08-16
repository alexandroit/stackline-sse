import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDecoderStream,
  decodeJSON,
  decodeSSE,
  toAsyncIterable
} from '../src/index.js';
import { byteChunks, collect, streamFrom } from './helpers.mjs';

test('decodeSSE accepts iterable, async iterable, ReadableStream and Response sources', async () => {
  const text = 'data: one\n\ndata: two\n\n';
  const iterable = await collect(decodeSSE([text]));
  assert.deepEqual(iterable.map((event) => event.data), ['one', 'two']);

  async function* asyncSource() {
    yield* byteChunks(text, 2);
  }
  const asynchronous = await collect(decodeSSE(asyncSource()));
  assert.deepEqual(asynchronous.map((event) => event.data), ['one', 'two']);

  const readable = await collect(decodeSSE(streamFrom(byteChunks(text, 3))));
  assert.deepEqual(readable.map((event) => event.data), ['one', 'two']);

  const response = await collect(decodeSSE(new Response(text)));
  assert.deepEqual(response.map((event) => event.data), ['one', 'two']);
});

test('decodeSSE is pull-based and cancels a Web Stream when iteration stops', async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new TextEncoder().encode(`data: ${pulls}\n\n`));
    },
    cancel() {
      cancelled = true;
    }
  }, { highWaterMark: 0 });

  for await (const event of decodeSSE(stream)) {
    assert.equal(event.data, '1');
    break;
  }
  assert.ok(pulls <= 2, `stream pulled ${pulls} times`);
  assert.equal(cancelled, true);
});

test('decodeSSE bounds callback bursts from oversized source chunks', async () => {
  const text = 'data: x\n\n'.repeat(5);
  await assert.rejects(
    collect(decodeSSE([text], { feedSize: text.length, maxQueuedEvents: 3 })),
    { code: 'ERR_SSE_QUEUE_LIMIT' }
  );
  await assert.rejects(collect(decodeSSE([text], { feedSize: 0 })), RangeError);
  await assert.rejects(collect(decodeSSE([text], { maxQueuedEvents: 0 })), RangeError);
});

test('decodeSSE validates chunks, source shapes and abort signals', async () => {
  assert.throws(() => toAsyncIterable(null), TypeError);
  assert.throws(() => toAsyncIterable({}), TypeError);
  await assert.rejects(collect(decodeSSE([{}])), TypeError);

  const controller = new AbortController();
  controller.abort(new Error('stop-now'));
  await assert.rejects(collect(decodeSSE(['data: x\n\n'], { signal: controller.signal })), /stop-now/);
});

test('decodeSSE aborts an async iterator that ignores its signal', async () => {
  const controller = new AbortController();
  let returned = false;
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return() {
          returned = true;
          return Promise.resolve({ done: true });
        }
      };
    }
  };
  const pending = collect(decodeSSE(source, { signal: controller.signal }));
  setTimeout(() => controller.abort(new Error('iterator-stop')), 5);
  await assert.rejects(pending, /iterator-stop/);
  assert.equal(returned, true);
});

test('decodeSSE closes structural signal races and non-settling cleanup', async () => {
  const signal = {
    aborted: false,
    reason: new Error('structural-race'),
    addEventListener() {
      this.aborted = true;
    },
    removeEventListener() {}
  };
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return: () => new Promise(() => {})
      };
    }
  };
  await assert.rejects(collect(decodeSSE(source, { signal })), /structural-race/);

  const controller = new AbortController();
  const throwingCleanup = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return() {
          throw new Error('ignored-cleanup-failure');
        }
      };
    }
  };
  const pending = collect(decodeSSE(throwingCleanup, { signal: controller.signal }));
  controller.abort(new Error('preferred-abort'));
  await assert.rejects(pending, /preferred-abort/);
});

test('decodeJSON handles values, done sentinels, revivers and invalid records', async () => {
  const stream = [
    'event: value\ndata: {"count":1}\n\n',
    'data: not-json\n\n',
    'data: [DONE]\n\n',
    'data: {"count":3}\n\n'
  ];
  const ignored = await collect(decodeJSON(stream, {
    ignoreInvalidJSON: true,
    reviver: (key, value) => key === 'count' ? value * 2 : value
  }));
  assert.deepEqual(ignored, [
    { data: { count: 2 }, event: 'value', id: undefined, lastEventId: '' }
  ]);

  await assert.rejects(
    collect(decodeJSON(['data: invalid\n\n'], { doneSentinel: false })),
    { code: 'ERR_SSE_JSON' }
  );
});

test('decoder TransformStream emits parsed events and discards incomplete EOF data', async () => {
  const callbacks = [];
  const decoder = createDecoderStream({ onEvent: (event) => callbacks.push(event.data) });
  const output = collect(decoder.readable);
  const writer = decoder.writable.getWriter();
  await writer.write(new TextEncoder().encode('data: complete\n\ndata: incomplete'));
  await writer.close();
  assert.deepEqual((await output).map((event) => event.data), ['complete']);
  assert.deepEqual(callbacks, ['complete']);
});

test('decodeSSE composes parser event callbacks with yielded events', async () => {
  const callbacks = [];
  const events = await collect(decodeSSE(['data: both\n\n'], {
    parser: { onEvent: (event) => callbacks.push(event.data) }
  }));
  assert.deepEqual(callbacks, ['both']);
  assert.equal(events[0].data, 'both');
});

test('reader adapter handles cancel failures, lock release and non-Error abort reasons', async () => {
  let reads = 0;
  let released = false;
  const source = {
    getReader() {
      return {
        async read() {
          reads++;
          return reads === 1
            ? { done: false, value: 'data: fake\n\n' }
            : { done: true, value: undefined };
        },
        async cancel() {
          throw new Error('already closed');
        },
        releaseLock() {
          released = true;
        }
      };
    }
  };
  assert.equal((await collect(decodeSSE(source)))[0].data, 'fake');
  assert.equal(released, true);

  const signal = {
    aborted: true,
    reason: 'plain reason',
    addEventListener() {},
    removeEventListener() {}
  };
  await assert.rejects(collect(decodeSSE(['data: x\n\n'], { signal })), (error) => error.name === 'AbortError');

  const original = globalThis.TransformStream;
  try {
    globalThis.TransformStream = undefined;
    assert.throws(() => createDecoderStream(), /TransformStream/);
  } finally {
    globalThis.TransformStream = original;
  }
});
