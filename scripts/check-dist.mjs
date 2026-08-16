import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, readFile, stat } from 'node:fs/promises';

import esmDefault, * as esm from '../dist/index.js';

const require = createRequire(import.meta.url);
const commonjs = require('../dist/index.cjs');
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);

assert.equal(Object.keys(packageJson.dependencies || {}).length, 0);
assert.equal(typeof commonjs.createParser, 'function');
assert.equal(typeof commonjs.fetchSSE, 'function');
assert.equal(typeof commonjs.createSSEChannel, 'function');
assert.equal(commonjs.EVENT_STREAM_CONTENT_TYPE, 'text/event-stream');
assert.equal(esmDefault.createParser, esm.createParser);
assert.equal(esmDefault.fetchSSE, esm.fetchSSE);

const cjsEvents = [];
commonjs.createParser({ onEvent: (event) => cjsEvents.push(event) })
  .feed('id: 1\ndata: cjs\n\n');
const esmEvents = [];
esm.createParser({ onEvent: (event) => esmEvents.push(event) })
  .feed('id: 1\ndata: cjs\n\n');
assert.deepEqual(cjsEvents, esmEvents);
assert.equal(commonjs.encodeSSE({ data: 'ok' }), esm.encodeSSE({ data: 'ok' }));

for (const file of [
  'index.cjs',
  'index.cjs.map',
  'index.d.cts',
  'index.d.mts',
  'index.d.ts',
  'index.js',
  'index.js.map',
  'index.min.js',
  'index.min.js.map'
]) {
  await access(new URL(`../dist/${file}`, import.meta.url));
}

const minified = await stat(new URL('../dist/index.min.js', import.meta.url));
assert.ok(minified.size < 27000, `minified bundle is ${minified.size} bytes`);

console.log(JSON.stringify({
  browserBytes: minified.size,
  cjs: true,
  esm: true,
  runtimeDependencies: 0,
  version: packageJson.version
}));
