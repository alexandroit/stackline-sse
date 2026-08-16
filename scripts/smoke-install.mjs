import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.platform === 'win32'
  ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : null;
const work = await mkdtemp(path.join(os.tmpdir(), 'stackline-sse-install-'));

try {
  const tarball = process.argv[2]
    ? await resolveTarball(process.argv[2])
    : await createTarball(path.join(work, 'artifact'));
  await smokeDirect(tarball, path.join(work, 'direct'));
  await smokeAliases(tarball, path.join(work, 'aliases'));
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  console.log(`${packageJson.name}@${packageJson.version} clean-install smoke passed on ${process.version}`);
} finally {
  if (!process.env.KEEP_INSTALL_TEST) await rm(work, { force: true, recursive: true });
}

async function resolveTarball(input) {
  const resolved = path.resolve(input);
  const info = await stat(resolved);
  if (info.isFile()) return resolved;
  const tarballs = (await readdir(resolved)).filter((entry) => entry.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`Expected one tarball in ${resolved}; found ${tarballs.length}`);
  return path.join(resolved, tarballs[0]);
}

async function createTarball(directory) {
  await mkdir(directory, { recursive: true });
  const output = runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root);
  const [{ filename }] = JSON.parse(output);
  return path.join(directory, filename);
}

async function smokeDirect(tarball, directory) {
  await prepare(directory, { '@stackline/sse': `file:${tarball}` });
  await writeFile(path.join(directory, 'smoke.cjs'), `'use strict';
const assert = require('assert');
const sse = require('@stackline/sse');
const events = [];
sse.createParser({onEvent: event => events.push(event)}).feed('id: 1\\ndata: cjs\\n\\n');
assert.strictEqual(events[0].data, 'cjs');
assert.strictEqual(events[0].lastEventId, '1');
assert.strictEqual(sse.encodeSSE({data: 'ok'}), 'data: ok\\n\\n');
assert.strictEqual(sse.default.createParser, sse.createParser);
`, 'utf8');
  await writeFile(path.join(directory, 'smoke.mjs'), `import assert from 'assert';
import api, {createParser, decodeSSE, encodeJSON} from '@stackline/sse';
const events = [];
for await (const event of decodeSSE(['data: esm\\n\\n'])) events.push(event);
assert.strictEqual(events[0].data, 'esm');
assert.strictEqual(encodeJSON({ok: true}), 'data: {"ok":true}\\n\\n');
assert.strictEqual(api.createParser, createParser);
`, 'utf8');
  run(process.execPath, ['smoke.cjs'], directory);
  run(process.execPath, ['smoke.mjs'], directory);
  if (!process.env.SKIP_INSTALL_AUDIT) runNpm(['audit', '--omit=dev', '--audit-level=high'], directory);
}

async function smokeAliases(tarball, directory) {
  await prepare(directory, {
    'eventsource-parser': `file:${tarball}`,
    '@microsoft/fetch-event-source': `file:${tarball}`
  });
  await writeFile(path.join(directory, 'smoke.mjs'), `import assert from 'assert';
import {createParser} from 'eventsource-parser';
import {fetchEventSource} from '@microsoft/fetch-event-source';
const events = [];
createParser({onEvent: event => events.push(event)}).feed('data: alias\\n\\n');
assert.strictEqual(events[0].data, 'alias');
assert.strictEqual(typeof fetchEventSource, 'function');
`, 'utf8');
  run(process.execPath, ['smoke.mjs'], directory);
}

async function prepare(directory, dependencies) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ private: true, dependencies }, null, 2)}\n`,
    'utf8'
  );
  runNpm(['install', '--ignore-scripts', '--no-fund'], directory);
}

function runNpm(args, cwd) {
  return npmCli ? run(process.execPath, [npmCli, ...args], cwd) : run('npm', args, cwd);
}

function run(command, args, cwd) {
  const env = { ...process.env, npm_config_loglevel: 'error' };
  delete env.npm_config_dry_run;
  delete env.NPM_CONFIG_DRY_RUN;
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
