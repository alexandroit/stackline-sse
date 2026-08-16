# Project Memory

Last updated: 2026-08-16.

## Permanent rules

- Public package name: `@stackline/sse`.
- Repository: `https://github.com/alexandroit/stackline-sse`.
- Only the `main` branch is used.
- License: MIT.
- Preserve zero runtime dependencies.
- Preserve Node.js 14.17 parser and encoder compatibility.
- Preserve TypeScript 3.9 compatibility.
- Never publish rebuilt bytes after a registry has received a release artifact.
- Publish one retained CI-verified tarball to Verdaccio and public npm.
- Deploy documentation only to `/docs/vanilla/sse/` until the central staging mirror is repaired.
- Do not claim download forecasts as guarantees.

## Product decision

The package addresses fragmented Server-Sent Events infrastructure for AI
streaming and real-time applications. It combines parser, iterable adapters,
encoder, resilient Fetch client, and server Response helpers.

Fixed-window npm research for 2026-07-17 through 2026-08-15 measured
455,878,870 combined downloads across six related packages, up 13.27% from the
prior fixed 30-day window. This is package activity with overlap, not unique
users. Full evidence is in `docs/MARKET_RESEARCH.md`.

## Architecture invariants

- LF fast path and complete CR/CRLF path must produce identical events.
- One-character input fragmentation must remain linear.
- ID-only blocks commit resume state.
- `id` means the field in the current block; `lastEventId` means committed state.
- Incomplete EOF events are discarded.
- Parser line, event, and admitted callback queue memory are bounded by default.
- Callback failures are never retried as network failures.
- Rejected HTTP response bodies are cancelled.
- Late HTTP responses are cancelled and non-cooperative adapters cannot hold timeouts open.
- Request input headers survive SSE header negotiation unless explicitly replaced.
- Streaming request bodies require `bodyFactory` before reconnect.
- Encoder IDs reject NUL, CR, and LF; event names reject CR and LF.
- Server push APIs expose backpressure and release waiters on close or error.

## Current validation baseline

- 69 runtime test groups plus package and clean-install tests.
- 5,000 deterministic differential parser cases.
- 25,000-event bounded queue regression.
- 100% statements, lines, and functions; branch coverage above 95%.
- ESM, CommonJS, and browser outputs.
- Direct and npm-alias clean installs.
- TypeScript 3.9 through 7 release matrix passed.
- Node.js 14.17 through 24, Windows, macOS, Linux, Deno 1 and 2, and Bun passed.
- Browser bundle is 25,668 bytes after release hardening, gated below 27 kB.
- npm audit reports zero known dependency vulnerabilities.
- Public-registry direct, ESM, CommonJS, and both migration-alias installs passed.
- npm verified registry signatures for all three installed package aliases.

## Benchmark baseline

On the development host, the latest LF document benchmark processed
approximately 7.9 million events per second after warmup. The benchmark is
comparative evidence only and varies by hardware and Node.js version.

## Release state

Version 1.0.0 was released on 2026-08-16 from commit
`9339879bc5dc8a473f3e758f380e0b325f00c473` and annotated tag `v1.0.0`.

- CI run: `31967565374`, all jobs passed.
- CodeQL run: `31967565441`, passed.
- Retained artifact: `/storage/data/releases/stackline-sse/1.0.0-ci-31967565374/`.
- npm tarball SHA-512: `e289d8e8200f5a066c60ebeb5e8db80eb1f413a91c224fcc7b51f24b9066b4d50bdc538afb5353532c206dcd4e749eeb17a60684d96281f3519120d6c55e2239`.
- npm integrity: `sha512-4onY6CAPWgZsYOvrXo24DrH0E6kcIk/Me1HyS5BmtNUL3FOK+1NTUywgbc1OdJ7rF6YGhNligfNRkSDWxV4iOQ==`.
- Registry shasum: `480e5d9e94d675970aba1abbd03392f56a67b20f`.
- The CI, local rebuild, Verdaccio download, and public npm download are byte-identical.
- Verdaccio and public npm expose `1.0.0` as `latest` with public access.
- GitHub release: `https://github.com/alexandroit/stackline-sse/releases/tag/v1.0.0`.
- Production docs: `https://alexandro.net/docs/vanilla/sse/`.
- Production verification: HTTP 200, exact deployed HTML hash, working parser and encoder playgrounds, no browser console errors, and no desktop or mobile overflow.
- The central docs config, vanilla index, project sitemap, and aggregate `/docs/sitemap.xml` include the package.
