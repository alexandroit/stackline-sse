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
- TypeScript 3.9 through 7 matrix prepared.
- Node.js 14 through 24, Windows, macOS, Linux, Deno, and Bun CI prepared.
- Browser bundle is 25,668 bytes after release hardening, gated below 27 kB.
- npm audit currently reports zero known dependency vulnerabilities.

## Benchmark baseline

On the development host, the latest LF document benchmark processed
approximately 7.9 million events per second after warmup. The benchmark is
comparative evidence only and varies by hardware and Node.js version.

## Release state

Version 1.0.0 is implemented but this memory section must be updated with the
final commit, CI run IDs, artifact checksums, registry integrity, release URL,
and production documentation verification after publication.

## Release TODO

- Complete all local gates from a clean lockfile install.
- Create and push the public GitHub repository.
- Wait for CI and CodeQL.
- Retain the CI artifact and verify a byte-identical local rebuild.
- Publish exact bytes to Verdaccio, verify, then public npm, verify.
- Create GitHub release with checksum and SBOM.
- Deploy and visually verify public documentation.
