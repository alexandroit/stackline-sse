import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SSERetryError,
  SSEHTTPError,
  SSEReplayError,
  SSETimeoutError,
  consumeSSE,
  fetchEventSource,
  fetchSSE
} from '../src/index.js';
import { collect, eventResponse, headerValue, streamFrom } from './helpers.mjs';

test('fetchSSE performs a Fetch-compatible request and streams events', async () => {
  let captured;
  const opened = [];
  const closed = [];
  const events = await collect(fetchSSE('https://example.test/events', {
    fetch: async (input, init) => {
      captured = { input, init };
      return eventResponse('event: delta\nid: 7\ndata: hello\n\n');
    },
    headers: { Authorization: 'Bearer test' },
    retry: false,
    onOpen: (response) => opened.push(response.status),
    onClose: (context) => closed.push(context.reason)
  }));

  assert.equal(captured.input, 'https://example.test/events');
  assert.equal(headerValue(captured.init, 'accept'), 'text/event-stream');
  assert.equal(headerValue(captured.init, 'authorization'), 'Bearer test');
  assert.equal(captured.init.cache, 'no-store');
  assert.deepEqual(opened, [200]);
  assert.deepEqual(closed, ['eof']);
  assert.deepEqual(events, [
    { data: 'hello', event: 'delta', id: '7', lastEventId: '7' }
  ]);
});

test('fetchSSE reconnects with committed Last-Event-ID, including id-only blocks', async () => {
  const headers = [];
  let call = 0;
  const responses = [
    eventResponse('id: checkpoint\n\n'),
    eventResponse('data: resumed\n\n'),
    new Response(null, { status: 204 })
  ];
  const events = await collect(fetchSSE('https://example.test/events', {
    fetch: async (_input, init) => {
      headers.push(headerValue(init, 'last-event-id'));
      return responses[call++];
    },
    retry: { retries: 2, minDelay: 0, maxDelay: 0, jitter: false }
  }));
  assert.deepEqual(headers, [undefined, 'checkpoint', 'checkpoint']);
  assert.deepEqual(events, [
    { data: 'resumed', event: undefined, id: undefined, lastEventId: 'checkpoint' }
  ]);
});

test('fetchSSE retries configured HTTP failures and rejects fatal responses', async () => {
  let calls = 0;
  const events = await collect(fetchSSE('https://example.test/events', {
    fetch: async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 503, headers: { 'Retry-After': '0' } });
      return eventResponse('data: recovered\n\n');
    },
    retry: { retries: 1, minDelay: 0, maxDelay: 0 }
  }));
  assert.equal(calls, 2);
  assert.equal(events[0].data, 'recovered');

  await assert.rejects(
    collect(fetchSSE('x', {
      fetch: async () => new Response('unauthorized', { status: 401 }),
      retry: 3
    })),
    (error) => error instanceof SSEHTTPError && error.status === 401
  );
  await assert.rejects(
    collect(fetchSSE('x', {
      fetch: async () => new Response('not sse', { status: 200, headers: { 'content-type': 'text/plain' } }),
      retry: 3
    })),
    { code: 'ERR_SSE_CONTENT_TYPE' }
  );
});

test('fetchSSE enforces connect, idle and total timeouts', async () => {
  const hangingFetch = async (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  await assert.rejects(
    collect(fetchSSE('x', { connectTimeout: 10, fetch: hangingFetch, retry: false })),
    (error) => error instanceof SSETimeoutError && error.phase === 'connect'
  );

  const hangingResponse = async (_input, init) => {
    const body = new ReadableStream({
      start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new Error('body aborted')));
      }
    });
    return eventResponse(body);
  };
  await assert.rejects(
    collect(fetchSSE('x', { fetch: hangingResponse, idleTimeout: 10, retry: false })),
    (error) => error instanceof SSETimeoutError && error.phase === 'idle'
  );
  await assert.rejects(
    collect(fetchSSE('x', { fetch: hangingResponse, totalTimeout: 10, retry: false })),
    (error) => error instanceof SSETimeoutError && error.phase === 'total'
  );
});

test('fetchSSE propagates user abort and never retries callback failures', async () => {
  const controller = new AbortController();
  const body = streamFrom(['data: wait\n\n'], { delay: 30 });
  const pending = collect(fetchSSE('x', {
    fetch: async () => eventResponse(body),
    retry: 2,
    signal: controller.signal
  }));
  controller.abort(new Error('user-stop'));
  await assert.rejects(pending, /user-stop/);

  let calls = 0;
  await assert.rejects(
    collect(fetchSSE('x', {
      fetch: async () => {
        calls++;
        return eventResponse('data: x\n\n');
      },
      onEvent() {
        throw new TypeError('consumer failed');
      },
      retry: 5
    })),
    { code: 'ERR_SSE_CALLBACK' }
  );
  assert.equal(calls, 1);
});

test('fetchSSE protects non-replayable bodies and supports body factories', async () => {
  const body = new ReadableStream({ start(controller) { controller.close(); } });
  await assert.rejects(
    collect(fetchSSE('x', {
      body,
      fetch: async () => eventResponse('data: first\n\n'),
      retry: { retries: 1, minDelay: 0, maxDelay: 0 }
    })),
    (error) => error instanceof SSEReplayError
  );

  const bodies = [];
  let calls = 0;
  const events = await collect(fetchSSE('x', {
    bodyFactory: ({ attempt, signal }) => {
      assert.equal(signal.aborted, false);
      return `attempt=${attempt}`;
    },
    fetch: async (_input, init) => {
      bodies.push(init.body);
      calls++;
      return calls === 1 ? eventResponse('data: first\n\n') : new Response(null, { status: 204 });
    },
    retry: { retries: 1, minDelay: 0, maxDelay: 0 }
  }));
  assert.deepEqual(bodies, ['attempt=1', 'attempt=2']);
  assert.equal(events[0].data, 'first');

  await assert.rejects(
    collect(fetchSSE('x', {
      bodyFactory() {
        throw new TypeError('bad factory');
      },
      fetch: async () => eventResponse(''),
      retry: 3
    })),
    { code: 'ERR_SSE_BODY_FACTORY' }
  );
});

test('fetchSSE preserves Request headers while adding SSE negotiation', async () => {
  let captured;
  const request = new Request('https://example.test/events', {
    headers: { Authorization: 'Bearer request-token', 'X-Request': 'preserved' }
  });
  await collect(fetchSSE(request, {
    fetch: async (input, init) => {
      captured = { input, init };
      return new Response(null, { status: 204 });
    },
    retry: false
  }));

  assert.notEqual(captured.input, request);
  assert.equal(headerValue(captured.init, 'authorization'), 'Bearer request-token');
  assert.equal(headerValue(captured.init, 'x-request'), 'preserved');
  assert.equal(headerValue(captured.init, 'accept'), 'text/event-stream');
});

test('timeouts settle when custom fetch and body factories ignore abort', async () => {
  const never = new Promise(() => {});
  await assert.rejects(
    collect(fetchSSE('x', { connectTimeout: 5, fetch: () => never, retry: false })),
    (error) => error instanceof SSETimeoutError && error.phase === 'connect'
  );
  await assert.rejects(
    collect(fetchSSE('x', {
      bodyFactory: () => never,
      connectTimeout: 5,
      fetch: async () => new Response(null, { status: 204 }),
      retry: false
    })),
    (error) => error instanceof SSETimeoutError && error.phase === 'connect'
  );

  let resolveLate;
  let cancelled = false;
  const late = new Promise((resolve) => {
    resolveLate = resolve;
  });
  await assert.rejects(
    collect(fetchSSE('x', { connectTimeout: 5, fetch: () => late, retry: false })),
    (error) => error instanceof SSETimeoutError && error.phase === 'connect'
  );
  resolveLate({
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      cancel() {
        cancelled = true;
      }
    }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cancelled, true);
});

test('client closes the structural AbortSignal registration race', async () => {
  const OriginalAbortController = globalThis.AbortController;
  class RacyAbortController {
    constructor() {
      this.signal = {
        aborted: false,
        reason: new Error('raced-abort'),
        addEventListener() {
          this.aborted = true;
        },
        removeEventListener() {}
      };
    }
    abort() {
      this.signal.aborted = true;
    }
  }
  try {
    globalThis.AbortController = RacyAbortController;
    await assert.rejects(
      collect(fetchSSE('x', {
        fetch: async () => new Response(null, { status: 204 }),
        retry: false
      })),
      /raced-abort/
    );
  } finally {
    globalThis.AbortController = OriginalAbortController;
  }
});

test('retry hooks can stop, override delay and classify custom errors', async () => {
  let calls = 0;
  const retries = [];
  const events = await collect(fetchSSE('x', {
    fetch: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('offline'), { code: 'ECUSTOM' });
      return eventResponse('retry: 5000\ndata: ok\n\n');
    },
    retry: {
      retries: 1,
      maxDelay: 5000,
      minDelay: 1000,
      jitter: () => 500,
      shouldRetry: ({ error }) => error.code === 'ECUSTOM'
    },
    onRetry(context) {
      retries.push(context.delay);
      return 0;
    }
  }));
  assert.deepEqual(retries, [500]);
  assert.equal(events[0].data, 'ok');

  const stopped = await collect(fetchSSE('x', {
    fetch: async () => eventResponse('data: once\n\n'),
    retry: 5,
    onRetry: () => false
  }));
  assert.equal(stopped.length, 1);
});

test('consumeSSE and fetchEventSource provide callback-oriented compatibility', async () => {
  const seen = [];
  const summary = await consumeSSE('x', {
    fetch: async () => eventResponse('id: 2\ndata: first\n\ndata: second\n\n'),
    retry: false,
    onEvent: (event) => seen.push(event.data)
  });
  assert.deepEqual(seen, ['first', 'second']);
  assert.deepEqual(summary, { events: 2, lastEventId: '2' });

  const callbacks = [];
  const compatible = await fetchEventSource('x', {
    fetch: async () => eventResponse('data: compatible\n\n'),
    retry: false,
    onopen: () => callbacks.push('open'),
    onmessage: (event) => callbacks.push(event.data),
    onclose: (context) => callbacks.push(context.reason)
  });
  assert.deepEqual(callbacks, ['open', 'compatible', 'eof']);
  assert.equal(compatible.events, 1);
});

test('fetchSSE validates fetch implementations, response shapes and IDs', async () => {
  await assert.rejects(collect(fetchSSE('x', { fetch: 7, retry: false })), TypeError);
  await assert.rejects(
    collect(fetchSSE('x', { fetch: async () => ({}), retry: false })),
    { code: 'ERR_SSE_RESPONSE' }
  );
  await assert.rejects(collect(fetchSSE('x', {
    fetch: async () => ({ status: 200, headers: { get: () => 'text/event-stream' }, body: null }),
    retry: false
  })), { code: 'ERR_SSE_HTTP' });
  await assert.rejects(collect(fetchSSE('x', {
    fetch: async () => eventResponse(''),
    lastEventId: 'bad\nheader',
    retry: false
  })), TypeError);
  await assert.rejects(collect(fetchSSE('x', {
    fetch: async () => eventResponse(''),
    retry: { retries: -1 }
  })), RangeError);
  for (const option of ['connectTimeout', 'idleTimeout', 'totalTimeout']) {
    await assert.rejects(
      collect(fetchSSE('x', { fetch: async () => eventResponse(''), [option]: -1 })),
      RangeError
    );
  }
});

test('breaking fetchSSE iteration cancels the active response body', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: first\n\n'));
    },
    cancel() {
      cancelled = true;
    }
  });

  for await (const event of fetchSSE('x', {
    fetch: async () => eventResponse(body),
    retry: false
  })) {
    assert.equal(event.data, 'first');
    break;
  }
  assert.equal(cancelled, true);
});

test('client covers retry exhaustion, parser hooks and server retry timing', async () => {
  let failures = 0;
  await assert.rejects(
    collect(fetchSSE('x', {
      fetch: async () => {
        failures++;
        throw new TypeError('network down');
      },
      retry: { retries: 1, minDelay: 0, maxDelay: 0 }
    })),
    (error) => error instanceof SSERetryError && error.attempts === 2
  );
  assert.equal(failures, 2);

  const parserHooks = [];
  const retryHooks = [];
  let calls = 0;
  await collect(fetchSSE('x', {
    fetch: async () => {
      calls++;
      return calls === 1
        ? eventResponse('id: resume\nretry: 2\ndata: one\n\n')
        : new Response(null, { status: 204 });
    },
    decode: { onChunk: () => parserHooks.push('chunk') },
    parser: {
      onId: (id) => parserHooks.push(id),
      onRetry: (delay) => parserHooks.push(delay)
    },
    retry: { retries: 1, minDelay: 10, maxDelay: 10, jitter: false },
    onRetry(context) {
      retryHooks.push(context.delay);
      return 0;
    }
  }));
  assert.deepEqual(parserHooks, ['chunk', 2, 'resume']);
  assert.deepEqual(retryHooks, [2]);
});

test('client error hooks can stop retries or override their delay', async () => {
  let stoppedCalls = 0;
  await assert.rejects(
    collect(fetchSSE('x', {
      fetch: async () => {
        stoppedCalls++;
        throw new TypeError('offline');
      },
      onError: () => false,
      retry: 3
    })),
    /offline/
  );
  assert.equal(stoppedCalls, 1);

  const delays = [];
  let calls = 0;
  await collect(fetchSSE('x', {
    fetch: async () => {
      calls++;
      if (calls === 1) throw new TypeError('offline');
      return new Response(null, { status: 204 });
    },
    onError: () => 7,
    onRetry(context) {
      delays.push(context.delay);
      return 0;
    },
    retry: { retries: 1, minDelay: 100, maxDelay: 100, jitter: false }
  }));
  assert.deepEqual(delays, [7]);

  await assert.rejects(
    collect(fetchSSE('x', {
      fetch: async () => { throw new TypeError('offline'); },
      onError: () => { throw new Error('hook-broke'); },
      retry: 1
    })),
    { code: 'ERR_SSE_CALLBACK' }
  );
});

test('client handles Retry-After dates, malformed values and all header shapes', async () => {
  const observed = [];
  const date = new Date(Date.now() + 60_000).toUTCString();
  for (const retryAfter of [date, 'not-a-date']) {
    let calls = 0;
    await collect(fetchSSE('x', {
      fetch: async (_input, init) => {
        calls++;
        observed.push(headerValue(init, 'x-test'));
        if (calls === 1) {
          return new Response('busy', { status: 503, headers: { 'Retry-After': retryAfter } });
        }
        return new Response(null, { status: 204 });
      },
      headers: new Headers([['X-Test', retryAfter]]),
      retry: { retries: 1, minDelay: 9, maxDelay: 20, jitter: false },
      onRetry(context) {
        if (retryAfter === date) assert.equal(context.delay, 20);
        else assert.equal(context.delay, 9);
        return 0;
      }
    }));
  }
  assert.deepEqual(observed, [date, date, 'not-a-date', 'not-a-date']);

  let arrayHeader;
  await collect(fetchSSE('x', {
    fetch: async (_input, init) => {
      arrayHeader = headerValue(init, 'x-array');
      return new Response(null, { status: 204 });
    },
    headers: [['X-Array', 'yes']],
    retry: false
  }));
  assert.equal(arrayHeader, 'yes');
});

test('client validates retry math, callbacks, cloned requests and abort support', async () => {
  for (const retry of [
    { factor: 0 },
    { minDelay: -1 },
    { maxDelay: Infinity },
    { jitter: () => -1, retries: 1, minDelay: 1, maxDelay: 1 }
  ]) {
    const operation = collect(fetchSSE('x', {
      fetch: async () => { throw new TypeError('offline'); },
      retry
    }));
    await assert.rejects(operation, RangeError);
  }

  const closed = [];
  await collect(fetchSSE('x', {
    fetch: async () => new Response(null, { status: 204 }),
    onClose: (context) => closed.push(context.reason),
    retry: false
  }));
  assert.deepEqual(closed, ['server']);

  const stopped = await collect(fetchSSE('x', {
    fetch: async () => eventResponse('data: ignored\n\n'),
    onOpen: () => false,
    retry: false
  }));
  assert.deepEqual(stopped, []);

  let clones = 0;
  const requestLike = { clone() { clones++; return 'cloned'; } };
  await collect(fetchSSE(requestLike, {
    fetch: async (input) => {
      assert.equal(input, 'cloned');
      return new Response(null, { status: 204 });
    },
    retry: false
  }));
  assert.equal(clones, 1);

  const original = globalThis.AbortController;
  try {
    globalThis.AbortController = undefined;
    await assert.rejects(collect(fetchSSE('x', {
      fetch: async () => new Response(null, { status: 204 }),
      retry: false
    })), /AbortController/);
  } finally {
    globalThis.AbortController = original;
  }
});

test('fetchEventSource forwards legacy error and retry callbacks', async () => {
  const seen = [];
  let calls = 0;
  await fetchEventSource('x', {
    fetch: async () => {
      calls++;
      if (calls === 1) throw new TypeError('legacy-offline');
      return new Response(null, { status: 204 });
    },
    onerror(error) {
      seen.push(error.message);
      return 0;
    },
    onRetry(context) {
      seen.push(context.delay);
      return 0;
    },
    retry: { retries: 1, minDelay: 10, maxDelay: 10, jitter: false }
  });
  assert.deepEqual(seen, ['legacy-offline', 0]);
});

test('client delay waits are abortable and obey the total operation deadline', async () => {
  let calls = 0;
  await collect(fetchSSE('x', {
    fetch: async () => {
      calls++;
      if (calls === 1) throw new TypeError('short outage');
      return new Response(null, { status: 204 });
    },
    retry: { retries: 1, minDelay: 2, maxDelay: 2, jitter: false }
  }));
  assert.equal(calls, 2);

  const controller = new AbortController();
  const aborted = collect(fetchSSE('x', {
    fetch: async () => { throw new TypeError('offline'); },
    retry: { retries: 2, minDelay: 100, maxDelay: 100, jitter: false },
    signal: controller.signal
  }));
  setTimeout(() => controller.abort('plain-abort-reason'), 5);
  await assert.rejects(aborted, (error) => error.name === 'AbortError');

  await assert.rejects(
    collect(fetchSSE('x', {
      fetch: async () => { throw new TypeError('offline'); },
      retry: { retries: 2, minDelay: 50, maxDelay: 50, jitter: false },
      totalTimeout: 2
    })),
    (error) => error instanceof SSETimeoutError && error.phase === 'total'
  );
});

test('legacy compatibility uses modern error hooks and optional retry callbacks', async () => {
  let calls = 0;
  const errors = [];
  await fetchEventSource('x', {
    fetch: async () => {
      calls++;
      if (calls === 1) throw new TypeError('temporary');
      return new Response(null, { status: 204 });
    },
    onError(context) {
      errors.push(context.error.message);
      return 0;
    },
    retry: { retries: 1, minDelay: 0, maxDelay: 0, jitter: false }
  });
  assert.deepEqual(errors, ['temporary']);

  calls = 0;
  await fetchEventSource('x', {
    fetch: async () => {
      calls++;
      if (calls === 1) throw new TypeError('temporary-default');
      return new Response(null, { status: 204 });
    },
    retry: { retries: 1, minDelay: 0, maxDelay: 0, jitter: false }
  });
  assert.equal(calls, 2);
});

test('client accepts non-iterable Headers-like objects', async () => {
  const headersLike = {
    forEach(callback) {
      callback('custom-value', 'X-Custom');
    }
  };
  let captured;
  await collect(fetchSSE('x', {
    fetch: async (_input, init) => {
      captured = headerValue(init, 'x-custom');
      return new Response(null, { status: 204 });
    },
    headers: headersLike,
    retry: false
  }));
  assert.equal(captured, 'custom-value');
});

test('rejected HTTP bodies are cancelled even when cancellation itself fails', async () => {
  let cancelled = false;
  const response = {
    status: 503,
    headers: { get: () => '0' },
    body: {
      async cancel() {
        cancelled = true;
        throw new Error('transport already closed');
      }
    }
  };
  await assert.rejects(
    collect(fetchSSE('x', { fetch: async () => response, retry: false })),
    (error) => error instanceof SSEHTTPError && error.status === 503
  );
  assert.equal(cancelled, true);

  const synchronousFailure = {
    status: 503,
    headers: { get: () => '0' },
    body: {
      cancel() {
        throw new Error('synchronous close failure');
      }
    }
  };
  await assert.rejects(
    collect(fetchSSE('x', { fetch: async () => synchronousFailure, retry: false })),
    (error) => error instanceof SSEHTTPError && error.status === 503
  );
});
