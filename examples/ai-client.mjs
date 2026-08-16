import { fetchSSE } from '@stackline/sse';

for await (const event of fetchSSE('https://api.example.com/stream', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ stream: true }),
  idleTimeout: 45_000,
  retry: { retries: 3 }
})) {
  if (event.data === '[DONE]') break;
  console.log(JSON.parse(event.data));
}
