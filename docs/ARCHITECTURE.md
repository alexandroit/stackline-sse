# Architecture

## Goals

`@stackline/sse` treats SSE as one protocol with five composable surfaces:

1. incremental wire parser;
2. async iterable and TransformStream adapters;
3. injection-resistant encoder;
4. reconnecting Fetch client;
5. backpressure-aware server output.

The runtime has no package dependencies and no Node-specific imports.

## Parser state machine

The parser stores line fragments rather than repeatedly concatenating an
unterminated line. This keeps one-character chunk fragmentation linear. LF-only
input uses an `indexOf` fast path; CR and CRLF use the complete state machine.

State is separated into:

- pending line fragments;
- current data lines and event type;
- pending ID field;
- committed `lastEventId`;
- counters and configured limits.

An ID is committed at a blank line even if the block has no data. Incomplete
EOF data is discarded as required by the WHATWG algorithm.

## Backpressure

`decodeSSE` reads one source chunk only when the consumer advances its async
iterator. Large source chunks are admitted in 16 KiB slices and callback bursts
are bounded. The server iterable helper asks its source for one item per stream
pull. Push channels expose `send(): boolean` and `ready`.

## Client lifecycle

Each connection attempt owns an AbortController. External cancellation,
connect timeout, idle timeout, and total timeout converge on that controller.
Rejected response bodies are cancelled before retry. A user callback failure is
wrapped as `ERR_SSE_CALLBACK` and is never classified as a network failure.
Custom Fetch implementations, body factories, and iterators are raced against
the attempt signal so a non-cooperative adapter cannot hold a timeout open. A
response that resolves after timeout is cancelled on arrival.

Resume state is advanced only by committed parser IDs. Retry delay precedence
is HTTP `Retry-After`, server `retry:`, then client exponential backoff.

Streaming request bodies are not replayed. Applications can provide a
`bodyFactory` to create one body per attempt; the factory receives the attempt
signal. Headers from a Request input are preserved unless explicitly replaced.

## Encoder boundary

Data and comments can span lines and are encoded one field per line. Event names
cannot contain CR or LF. IDs also cannot contain NUL, matching the value space
of `Last-Event-ID`. These checks prevent field and header injection.

## Build outputs

One source graph produces:

- `dist/index.js` for ESM;
- `dist/index.cjs` for CommonJS;
- `dist/index.min.js` for browser globals;
- declarations for old and conditional-export-aware TypeScript versions.

All outputs are generated from the same commit and packed once for release.
