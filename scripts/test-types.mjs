import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = process.argv[2] || process.env.TYPESCRIPT_VERSION || packageJson.devDependencies.typescript;
const [major, minor = 0] = version.split('.').map(Number);
const work = await mkdtemp(path.join(os.tmpdir(), 'stackline-sse-types-'));
const packDirectory = path.join(work, 'pack');
const appDirectory = path.join(work, 'app');

try {
  await mkdir(packDirectory);
  await mkdir(appDirectory);
  const packOutput = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory], root);
  const [{ filename }] = JSON.parse(packOutput);
  run('npm', ['init', '--yes'], appDirectory);
  run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund',
    `typescript@${version}`, path.join(packDirectory, filename)
  ], appDirectory);

  await writeFile(path.join(appDirectory, 'common.ts'), commonSource(), 'utf8');
  const files = ['common.ts'];
  if (major > 4 || (major === 4 && minor >= 7)) {
    await writeFile(path.join(appDirectory, 'module.mts'), moduleSource(), 'utf8');
    files.push('module.mts');
  }
  const modern = files.includes('module.mts');
  await writeFile(path.join(appDirectory, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      esModuleInterop: true,
      lib: ['ES2020'],
      module: modern ? 'Node16' : 'commonjs',
      moduleResolution: modern ? 'Node16' : 'node',
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: 'ES2018'
    },
    files
  }, null, 2)}\n`, 'utf8');
  run(path.join(appDirectory, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], appDirectory);
  console.log(`TypeScript ${version} package compatibility passed`);
} finally {
  if (!process.env.KEEP_TYPES_TEST) await rm(work, { force: true, recursive: true });
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

function commonSource() {
  return `
import sse = require('@stackline/sse');

const parserOptions: sse.SSEParserOptions = {
  maxEventSize: 1024,
  onEvent(event) {
    const data: string = event.data;
    void data;
  }
};
const parser: sse.SSEParser = sse.createParser(parserOptions);
parser.feed('data: typed\\n\\n');
const encoded: string = sse.encodeSSE({data: 'typed', id: '1'});
const client: AsyncGenerator<sse.SSEEvent, void, unknown> = sse.fetchSSE('https://example.test', {
  retry: {retries: 2, jitter: false},
  fetch: async () => ({status: 204, headers: {get: () => null}, body: null})
});
const error: sse.SSEError = new sse.SSEParseError('bad');
void [encoded, client, error];
`;
}

function moduleSource() {
  return `
import api, {
  SSETimeoutError,
  consumeSSE,
  createParser,
  decodeJSON,
  encodeJSON,
  fetchSSE,
  type SSEEvent,
  type SSEFetchOptions
} from '@stackline/sse';

const options: SSEFetchOptions = {retry: false, connectTimeout: 1000};
const withBodyFactory: SSEFetchOptions = {
  bodyFactory({signal}) {
    const aborted: boolean = signal.aborted;
    return String(aborted);
  }
};
const stream = fetchSSE('https://example.test', options);
const parsed = decodeJSON<{value: number}>(['data: {"value":1}\\n\\n']);
const parser = createParser((event: SSEEvent) => void event.data);
const json: string = encodeJSON({ok: true});
const summary = consumeSSE('https://example.test', options);
const timeout = new SSETimeoutError('connect', 10);
void [api, stream, parsed, parser, json, summary, timeout, withBodyFactory];
`;
}
