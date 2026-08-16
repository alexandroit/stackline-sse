# Changelog

All notable changes are documented in this file.

## [1.0.0] - 2026-08-16

### Added

- WHATWG-compatible incremental SSE parser for strings and UTF-8 bytes.
- Pull-based decoding for Response, Web Stream, async iterable, and iterable sources.
- JSON event decoding with optional completion sentinel support.
- Injection-resistant text and JSON encoders.
- Fetch client with resume IDs, retry policy, jitter, Retry-After, and timeouts.
- Callback compatibility for `eventsource-parser` and `@microsoft/fetch-event-source` migrations.
- Backpressure-aware server channel and async-iterable Response helper.
- Default line, event, and callback queue limits.
- ESM, CommonJS, browser, and TypeScript declarations.
- Cross-runtime CI, security tests, deterministic fuzzing, and release artifacts.
- Abort-safe custom Fetch, body factories, and async iterators, including late-response cleanup.
- Request header preservation when adding SSE negotiation and resume headers.

[1.0.0]: https://github.com/alexandroit/stackline-sse/releases/tag/v1.0.0
