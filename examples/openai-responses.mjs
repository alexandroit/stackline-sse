import { fetchSSE } from '@stackline/sse';

export async function* streamOpenAI(input, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) throw new Error('Set OPENAI_API_KEY before calling streamOpenAI');

  for await (const event of fetchSSE('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'your-model', input, stream: true }),
    idleTimeout: 45_000,
    retry: { retries: 3 }
  })) {
    yield JSON.parse(event.data);
  }
}
