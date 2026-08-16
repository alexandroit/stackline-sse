import assert from 'node:assert/strict';
import test from 'node:test';

import { SSEParseError, createParser } from '../src/index.js';
import { byteChunks } from './helpers.mjs';

test('parser follows the normative WHATWG field and dispatch rules', () => {
  const events = [];
  const comments = [];
  const retries = [];
  const ids = [];
  const parser = createParser({
    onComment: (value) => comments.push(value),
    onEvent: (event) => events.push(event),
    onId: (id) => ids.push(id),
    onRetry: (delay) => retries.push(delay)
  });

  parser.feed([
    ': test stream',
    '',
    'data: first event',
    'id: 1',
    'retry: 1500',
    '',
    'data:second event',
    'id',
    '',
    'data:  third event',
    '',
    ''
  ].join('\n'));

  assert.deepEqual(comments, ['test stream']);
  assert.deepEqual(retries, [1500]);
  assert.deepEqual(ids, ['1', '']);
  assert.deepEqual(events, [
    { data: 'first event', event: undefined, id: '1', lastEventId: '1' },
    { data: 'second event', event: undefined, id: '', lastEventId: '' },
    { data: ' third event', event: undefined, id: undefined, lastEventId: '' }
  ]);
});

test('parser accepts LF, CR and CRLF even when pairs cross chunk boundaries', () => {
  const events = [];
  const parser = createParser((event) => events.push(event));
  for (const chunk of ['event: add\r', '\ndata: one\r', 'data: two\n', '\r', 'data: three\r\r']) {
    parser.feed(chunk);
  }
  assert.deepEqual(events.map(({ data, event }) => ({ data, event })), [
    { data: 'one\ntwo', event: 'add' },
    { data: 'three', event: undefined }
  ]);
});

test('byte parser preserves split UTF-8 sequences and strips one leading BOM', () => {
  const events = [];
  const parser = createParser({ onEvent: (event) => events.push(event) });
  for (const chunk of byteChunks('\ufeffdata: Olá 👋\n\n')) parser.feed(chunk);
  parser.end();
  assert.equal(events[0].data, 'Olá 👋');
  assert.equal(parser.state.bytes, new TextEncoder().encode('\ufeffdata: Olá 👋\n\n').length);
});

test('id-only blocks commit resume state and incomplete EOF data is discarded', () => {
  const events = [];
  const ids = [];
  const parser = createParser({
    lastEventId: 'before',
    onEvent: (event) => events.push(event),
    onId: (id) => ids.push(id)
  });
  parser.feed('id: checkpoint\n\ndata: complete\n\ndata: incomplete');
  parser.end();
  assert.deepEqual(ids, ['checkpoint']);
  assert.deepEqual(events, [
    { data: 'complete', event: undefined, id: undefined, lastEventId: 'checkpoint' }
  ]);
  assert.equal(parser.state.lastEventId, 'checkpoint');
});

test('empty data fields dispatch empty and newline-valued events', () => {
  const events = [];
  const parser = createParser({ onEvent: (event) => events.push(event) });
  parser.feed('data\n\ndata\ndata\n\ndata:\n\n');
  assert.deepEqual(events.map((event) => event.data), ['', '\n', '']);
});

test('strict parser reports recoverable unknown fields and invalid retries', () => {
  const errors = [];
  const parser = createParser({ strict: true, onError: (error) => errors.push(error) });
  parser.feed('Retry: 10\nretry: -1\nretry: 9999999999999999999999999\n\n');
  assert.deepEqual(errors.map((error) => error.code), [
    'ERR_SSE_UNKNOWN_FIELD',
    'ERR_SSE_RETRY_VALUE',
    'ERR_SSE_RETRY_VALUE'
  ]);
  assert.ok(errors.every((error) => error instanceof SSEParseError && !error.fatal));
});

test('parser ignores spec-defined invalid fields in permissive mode', () => {
  const errors = [];
  const events = [];
  createParser({ onError: (error) => errors.push(error), onEvent: (event) => events.push(event) })
    .feed('unknown: x\nretry: nope\nid: bad\0id\ndata: ok\n\n');
  assert.deepEqual(errors, []);
  assert.equal(events[0].data, 'ok');
  assert.equal(events[0].lastEventId, '');
});

test('line and event limits terminate safely and reset restores the parser', () => {
  const errors = [];
  const parser = createParser({
    maxEventSize: 12,
    maxLineLength: 10,
    onError: (error) => errors.push(error)
  });
  assert.throws(() => parser.feed(`data: ${'x'.repeat(20)}`), { code: 'ERR_SSE_LINE_LIMIT' });
  assert.equal(parser.state.terminated, true);
  assert.throws(() => parser.feed('data: x\n\n'), { code: 'ERR_SSE_TERMINATED' });
  parser.reset();
  assert.throws(
    () => parser.feed('data: 1234\ndata: 5678\ndata: 9012\n'),
    { code: 'ERR_SSE_EVENT_LIMIT' }
  );
  assert.deepEqual(errors.map((error) => error.code), [
    'ERR_SSE_LINE_LIMIT',
    'ERR_SSE_EVENT_LIMIT'
  ]);

  assert.throws(
    () => createParser({ maxLineLength: 6 }).feed('data: x\n\n'),
    { code: 'ERR_SSE_LINE_LIMIT' }
  );
  assert.throws(
    () => createParser({ maxLineLength: 6 }).feed('event: x\n'),
    { code: 'ERR_SSE_LINE_LIMIT' }
  );
});

test('fields without a colon follow the empty-value dispatch rules', () => {
  const errors = [];
  const events = [];
  createParser({
    strict: true,
    onError: (error) => errors.push(error),
    onEvent: (event) => events.push(event)
  }).feed('event\nretry\ndata: value\n\n');

  assert.equal(events[0].event, undefined);
  assert.equal(events[0].data, 'value');
  assert.deepEqual(errors.map((error) => error.code), ['ERR_SSE_RETRY_VALUE']);
});

test('parser validates configuration, chunk types and UTF-8 mode', () => {
  assert.throws(() => createParser(null), TypeError);
  assert.throws(() => createParser({ maxEventSize: 0 }), RangeError);
  assert.throws(() => createParser({ maxLineLength: 1.2 }), RangeError);
  assert.throws(() => createParser({ lastEventId: 'bad\nvalue' }), TypeError);

  const parser = createParser();
  assert.throws(() => parser.feed({}), TypeError);
  parser.feed('data: one');
  assert.throws(() => parser.feed(new Uint8Array()), { code: 'ERR_SSE_CHUNK_TYPE' });

  const bytes = createParser({ fatalUTF8: true });
  assert.throws(() => bytes.feed(Uint8Array.from([0xc3, 0x28])), { code: 'ERR_SSE_UTF8' });

  const reverseMixed = createParser();
  reverseMixed.feed(new Uint8Array());
  assert.throws(() => reverseMixed.feed(''), { code: 'ERR_SSE_CHUNK_TYPE' });

  const incomplete = createParser({ fatalUTF8: true });
  incomplete.feed(Uint8Array.from([0xc3]));
  assert.throws(() => incomplete.end(), { code: 'ERR_SSE_UTF8' });

  const original = globalThis.TextDecoder;
  try {
    globalThis.TextDecoder = undefined;
    assert.throws(() => createParser().feed(new Uint8Array()), { code: 'ERR_SSE_TEXT_DECODER' });
  } finally {
    globalThis.TextDecoder = original;
  }
});

test('parser supports maxBufferSize compatibility and consume reset mode', () => {
  const parser = createParser({ maxBufferSize: 8 });
  parser.feed('data: x');
  parser.reset({ consume: true });
  assert.equal(parser.state.buffered, 0);
  assert.throws(() => createParser({ lastEventId: 1 }), TypeError);
});

test('reset can preserve committed resume state and exposes immutable metrics', () => {
  const parser = createParser();
  parser.feed('id: 9\nretry: 20\n:ping\ndata: x\n\n');
  const state = parser.state;
  assert.deepEqual(state, {
    buffered: 0,
    bytes: 0,
    characters: 31,
    comments: 1,
    events: 1,
    lastEventId: '9',
    retries: 1,
    terminated: false
  });
  assert.throws(() => {
    state.events = 99;
  }, TypeError);
  parser.reset({ preserveLastEventId: true });
  assert.equal(parser.state.lastEventId, '9');
  parser.reset();
  assert.equal(parser.state.lastEventId, '');
});

test('parser is linear for a long line fragmented into one-character feeds', () => {
  const parser = createParser({ maxLineLength: 100_000, maxEventSize: 100_000 });
  const value = `data: ${'x'.repeat(80_000)}\n\n`;
  const started = performance.now();
  for (const character of value) parser.feed(character);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1500, `fragmented parse took ${elapsed.toFixed(1)}ms`);
  assert.equal(parser.state.events, 1);
});

test('deterministic differential fuzz matches a simple specification model', () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let run = 0; run < 5000; run++) {
    const blocks = [];
    const count = 1 + Math.floor(random() * 5);
    for (let index = 0; index < count; index++) {
      const lines = [];
      if (random() < 0.35) lines.push(`id: ${Math.floor(random() * 50)}`);
      if (random() < 0.4) lines.push(`event: type${Math.floor(random() * 4)}`);
      const dataLines = 1 + Math.floor(random() * 4);
      for (let data = 0; data < dataLines; data++) {
        lines.push(`data: value-${run}-${index}-${data}-${random() < 0.2 ? 'é' : 'x'}`);
      }
      blocks.push(lines);
    }
    const newline = ['\n', '\r', '\r\n'][Math.floor(random() * 3)];
    const text = `${blocks.map((lines) => lines.join(newline)).join(`${newline}${newline}`)}${newline}${newline}`;
    const expected = referenceParse(text);
    const actual = [];
    const parser = createParser({ onEvent: (event) => actual.push(event) });
    let offset = 0;
    while (offset < text.length) {
      const size = 1 + Math.floor(random() * 17);
      parser.feed(text.slice(offset, offset + size));
      offset += size;
    }
    assert.deepEqual(actual, expected);
  }
});

function referenceParse(input) {
  const lines = input.split(/\r\n|\r|\n/);
  const events = [];
  let data = [];
  let event;
  let id = '';
  let pendingId = false;
  for (const line of lines) {
    if (line === '') {
      if (data.length) events.push({ data: data.join('\n'), event, id: pendingId ? id : undefined, lastEventId: id });
      data = [];
      event = undefined;
      pendingId = false;
      continue;
    }
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value || undefined;
    else if (field === 'id' && !value.includes('\0')) {
      id = value;
      pendingId = true;
    }
  }
  return events;
}
