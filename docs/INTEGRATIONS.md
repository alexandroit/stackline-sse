# Integration Recipes

## OpenAI Responses

Use `fetchSSE` when the application wants direct control over streamed
Responses without adding a provider SDK. Pass the bearer token, JSON request,
finite retry budget, and an idle timeout. See
[`examples/openai-responses.mjs`](../examples/openai-responses.mjs).

## Anthropic Messages

Anthropic emits named SSE events. Preserve `event.event` alongside the parsed
JSON payload so message-start, content-block, delta, and stop events remain
distinguishable. See
[`examples/anthropic-messages.mjs`](../examples/anthropic-messages.mjs).

## Browser or Node client

`fetchSSE` accepts standard Fetch options plus retry, connect, idle, and total
timeouts. Node.js 18 and newer provide Fetch. Node.js 14 and 16 can inject a
compatible implementation with `options.fetch`.

## Cloudflare Workers and edge handlers

Return `eventStreamResponse(events())` from a Fetch-style handler. The helper
sets the event-stream content type and cache headers while consuming an async
iterable with backpressure. See
[`examples/server-edge.mjs`](../examples/server-edge.mjs).

## Existing parser imports

For a staged migration that keeps `eventsource-parser` imports:

```bash
npm install eventsource-parser@npm:@stackline/sse
```

For a staged migration that keeps `@microsoft/fetch-event-source` imports:

```bash
npm install @microsoft/fetch-event-source@npm:@stackline/sse
```

Commit the changed lockfile and run the complete consumer suite. Compatibility
aliases reduce source changes but do not remove the need to review documented
hardening differences and finite retry policies.
