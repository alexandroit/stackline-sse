import { fetchSSE } from '@stackline/sse';

const received = [];
for await (const event of fetchSSE('https://api.example.com/stream', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ stream: true }),
  fetch: async () => ({
    body: chunks('data: {"delta":"Hello"}\n\ndata: [DONE]\n\n'),
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
    status: 200
  }),
  retry: { retries: 0 }
})) {
  if (event.data === '[DONE]') break;
  received.push(JSON.parse(event.data));
}

console.log(received);

async function* chunks(document) {
  const bytes = new TextEncoder().encode(document);
  yield bytes.subarray(0, 13);
  yield bytes.subarray(13);
}
