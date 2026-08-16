# Market Research

Research date: 2026-08-16.

## Decision

The selected need is a unified, safe Server-Sent Events toolkit. SSE is used by
AI response streaming, live dashboards, notifications, build logs, and edge
applications. Existing adoption is large, while the common solution remains
fragmented across parser, polyfill/client, encoder, and custom retry code.

## Download evidence

Counts below come from the public npm downloads API for two fixed 30-day
windows. They measure package download activity, including CI and transitive
installs. They are not unique users and must not be treated as a download
forecast for this package.

| Package | 2026-07-17 to 2026-08-15 | Prior 30 days | Change |
| --- | ---: | ---: | ---: |
| `eventsource-parser` | 239,814,210 | 213,287,465 | +12.44% |
| `eventsource` | 203,093,267 | 176,499,445 | +15.07% |
| `eventsource-client` | 809,871 | 832,191 | -2.68% |
| `eventsource-encoder` | 186,321 | 121,896 | +52.85% |
| `@microsoft/fetch-event-source` | 11,218,110 | 10,963,830 | +2.32% |
| `eventsource-polyfill` | 757,091 | 749,470 | +1.02% |
| Combined activity | 455,878,870 | 402,454,297 | +13.27% |

The combined row contains overlap because applications may install several of
these packages. The overlap is part of the product observation: users often
need more than one package to cover the protocol lifecycle.

API source examples:

- `https://api.npmjs.org/downloads/point/2026-07-17:2026-08-15/eventsource-parser`
- `https://api.npmjs.org/downloads/point/2026-07-17:2026-08-15/eventsource`
- scoped names use URL encoding in the same endpoint.

## Standards and demand signals

- The WHATWG HTML Living Standard defines UTF-8 decoding, CR/LF handling,
  field processing, resume IDs, reconnect behavior, and HTTP 204 termination.
- OpenAI documents server-sent events as the transport for streamed Responses.
- Native browser EventSource cannot send POST bodies or arbitrary auth headers.
- `@microsoft/fetch-event-source` addresses Fetch flexibility but its published
  2.0.1 release is five years old at the research date.
- `eventsource-parser` is current and fast, but intentionally only a parser.

Primary references:

- [WHATWG Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [OpenAI streaming events](https://platform.openai.com/docs/api-reference/responses-streaming)
- [npm eventsource-parser](https://www.npmjs.com/package/eventsource-parser)
- [npm eventsource](https://www.npmjs.com/package/eventsource)
- [npm @microsoft/fetch-event-source](https://www.npmjs.com/package/@microsoft/fetch-event-source)

## Competitor analysis

| Capability | Parser package | EventSource client | Microsoft Fetch client | `@stackline/sse` |
| --- | --- | --- | --- | --- |
| Incremental parser | Yes | Dependency | Internal | Yes |
| Encoder | Separate package | No | No | Yes |
| Async iterator | Stream adapter | Yes | No | Yes |
| POST and custom headers | Retrieval-agnostic | Yes | Yes | Yes |
| Resume after ID-only block | Not exposed | Limited by parser events | Limited | Yes |
| Default memory limits | Optional | Parser-dependent | No | Yes |
| Retry-After and jitter | No | Basic reconnect | Custom callback | Yes |
| Connect, idle, total timeout | No | No | Custom | Yes |
| Non-replayable body guard | No | No | No | Yes |
| Safe encoder field validation | Separate | No | No | Yes |
| Server Response helper | No | No | No | Yes |
| Runtime dependencies | 0 | 1 | 0 | 0 |

This table describes documented public behavior at the research date. It is not
a claim that competing projects are unsafe or unsuitable.

## Product thesis

The opportunity is not another EventSource polyfill. It is one standards-based
protocol toolkit with consistent safety, cancellation, observability hooks,
backpressure, and migration paths on both sides of the HTTP connection.

Success requires documentation and ecosystem trust. Download volume is a
market signal, not a guarantee of adoption.
