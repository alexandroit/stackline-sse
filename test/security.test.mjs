import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SSEError,
  SSEHTTPError,
  SSEParseError,
  SSERetryError,
  createParser,
  decodeSSE,
  encodeSSE,
  fetchSSE
} from '../src/index.js';
import { collect, eventResponse, headerValue } from './helpers.mjs';

test('malicious header keys cannot pollute object prototypes', async () => {
  delete Object.prototype.polluted;
  const headers = JSON.parse('{"__proto__":"polluted","constructor":"value","Accept":"text/event-stream"}');
  let captured;
  await collect(fetchSSE('x', {
    fetch: async (_input, init) => {
      captured = init.headers;
      return eventResponse('data: safe\n\n');
    },
    headers,
    retry: false
  }));
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(headerValue({ headers: captured }, '__proto__'), 'polluted');
  assert.equal(headerValue({ headers: captured }, 'constructor'), 'value');
});

test('encoder rejects CRLF and NUL injection across every control field', () => {
  const attacks = [
    { id: '1\ndata: owned', data: 'safe' },
    { id: '1\rretry: 0', data: 'safe' },
    { id: '1\0hidden', data: 'safe' },
    { event: 'message\ndata: owned', data: 'safe' }
  ];
  for (const attack of attacks) assert.throws(() => encodeSSE(attack), { code: 'ERR_SSE_ENCODE' });
});

test('default parser limits bound unterminated line and event memory', () => {
  const line = createParser();
  assert.throws(
    () => line.feed(`data: ${'x'.repeat(1024 * 1024 + 1)}`),
    { code: 'ERR_SSE_LINE_LIMIT' }
  );

  const event = createParser();
  const dataLine = `data: ${'x'.repeat(60 * 1024)}\n`;
  assert.throws(() => {
    for (let index = 0; index < 20; index++) event.feed(dataLine);
  }, { code: 'ERR_SSE_EVENT_LIMIT' });
  assert.ok(event.state.buffered <= 1024 * 1024);
});

test('bounded feeder handles high-cardinality input without an unbounded queue', async () => {
  const count = 25_000;
  const input = 'data: x\n\n'.repeat(count);
  let seen = 0;
  for await (const event of decodeSSE([input])) {
    assert.equal(event.data, 'x');
    seen++;
  }
  assert.equal(seen, count);
});

test('large malformed input remains linear under adversarial fragmentation', () => {
  const parser = createParser({ maxLineLength: 300_000, maxEventSize: 300_000 });
  const input = `data: ${'a'.repeat(250_000)}\n\n`;
  const start = performance.now();
  for (let index = 0; index < input.length; index += 3) parser.feed(input.slice(index, index + 3));
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 2000, `adversarial parse took ${elapsed.toFixed(1)}ms`);
  assert.equal(parser.state.events, 1);
});

test('resume IDs are validated before becoming HTTP headers', async () => {
  for (const value of ['line\nfeed', 'carriage\rreturn', 'null\0byte']) {
    await assert.rejects(
      collect(fetchSSE('x', {
        fetch: async () => eventResponse(''),
        lastEventId: value,
        retry: false
      })),
      TypeError
    );
  }
});

test('replay analysis accepts standard reusable body types', async () => {
  const bodies = [
    'text',
    new Uint8Array([1]),
    new ArrayBuffer(1),
    new URLSearchParams('a=1'),
    new Blob(['x']),
    new FormData()
  ];
  for (const body of bodies) {
    await collect(fetchSSE('x', {
      body,
      fetch: async () => new Response(null, { status: 204 }),
      retry: false
    }));
  }
});

test('error classes retain stable codes, names and optional context', () => {
  const base = new SSEError('base', 'ERR_BASE');
  assert.equal(base.name, 'SSEError');
  assert.equal(base.cause, undefined);

  const parsed = new SSEParseError('parsed', {
    field: 'data',
    line: 'data: x',
    limit: 10
  });
  assert.equal(parsed.code, 'ERR_SSE_PARSE');
  assert.equal(parsed.field, 'data');
  assert.equal(parsed.line, 'data: x');
  assert.equal(parsed.limit, 10);

  assert.equal(new SSEHTTPError('none', null).status, 0);
  assert.match(new SSERetryError(1).message, /1 attempt$/);
});
