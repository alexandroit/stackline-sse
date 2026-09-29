# @stackline/sse

> Universal, spec-correct and memory-safe Server-Sent Events toolkit for AI streaming, browsers, servers and edge runtimes.

[![npm version](https://img.shields.io/npm/v/@stackline/sse.svg?style=flat-square)](https://www.npmjs.com/package/@stackline/sse)
[![license](https://img.shields.io/npm/l/@stackline/sse.svg?style=flat-square)](https://github.com/alexandroit/stackline-sse)
[![GitHub repository](https://img.shields.io/badge/GitHub-repository-181717?style=flat-square&logo=github)](https://github.com/alexandroit/stackline-sse)
[![Docs](https://img.shields.io/badge/docs-alexandro.net-0f766e?style=flat-square)](https://alexandro.net/docs/vanilla/sse/)
[![Reddit community](https://img.shields.io/badge/community-r%2FStackline-ff4500?style=flat-square&logo=reddit&logoColor=white)](https://www.reddit.com/r/Stackline/)

**[Documentation](https://alexandro.net/docs/vanilla/sse/)** | **[npm](https://www.npmjs.com/package/@stackline/sse)** | **[Issues](https://github.com/alexandroit/stackline-sse/issues)** | **[Repository](https://github.com/alexandroit/stackline-sse)**

**Current package version:** `1.0.4`

---

## Why this package?

One zero-dependency toolkit for consuming, parsing, encoding, serving, and
reconnecting Server-Sent Events. It is designed for AI token streams, live
interfaces, serverless runtimes, browsers, and Node.js services.

<a id="why-this-package"></a>

### Why this package

SSE projects commonly combine one parser package, another encoder, a stale
fetch wrapper, and custom server code. `@stackline/sse` gives those layers one
consistent contract:

- WHATWG-compatible incremental parsing of strings and UTF-8 bytes;
- pull-based async iteration with real stream backpressure;
- `fetch` streaming with POST, auth headers, retries, timeouts, and resume IDs;
- safe event encoding that rejects CRLF and `Last-Event-ID` injection;
- Web Stream and `Response` helpers for edge and server runtimes;
- bounded line, event, and callback queues by default;
- ESM, CommonJS, browser global, TypeScript 3.9 through 7, Deno, and Bun;
- zero runtime dependencies.

## Compatibility

| Item | Value |
| --- | --- |
| Package | `@stackline/sse@1.0.4` |
| Node.js runtime | `>=14.17.0` |
| CommonJS / primary entry | `./dist/index.cjs` |
| ES module entry | `./dist/index.js` |
| Type declarations | `./dist/index.d.ts` |

<a id="runtime-matrix"></a>

### Runtime matrix

| Runtime | Parser / encoder | Fetch client | Server helpers |
| --- | --- | --- | --- |
| Modern browsers | Yes | Yes | Yes |
| Node.js 18+ | Yes | Yes | Yes |
| Node.js 14 / 16 | Yes | Inject `fetch` | Inject Web Streams if needed |
| Deno 2 | Yes | Yes | Yes |
| Bun | Yes | Yes | Yes |
| Cloudflare Workers | Yes | Yes | Yes |

The package ships ESM, CommonJS, a browser IIFE, and declarations tested with
TypeScript 3.9, 4.7, 4.9, 5.x, 6.x, and 7.x.

## Installation

```sh
npm install @stackline/sse
```

## Usage

```bash
npm install @stackline/sse
```

<a id="parse-any-stream"></a>

### Parse any stream

#### Async iterator

```js
import { decodeSSE } from '@stackline/sse';

const response = await fetch('/events');

for await (const event of decodeSSE(response)) {
  console.log(event.event, event.data, event.lastEventId);
}
```

The source can be a `Response`, `ReadableStream`, `AsyncIterable`, or ordinary
`Iterable` of `string` and `Uint8Array` chunks.

#### Incremental callback parser

```js
import { createParser } from '@stackline/sse';

const parser = createParser({
  onEvent(event) {
    console.log(event.data);
  },
  onRetry(milliseconds) {
    console.log('Server retry interval:', milliseconds);
  }
});

parser.feed('id: 7\ndata: first chunk\n');
parser.feed('data: second chunk\n\n');
```

Each event contains:

```ts
interface SSEEvent<T = string> {
  data: T;
  event?: string;
  id?: string;         // ID field in this event block
  lastEventId: string; // committed resume ID, including inherited IDs
}
```

An `id`-only block commits `lastEventId` even when no message is dispatched.
That detail matters when a connection closes immediately after a checkpoint.

<a id="json-streams"></a>

### JSON streams

```js
import { decodeJSON } from '@stackline/sse';

for await (const event of decodeJSON(response, {
  doneSentinel: '[DONE]'
})) {
  console.log(event.data); // parsed JSON value
}
```

Invalid JSON throws `SSEParseError`. Set `ignoreInvalidJSON: true` only when a
mixed text and JSON protocol intentionally requires it.

<a id="encode-events"></a>

### Encode events

```js
import { encodeJSON, encodeSSE } from '@stackline/sse';

encodeSSE({
  id: '42',
  event: 'delta',
  retry: 3000,
  data: 'line one\nline two'
});

encodeJSON({ token: 'hello' }, { event: 'delta', id: '43' });
```

`id` and `event` values cannot contain line breaks. IDs also reject NUL. This
prevents a value from injecting additional SSE fields or HTTP resume headers.

<a id="serve-events"></a>

### Serve events

#### Response from an async generator

```js
import { eventStreamResponse } from '@stackline/sse';

async function* updates() {
  yield { event: 'ready', data: 'connected', id: '1' };
  yield { event: 'delta', data: 'hello', id: '2' };
}

export function GET() {
  return eventStreamResponse(updates());
}
```

The response includes `text/event-stream`, `no-cache, no-transform`, and
`X-Accel-Buffering: no` headers unless the caller overrides them.

#### Push channel

```js
import { createSSEChannel } from '@stackline/sse';

const channel = createSSEChannel({
  heartbeatInterval: 15_000
});

const response = channel.toResponse();

if (!channel.sendJSON({ progress: 25 }, { event: 'progress' })) {
  await channel.ready;
}

channel.close();
```

`send` and `sendJSON` return `false` when the stream applies backpressure.
Wait for `channel.ready` before producing more data.

## Features and Integrations

<a id="ai-streaming"></a>

### AI streaming

```js
import { fetchSSE } from '@stackline/sse';

const controller = new AbortController();

for await (const event of fetchSSE('https://api.example.com/responses', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ model: 'example-model', stream: true }),
  signal: controller.signal,
  connectTimeout: 10_000,
  idleTimeout: 45_000,
  totalTimeout: 5 * 60_000,
  retry: {
    retries: 3,
    minDelay: 500,
    maxDelay: 10_000
  }
})) {
  if (event.data === '[DONE]') break;
  console.log(event.event, JSON.parse(event.data));
}
```

`fetchSSE` accepts all ordinary `fetch` request options. Node.js 18 and newer
provide `fetch`; Node.js 14 and 16 can pass an implementation with `fetch`.

<a id="reconnection-behavior"></a>

### Reconnection behavior

`fetchSSE` follows SSE resume semantics and adds explicit production controls:

- sends `Accept: text/event-stream` and `Cache-Control: no-store` behavior;
- commits and forwards `Last-Event-ID` on reconnect;
- honors valid `retry:` fields and `Retry-After` headers;
- retries network failures and HTTP 408, 425, 429, 500, 502, 503, and 504;
- rejects other HTTP statuses and incorrect content types;
- uses exponential backoff with full jitter by default;
- stops permanently on HTTP 204;
- never replays a streaming request body without `bodyFactory`.

Native EventSource reconnects indefinitely, so the default retry budget is
also unlimited. Production applications should pass an `AbortSignal`, a finite
`retry.retries`, or `totalTimeout`.

```js
const options = {
  retry: {
    retries: 5,
    minDelay: 500,
    maxDelay: 30_000,
    factor: 2,
    jitter: 'full'
  },
  onRetry({ delay, reconnects, error }) {
    console.warn({ delay, reconnects, error });
  }
};
```

For a body that must be recreated on every attempt, `bodyFactory` receives the
attempt number, committed resume ID, and that attempt's abort signal:

```js
const options = {
  bodyFactory({ attempt, lastEventId, signal }) {
    return createUploadStream({ attempt, lastEventId, signal });
  }
};
```

When the input is a `Request`, its headers are preserved unless `options.headers`
explicitly replaces them. The SSE `Accept` and resume headers are then merged
case-insensitively.

<a id="migration"></a>

### Migration

#### From eventsource-parser

Direct dependency:

```bash
npm install @stackline/sse
```

The familiar API is available:

```js
import { createParser } from '@stackline/sse';
```

For a low-change trial, npm aliases preserve the old import name:

```bash
npm install eventsource-parser@npm:@stackline/sse
```

`createParser({ onEvent, onRetry, onComment, onError, maxBufferSize })` is
supported. The additional `lastEventId` property follows WHATWG resume
semantics. Security limits are enabled by default, unlike unbounded parsers.

#### From @microsoft/fetch-event-source

```bash
npm install @stackline/sse
```

```js
import { fetchEventSource } from '@stackline/sse';

await fetchEventSource('/events', {
  onopen(response) {},
  onmessage(event) {},
  onclose(context) {},
  onerror(error) {}
});
```

An alias can support staged migration:

```bash
npm install @microsoft/fetch-event-source@npm:@stackline/sse
```

The callback names are supported. `openWhenHidden` is accepted but this package
does not silently disconnect a healthy stream when a page becomes hidden.

<a id="adoption-resources"></a>

### Adoption resources

- [OpenAI, Anthropic, browser, Node.js, and edge recipes](https://github.com/alexandroit/stackline-sse/blob/main/docs/INTEGRATIONS.md)
- [Reproducible parser and fragmentation benchmarks](https://github.com/alexandroit/stackline-sse/blob/main/docs/BENCHMARKS.md)
- [Executable examples](https://github.com/alexandroit/stackline-sse/blob/main/examples)
- [Stackline open-source catalog](https://alexandro.net/docs/open-source/)

The examples ship in the npm tarball. Network examples expose functions and do
not send requests during installation or import.

## Security

<a id="memory-safety"></a>

### Memory safety

The parser is bounded by default:

| Limit | Default | Purpose |
| --- | ---: | --- |
| `maxLineLength` | 1 MiB | unterminated or oversized field line |
| `maxEventSize` | 1 MiB | accumulated multiline event |
| `maxQueuedEvents` | 4096 | callback burst inside one feed slice |
| `feedSize` | 16 KiB | limits work admitted before yielding |

Raise a limit explicitly for a trusted protocol that carries larger events.
Limit failures terminate the parser with a stable `ERR_SSE_*` code.

## API Surface

<a id="errors"></a>

### Errors

| Class | Code | Meaning |
| --- | --- | --- |
| `SSEParseError` | `ERR_SSE_PARSE` and specific variants | malformed or limited stream |
| `SSEEncodeError` | `ERR_SSE_ENCODE` | unsafe or unsupported output field |
| `SSEHTTPError` | `ERR_SSE_HTTP` | rejected HTTP response |
| `SSETimeoutError` | `ERR_SSE_TIMEOUT` | connect, idle, or total deadline |
| `SSERetryError` | `ERR_SSE_RETRY` | finite reconnect budget exhausted |
| `SSEReplayError` | `ERR_SSE_BODY_REPLAY` | non-replayable request body |

## Local Development

```sh
git clone https://github.com/alexandroit/stackline-sse.git
cd stackline-sse
npm ci
npm run test
```

Release tooling uses Node.js 24.20.0 and npm 11.19.0. The consumer runtime contract remains the one documented above.

## Consumer Smoke Test

Run the repository's existing consumer/package check after installing development dependencies:

```sh
npm run test:install
```

## Release Checklist

<a id="package-integrity"></a>

### Package integrity

- zero runtime dependencies;
- no install scripts;
- deterministic ESM, CommonJS, and browser builds;
- CI tests Node.js 14 through 24, Windows, macOS, Linux, Deno, and Bun;
- CodeQL, npm audit, registry signature verification, `publint`, and
  Are the Types Wrong checks;
- release tarballs include SHA-512 checksums and a CycloneDX SBOM.

See [SECURITY.md](https://github.com/alexandroit/stackline-sse/blob/main/SECURITY.md) for vulnerability reporting and
[CONTRIBUTING.md](https://github.com/alexandroit/stackline-sse/blob/main/CONTRIBUTING.md) for development instructions.

Run `npm run test` and inspect the package contents before release. Publish a new version through the [GitHub Actions publishing workflow](https://github.com/alexandroit/stackline-sse/actions/workflows/publish.yml), using the SHA-512 digest of the reviewed tarball. Verify the exact published version, tarball integrity, and npm provenance after the run.

## License

[MIT](https://github.com/alexandroit/stackline-sse/blob/main/LICENSE) Copyright 2026 Alexandro Paixao Marques.

## Credits and original authors

- Alexandro Paixao Marques.
- Copyright (c) 2026 Alexandro Paixao Marques.
- Copyright 2026 Alexandro Paixao Marques.
- Stackline maintenance: [Alexandro Paixao Marques](https://www.linkedin.com/in/aleinfo/) and [Stackline contributors](https://github.com/alexandroit).

Original copyright, license notices and contributor acknowledgements remain part of this distribution. Stackline maintenance does not replace authorship of the original work.

## Community and Links

- [Stackline website](https://alexandro.net/)
- [GitHub projects](https://github.com/alexandroit)
- [npm packages](https://www.npmjs.com/~alex360qc)
- [Reddit community — r/Stackline](https://www.reddit.com/r/Stackline/)
- [Maintainer LinkedIn](https://www.linkedin.com/in/aleinfo/)

Use this repository's issue tracker for reproducible bugs and feature requests. Join r/Stackline for examples, usage questions and release discussions.
