import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';

const output = new URL('../site-dist/', import.meta.url);
const required = [
  'index.html',
  'app.js',
  'styles.css',
  'assets/stream-network.webp',
  'assets/stackline-sse.min.js',
  'reference.md',
  'architecture.md',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'llms-full.txt',
  'version.json'
];

for (const file of required) await access(new URL(file, output));

const html = await readFile(new URL('index.html', output), 'utf8');
const app = await readFile(new URL('app.js', output), 'utf8');
const styles = await readFile(new URL('styles.css', output), 'utf8');
const robots = await readFile(new URL('robots.txt', output), 'utf8');
const sitemap = await readFile(new URL('sitemap.xml', output), 'utf8');
const llms = await readFile(new URL('llms.txt', output), 'utf8');
const bundle = await stat(new URL('assets/stackline-sse.min.js', output));

assert.match(html, /<link rel="canonical" href="https:\/\/alexandro\.net\/docs\/vanilla\/sse\/">/);
assert.match(html, /<meta name="description"/);
assert.match(html, /id="playground"/);
assert.match(html, /application\/ld\+json/);
assert.match(app, /StacklineSSE\.createParser/);
assert.match(styles, /\[hidden\][\s\S]*display: none !important/);
assert.match(robots, /Allow: \/docs\/vanilla\/sse\//);
assert.match(sitemap, /https:\/\/alexandro\.net\/docs\/vanilla\/sse\//);
assert.match(llms, /@stackline\/sse/);
assert.doesNotMatch(html, /{{VERSION}}/);
assert.doesNotMatch(app, /{{VERSION}}/);
assert.ok(bundle.size < 27_000, `browser bundle is ${bundle.size} bytes`);

console.log(JSON.stringify({ browserBytes: bundle.size, documentation: true }));
