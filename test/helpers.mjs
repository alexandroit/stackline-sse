import assert from 'node:assert/strict';

export async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

export function byteChunks(text, size = 1) {
  const bytes = new TextEncoder().encode(text);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.slice(offset, offset + size));
  }
  return chunks;
}

export function eventResponse(body, init = {}) {
  return new Response(body, {
    status: init.status === undefined ? 200 : init.status,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      ...(init.headers || {})
    }
  });
}

export function streamFrom(chunks, options = {}) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(typeof chunks[index] === 'string'
        ? new TextEncoder().encode(chunks[index])
        : chunks[index]);
      index++;
    },
    cancel(reason) {
      if (typeof options.onCancel === 'function') options.onCancel(reason);
    }
  });
}

export function headerValue(init, name) {
  const target = name.toLowerCase();
  for (const pair of init.headers || []) {
    if (String(pair[0]).toLowerCase() === target) return String(pair[1]);
  }
  return undefined;
}

export async function assertRejectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}
