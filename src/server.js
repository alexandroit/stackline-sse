import { encodeJSON, encodeSSE, EVENT_STREAM_CONTENT_TYPE } from './encoder.js';

export function createSSEChannel(options = {}) {
  if (typeof ReadableStream !== 'function') throw new Error('ReadableStream is not available in this runtime');
  if (typeof TextEncoder !== 'function') throw new Error('TextEncoder is not available in this runtime');
  const encoder = new TextEncoder();
  const highWaterMark = readHighWaterMark(options.highWaterMark);
  const heartbeatInterval = readHeartbeatInterval(options.heartbeatInterval);
  const heartbeat = heartbeatInterval
    ? encoder.encode(encodeSSE({ comment: options.heartbeatComment ?? 'keep-alive' }, options))
    : undefined;
  let controller;
  let open = true;
  let readyPromise = Promise.resolve();
  let resolveReady;
  let resolveClosed;
  let heartbeatTimer;
  let responseClaimed = false;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  const stream = new ReadableStream({
    start(value) {
      controller = value;
      if (heartbeatInterval) {
        heartbeatTimer = setInterval(() => {
          if (open && controller.desiredSize > 0) controller.enqueue(heartbeat);
        }, heartbeatInterval);
        if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
      }
    },
    pull() {
      if (resolveReady) {
        resolveReady();
        resolveReady = undefined;
        readyPromise = Promise.resolve();
      }
    },
    cancel(reason) {
      finish(reason);
    }
  }, {
    highWaterMark,
    size(chunk) {
      return chunk.byteLength;
    }
  });

  function send(message) {
    assertOpen();
    controller.enqueue(encoder.encode(encodeSSE(message, options)));
    updateReady();
    return controller.desiredSize > 0;
  }

  function sendJSON(data, fields = {}) {
    assertOpen();
    controller.enqueue(encoder.encode(encodeJSON(data, fields, options)));
    updateReady();
    return controller.desiredSize > 0;
  }

  function comment(value) {
    return send({ comment: value });
  }

  function close() {
    if (!open) return;
    open = false;
    clearInterval(heartbeatTimer);
    if (resolveReady) resolveReady();
    controller.close();
    resolveClosed();
  }

  function error(reason) {
    if (!open) return;
    open = false;
    clearInterval(heartbeatTimer);
    if (resolveReady) resolveReady();
    controller.error(reason);
    resolveClosed(reason);
  }

  function toResponse(init = {}) {
    if (typeof Response !== 'function') throw new Error('Response is not available in this runtime');
    if (responseClaimed) throw new Error('SSE channel response has already been created');
    responseClaimed = true;
    return new Response(stream, {
      ...init,
      headers: responseHeaders(init.headers)
    });
  }

  function updateReady() {
    if (controller.desiredSize > 0 || resolveReady) return;
    readyPromise = new Promise((resolve) => {
      resolveReady = resolve;
    });
  }

  function finish(reason) {
    if (!open) return;
    open = false;
    clearInterval(heartbeatTimer);
    if (resolveReady) resolveReady();
    resolveClosed(reason);
  }

  function assertOpen() {
    if (!open) throw new Error('SSE channel is closed');
  }

  return {
    stream,
    send,
    sendJSON,
    comment,
    close,
    error,
    toResponse,
    closed,
    get open() {
      return open;
    },
    get ready() {
      return readyPromise;
    }
  };
}

export function eventStreamResponse(source, options = {}) {
  if (typeof ReadableStream !== 'function') throw new Error('ReadableStream is not available in this runtime');
  if (typeof Response !== 'function') throw new Error('Response is not available in this runtime');
  if (typeof TextEncoder !== 'function') throw new Error('TextEncoder is not available in this runtime');
  const encoder = new TextEncoder();
  const iterator = toIterator(source);
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (item.done) {
          controller.close();
          return;
        }
        const output = options.json === true
          ? encodeJSON(item.value.data, item.value, options)
          : encodeSSE(item.value, options);
        controller.enqueue(encoder.encode(output));
      } catch (error) {
        if (typeof iterator.return === 'function') {
          try {
            await iterator.return(error);
          } catch {
            // Preserve the original read failure.
          }
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (typeof iterator.return === 'function') await iterator.return(reason);
    }
  }, {
    highWaterMark: readHighWaterMark(options.highWaterMark),
    size(chunk) {
      return chunk.byteLength;
    }
  });
  return new Response(stream, {
    status: options.status || 200,
    statusText: options.statusText,
    headers: responseHeaders(options.headers)
  });
}

function responseHeaders(input) {
  const headers = typeof Headers === 'function' ? new Headers(input) : new Map();
  const has = (name) => typeof headers.has === 'function' && headers.has(name);
  const set = (name, value) => {
    if (typeof headers.set === 'function') headers.set(name, value);
  };
  if (!has('Content-Type')) set('Content-Type', `${EVENT_STREAM_CONTENT_TYPE}; charset=utf-8`);
  if (!has('Cache-Control')) set('Cache-Control', 'no-cache, no-transform');
  if (!has('X-Accel-Buffering')) set('X-Accel-Buffering', 'no');
  return headers;
}

function toIterator(source) {
  if (!source) throw new TypeError('An event iterable is required');
  if (typeof source[Symbol.asyncIterator] === 'function') return source[Symbol.asyncIterator]();
  if (typeof source[Symbol.iterator] === 'function') {
    const iterator = source[Symbol.iterator]();
    return {
      next() {
        return Promise.resolve(iterator.next());
      },
      return(value) {
        return Promise.resolve(typeof iterator.return === 'function' ? iterator.return(value) : { done: true, value });
      }
    };
  }
  throw new TypeError('Events must be an Iterable or AsyncIterable');
}

function readHighWaterMark(value) {
  const number = value === undefined ? 64 * 1024 : value;
  if (!Number.isFinite(number) || number < 1) throw new RangeError('highWaterMark must be a positive number');
  return number;
}

function readHeartbeatInterval(value) {
  if (value === undefined || value === null || value === 0) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('heartbeatInterval must be a non-negative number');
  }
  return Math.round(value);
}
