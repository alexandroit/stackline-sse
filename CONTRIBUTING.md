# Contributing

Contributions are welcome through focused issues and pull requests.

## Requirements

- Node.js 20.20 or newer for development;
- npm with lockfile support;
- no new runtime dependency without a documented architectural reason.

## Setup

```bash
npm ci
npm test
```

Useful commands:

```bash
npm run test:unit
npm run test:coverage
npm run test:types
npm run test:attw
npm run benchmark
npm run docs:serve
```

## Change expectations

- Preserve WHATWG parsing behavior unless a deviation is explicitly documented.
- Add a regression test for every bug fix.
- Exercise arbitrary chunk boundaries for parser changes.
- Preserve Node.js 14 parser and encoder compatibility.
- Keep callback failures from causing automatic event replay.
- Keep all externally controlled buffers bounded.
- Update README, changelog, types, and examples with public API changes.

Performance changes should include correctness assertions and benchmark output.
Benchmarks are evidence, not a substitute for tests.

## Commit and review scope

Keep commits narrow and do not reformat unrelated files. Pull requests should
describe behavior, compatibility impact, security impact, and verification.
