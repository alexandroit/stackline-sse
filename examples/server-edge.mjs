import { eventStreamResponse } from '@stackline/sse';

async function* events() {
  yield { event: 'ready', data: 'connected', id: '1' };
  yield { event: 'message', data: 'hello', id: '2' };
}

export function GET() {
  return eventStreamResponse(events());
}
