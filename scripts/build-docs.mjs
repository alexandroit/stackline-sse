import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = new URL('../docs-site/', import.meta.url);
const output = new URL('../site-dist/', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await mkdir(new URL('assets/', output), { recursive: true });
await cp(new URL('dist/index.min.js', root), new URL('assets/stackline-sse.min.js', output));
await cp(new URL('README.md', root), new URL('reference.md', output));
await cp(new URL('docs/ARCHITECTURE.md', root), new URL('architecture.md', output));
await mkdir(new URL('guides/', output), { recursive: true });
await cp(new URL('docs/INTEGRATIONS.md', root), new URL('guides/integrations.md', output));
await cp(new URL('docs/BENCHMARKS.md', root), new URL('guides/benchmarks.md', output));
await cp(new URL('examples/', root), new URL('examples/', output), { recursive: true });

for (const file of ['index.html', 'app.js', 'llms.txt', 'llms-full.txt', 'sitemap.xml']) {
  const url = new URL(file, output);
  const contents = await readFile(url, 'utf8');
  await writeFile(url, contents.replaceAll('{{VERSION}}', packageJson.version), 'utf8');
}

await writeFile(new URL('version.json', output), `${JSON.stringify({
  name: packageJson.name,
  version: packageJson.version
}, null, 2)}\n`, 'utf8');
