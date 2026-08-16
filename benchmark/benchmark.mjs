import { performance } from 'node:perf_hooks';

import { createParser as createReferenceParser } from 'eventsource-parser';
import { createParser, encodeSSE } from '../dist/index.js';

const eventCount = 50_000;
const document = Array.from(
  { length: eventCount },
  (_, index) => `id: ${index}\nevent: delta\ndata: {"token":"value-${index}"}\n\n`
).join('');
const chunks = [];
for (let offset = 0; offset < document.length; offset += 16 * 1024) {
  chunks.push(document.slice(offset, offset + 16 * 1024));
}

const results = {
  parserDocument: benchmark('document', 8, () => parseStackline([document])),
  parserDocumentReference: benchmark('document-reference', 8, () => parseReference([document])),
  parserChunks16KiB: benchmark('chunks', 8, () => parseStackline(chunks)),
  parserChunks16KiBReference: benchmark('chunks-reference', 8, () => parseReference(chunks)),
  encoder: benchmark('encoder', 4, () => {
    let bytes = 0;
    for (let index = 0; index < eventCount; index++) {
      bytes += encodeSSE({ id: index, event: 'delta', data: `value-${index}` }).length;
    }
    return bytes;
  })
};

const fragmented = `data: ${'x'.repeat(200_000)}\n\n`;
const fragmentedStart = performance.now();
let fragmentedEvents = 0;
const fragmentedParser = createParser({
  maxEventSize: 300_000,
  maxLineLength: 300_000,
  onEvent: () => fragmentedEvents++
});
for (const character of fragmented) fragmentedParser.feed(character);
const fragmentedMs = performance.now() - fragmentedStart;

console.log(JSON.stringify({
  eventCount,
  inputBytes: Buffer.byteLength(document),
  results,
  adversarialOneCharacterChunks: {
    characters: fragmented.length,
    events: fragmentedEvents,
    milliseconds: Number(fragmentedMs.toFixed(2))
  }
}, null, 2));

function parseStackline(input) {
  let count = 0;
  const parser = createParser({
    maxEventSize: 1024 * 1024,
    maxLineLength: 1024 * 1024,
    onEvent: () => count++
  });
  for (const chunk of input) parser.feed(chunk);
  if (count !== eventCount) throw new Error(`Stackline parsed ${count} events`);
  return count;
}

function parseReference(input) {
  let count = 0;
  const parser = createReferenceParser({ onEvent: () => count++ });
  for (const chunk of input) parser.feed(chunk);
  if (count !== eventCount) throw new Error(`Reference parsed ${count} events`);
  return count;
}

function benchmark(_name, iterations, operation) {
  for (let index = 0; index < 2; index++) operation();
  const started = performance.now();
  let result;
  for (let index = 0; index < iterations; index++) result = operation();
  const elapsed = performance.now() - started;
  return {
    iterations,
    milliseconds: Number(elapsed.toFixed(2)),
    operationsPerSecond: Math.round((iterations * 1000) / elapsed),
    result
  };
}
