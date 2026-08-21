# Benchmark Methodology

The checked-in benchmark compares the incremental parser with
`eventsource-parser@3.1.1` using the same 50,000-event document. It measures a
single document, 16 KiB chunks, encoding throughput, and an adversarial stream
split one character at a time.

```bash
npm ci
npm run benchmark
```

Both parsers are warmed before measurement and must produce the expected event
count. The adversarial case is reported separately because fragmented input is
a complexity and memory-safety concern, not only a throughput concern.

Results depend on Node.js, CPU, chunk shape, event size, callbacks, and enabled
limits. Publish the complete command, environment, and raw JSON output. Do not
compare unlike parser, client, encoder, and server contracts as if they were
the same operation.
