# Compatibility

## JavaScript runtimes

Parser and encoder APIs require JavaScript ES2018 and `TextDecoder` only when
byte chunks are used. The declared Node.js floor is 14.17.

Fetch client requirements:

- `fetch` and `AbortController`;
- a response body exposed as Web Stream or async iterable.

Server helper requirements:

- `ReadableStream` and `TextEncoder`;
- `Response` when creating HTTP responses.

Node.js 14 and 16 users can inject a Fetch implementation. Parser and encoder
usage does not require a polyfill.

## TypeScript

CI compiles clean install fixtures with TypeScript 3.9.10, 4.7.4, 4.9.5,
5.9.3, 6.0.2, and 7.0.2. Declarations avoid requiring DOM library types by
using structural Fetch and Web Stream interfaces.

## eventsource-parser surface

Supported familiar fields:

- `createParser({ onEvent, onRetry, onComment, onError })`;
- `feed(chunk)` and `reset({ consume })`;
- `maxBufferSize` as an alias for the event limit;
- event `data`, `event`, and `id` fields.

Differences:

- byte chunks are accepted directly;
- security limits are enabled by default;
- `lastEventId` is included and ID-only blocks advance resume state;
- fatal limits throw immediately and terminate the parser.
- unknown fields and invalid retries call `onError` only with `strict: true`;
- `maxBufferSize` aliases the accumulated event limit, while line length has a
  separate `maxLineLength` limit.

## @microsoft/fetch-event-source surface

Supported callback names are `onopen`, `onmessage`, `onclose`, and `onerror`.
Fetch options, custom methods, headers, bodies, and custom Fetch functions pass
through. The package does not automatically disconnect when a document becomes
hidden, so `openWhenHidden` has no behavioral effect.

## Protocol limits

SSE is UTF-8 only. This package does not implement WebSocket framing, HTTP
server transports, compression, JSON schema validation, or provider-specific
AI event models.
