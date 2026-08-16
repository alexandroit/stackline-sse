import {
  createParser,
  decodeJSON,
  encodeJSON,
  encodeSSE
} from '../src/index.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const events = [];
const parser = createParser({ onEvent: (event) => events.push(event) });
const bytes = new TextEncoder().encode('id: portable\ndata: Olá\n\n');
parser.feed(bytes.slice(0, 9));
parser.feed(bytes.slice(9));
parser.end();

assert(events.length === 1, 'expected one parsed event');
assert(events[0].data === 'Olá', 'expected split UTF-8 to decode');
assert(events[0].lastEventId === 'portable', 'expected resume ID');
assert(encodeSSE({ data: 'ok' }) === 'data: ok\n\n', 'expected SSE encoding');
assert(encodeJSON({ ok: true }) === 'data: {"ok":true}\n\n', 'expected JSON encoding');

const decoded = [];
for await (const event of decodeJSON(['data: {"value":7}\n\n'])) decoded.push(event.data);
assert(decoded[0].value === 7, 'expected JSON async iteration');

console.log('Portable runtime smoke passed');
