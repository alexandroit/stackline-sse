import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import api, * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);

test('ESM and CommonJS expose the same public behavior', () => {
  const cjs = require('../dist/index.cjs');
  assert.equal(api.createParser, esm.createParser);
  assert.equal(cjs.default.createParser, cjs.createParser);
  assert.equal(cjs.EVENT_STREAM_CONTENT_TYPE, esm.EVENT_STREAM_CONTENT_TYPE);
  assert.equal(cjs.encodeSSE({ data: 'same' }), esm.encodeSSE({ data: 'same' }));
  const left = [];
  const right = [];
  cjs.createParser({ onEvent: (event) => left.push(event) }).feed('data: one\n\n');
  esm.createParser({ onEvent: (event) => right.push(event) }).feed('data: one\n\n');
  assert.deepEqual(left, right);
});

test('browser bundle exposes a usable global without Node built-ins', async () => {
  const source = await readFile(new URL('../dist/index.min.js', import.meta.url), 'utf8');
  const context = {
    AbortController,
    ArrayBuffer,
    Blob,
    FormData,
    Headers,
    Map,
    Math,
    Promise,
    ReadableStream,
    Response,
    Set,
    TextDecoder,
    TextEncoder,
    TransformStream,
    URLSearchParams,
    Uint8Array,
    clearInterval,
    clearTimeout,
    console,
    globalThis: null,
    performance,
    setInterval,
    setTimeout
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  assert.equal(typeof context.StacklineSSE.createParser, 'function');
  assert.equal(context.StacklineSSE.encodeSSE({ data: 'browser' }), 'data: browser\n\n');
});

test('package metadata promises a public zero-dependency portable package', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.name, '@stackline/sse');
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.sideEffects, false);
  assert.equal(Object.keys(packageJson.dependencies || {}).length, 0);
  assert.equal(packageJson.engines.node, '>=14.17.0');
  assert.ok(packageJson.exports['.'].require);
  assert.ok(packageJson.exports['.'].import);
  assert.ok(packageJson.files.includes('LICENSE'));
});
