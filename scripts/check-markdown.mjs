import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'README.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'PROJECT_MEMORY.md',
  'SECURITY.md',
  'TODO.md',
  'docs/ARCHITECTURE.md',
  'docs/COMPATIBILITY.md',
  'docs/MARKET_RESEARCH.md',
  'docs/RELEASING.md'
];

for (const file of files) {
  const absolute = path.join(root, file);
  const source = await readFile(absolute, 'utf8');
  assert.ok(source.startsWith('# '), `${file} must start with one H1`);
  assert.ok(source.endsWith('\n'), `${file} must end with a newline`);
  assert.equal((source.match(/^# /gm) || []).length, 1, `${file} must have one H1`);
  assert.equal((source.match(/^```/gm) || []).length % 2, 0, `${file} has an unclosed code fence`);

  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    assert.equal(/[ \t]+$/.test(lines[index]), false, `${file}:${index + 1} has trailing whitespace`);
  }

  const links = source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const match of links) {
    const target = match[1].split('#', 1)[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    await access(path.resolve(path.dirname(absolute), decodeURIComponent(target)));
  }
}

console.log(`Markdown verification passed for ${files.length} files`);
