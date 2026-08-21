import { fetchSSE } from '@stackline/sse';

export async function* streamAnthropic(prompt, apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY before calling streamAnthropic');

  for await (const event of fetchSSE('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
      model: 'your-model',
      stream: true
    }),
    idleTimeout: 45_000,
    retry: { retries: 3 }
  })) {
    yield { event: event.event, payload: JSON.parse(event.data) };
  }
}
