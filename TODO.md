# TODO

## Release engineering

- Configure npm trusted publishing with GitHub OIDC for provenance on a future patch.
- Automate signed release attestations after the npm account policy is confirmed.
- Add a nightly browser matrix against current Chrome, Firefox, and WebKit.

## Protocol roadmap

- Evaluate an opt-in EventSource-compatible class without weakening Fetch APIs.
- Add framework examples for Angular, React, Next.js, Hono, and Cloudflare Workers.
- Add optional OpenTelemetry-friendly lifecycle event adapters with no runtime dependency.
- Track WHATWG changes to EventSource and `Last-Event-ID` value-space guidance.
- Evaluate a separately exported Node HTTP response adapter for Node.js 14 and 16.

## Performance

- Preserve the LF fast path and one-character fragmentation regression benchmark.
- Investigate byte-native scanning without duplicating the string parser state machine.
- Add browser benchmark evidence without using performance as a release gate.

## Documentation operations

- Repair the central alexandro.net documentation staging mirror before any full `--delete` deployment.
- Until then, deploy only `/docs/vanilla/sse/` and update the aggregate sitemap surgically.
