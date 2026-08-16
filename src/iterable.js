import { SSEParseError } from './errors.js';
import { createParser } from './parser.js';

const DEFAULT_FEED_SIZE = 16 * 1024;
const DEFAULT_MAX_QUEUED_EVENTS = 4096;

export async function* decodeSSE(source, options = {}) {
  const signal = options.signal;
  const feedSize = readPositive(options.feedSize, DEFAULT_FEED_SIZE, 'feedSize');
  const maxQueuedEvents = readPositive(
    options.maxQueuedEvents,
    DEFAULT_MAX_QUEUED_EVENTS,
    'maxQueuedEvents'
  );
  const queue = [];
  const parserOptions = options.parser || options;
  const userOnEvent = parserOptions.onEvent;
  const parser = createParser({
    ...parserOptions,
    onEvent(event) {
      if (queue.length >= maxQueuedEvents) {
        throw new SSEParseError(`Queued SSE events exceeded ${maxQueuedEvents}`, {
          code: 'ERR_SSE_QUEUE_LIMIT',
          fatal: true,
          limit: maxQueuedEvents
        });
      }
      queue.push(event);
      if (typeof userOnEvent === 'function') userOnEvent(event);
    }
  });
  const iterable = toAsyncIterable(source);
  const iterator = iterable[Symbol.asyncIterator]();

  try {
    while (true) {
      throwIfAborted(signal);
      const item = await nextWithAbort(iterator, signal);
      if (item.done) break;
      const chunk = item.value;
      if (typeof options.onChunk === 'function') options.onChunk(chunk);
      if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
        throw new TypeError('SSE stream chunks must be strings or Uint8Array values');
      }
      for (let offset = 0; offset < chunk.length; offset += feedSize) {
        parser.feed(chunk.slice(offset, offset + feedSize));
        for (let index = 0; index < queue.length; index++) yield queue[index];
        queue.length = 0;
        throwIfAborted(signal);
      }
    }
    parser.end();
    for (let index = 0; index < queue.length; index++) yield queue[index];
  } finally {
    await closeIterator(iterator, signal);
  }
}

export async function* decodeJSON(source, options = {}) {
  const doneSentinel = options.doneSentinel === undefined ? '[DONE]' : options.doneSentinel;
  for await (const event of decodeSSE(source, options)) {
    if (doneSentinel !== false && event.data === doneSentinel) return;
    try {
      yield { ...event, data: JSON.parse(event.data, options.reviver) };
    } catch (cause) {
      if (options.ignoreInvalidJSON === true) continue;
      throw new SSEParseError('SSE event data is not valid JSON', {
        code: 'ERR_SSE_JSON',
        fatal: true,
        cause
      });
    }
  }
}

export function createDecoderStream(options = {}) {
  if (typeof TransformStream !== 'function') {
    throw new Error('TransformStream is not available in this runtime');
  }
  let controller;
  const parser = createParser({
    ...(options.parser || options),
    onEvent(event) {
      controller.enqueue(event);
      const callback = (options.parser || options).onEvent;
      if (typeof callback === 'function') callback(event);
    }
  });
  return new TransformStream({
    start(value) {
      controller = value;
    },
    transform(chunk) {
      parser.feed(chunk);
    },
    flush() {
      parser.end();
    }
  });
}

export function toAsyncIterable(source) {
  const value = source && source.body ? source.body : source;
  if (!value) throw new TypeError('An SSE stream source is required');
  if (typeof value[Symbol.asyncIterator] === 'function') return value;
  if (typeof value.getReader === 'function') return webStreamIterable(value);
  if (typeof value[Symbol.iterator] === 'function') return syncToAsync(value);
  throw new TypeError('Source must be a Response, ReadableStream, AsyncIterable or Iterable');
}

async function* webStreamIterable(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) return;
      yield item.value;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed or errored.
    }
    if (typeof reader.releaseLock === 'function') reader.releaseLock();
  }
}

async function* syncToAsync(iterable) {
  yield* iterable;
}

function throwIfAborted(signal) {
  if (!signal || !signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  throw error;
}

function nextWithAbort(iterator, signal) {
  if (!signal) return iterator.next();
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    Promise.resolve(iterator.next()).then(
      (item) => {
        cleanup();
        resolve(item);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

async function closeIterator(iterator, signal) {
  if (typeof iterator.return !== 'function') return;
  try {
    const result = iterator.return();
    if (!signal || !signal.aborted) await result;
    else Promise.resolve(result).catch(() => {});
  } catch (error) {
    if (!signal || !signal.aborted) throw error;
  }
}

function readPositive(value, fallback, name) {
  const number = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return number;
}
