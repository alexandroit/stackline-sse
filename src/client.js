import {
  SSEError,
  SSEHTTPError,
  SSEReplayError,
  SSERetryError,
  SSETimeoutError
} from './errors.js';
import { EVENT_STREAM_CONTENT_TYPE } from './encoder.js';
import { decodeSSE } from './iterable.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function* fetchSSE(input, options = {}) {
  const fetchImpl = options.fetch === undefined ? globalThis.fetch : options.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('No fetch implementation is available; pass options.fetch');
  }
  const retry = normalizeRetry(options.retry);
  const connectTimeout = readOptionalDelay(options.connectTimeout, 'connectTimeout');
  const idleTimeout = readOptionalDelay(options.idleTimeout, 'idleTimeout');
  const totalTimeout = readOptionalDelay(options.totalTimeout, 'totalTimeout');
  const externalSignal = options.signal;
  const requestInit = omitClientOptions(options);
  const originalBody = requestInit.body;
  const bodyReplayable = isReplayableBody(originalBody);
  let lastEventId = validateLastEventId(
    options.lastEventId === undefined ? '' : options.lastEventId
  );
  let serverRetry;
  let attempts = 0;
  let reconnects = 0;
  let lastError;
  let stopped = false;
  const startedAt = monotonicNow();

  while (!stopped) {
    attempts++;
    throwIfAborted(externalSignal);
    if (attempts > 1 && !bodyReplayable && typeof options.bodyFactory !== 'function') {
      throw new SSEReplayError();
    }

    const attempt = createAttemptController(externalSignal);
    let response;
    let timeoutPhase;
    let connectTimer;
    let idleTimer;
    let totalTimer;
    let fetchStarted = false;
    let retryDelayOverride;
    try {
      if (totalTimeout) {
        const remaining = totalTimeout - (monotonicNow() - startedAt);
        if (remaining <= 0) throw new SSETimeoutError('total', totalTimeout);
        totalTimer = setTimer(() => {
          timeoutPhase = 'total';
          attempt.abort();
        }, remaining);
      }
      if (connectTimeout) {
        connectTimer = setTimer(() => {
          timeoutPhase = 'connect';
          attempt.abort();
        }, connectTimeout);
      }

      let body = originalBody;
      if (typeof options.bodyFactory === 'function') {
        try {
          body = await waitForAbort(
            options.bodyFactory({
              attempt: attempts,
              lastEventId,
              signal: attempt.controller.signal
            }),
            attempt.controller.signal
          );
        } catch (cause) {
          throw new SSEError('SSE bodyFactory failed', 'ERR_SSE_BODY_FACTORY', { cause });
        }
      }
      const sourceHeaders = requestInit.headers === undefined && input && input.headers
        ? input.headers
        : requestInit.headers;
      const init = {
        ...requestInit,
        body,
        cache: requestInit.cache === undefined ? 'no-store' : requestInit.cache,
        headers: mergeSSEHeaders(sourceHeaders, lastEventId),
        signal: attempt.controller.signal
      };
      const attemptInput = cloneInput(input);
      fetchStarted = true;
      response = await waitForAbort(
        fetchImpl(attemptInput, init),
        attempt.controller.signal,
        cancelResponseBody
      );
      clearTimer(connectTimer);
      connectTimer = undefined;

      if (!response || typeof response.status !== 'number') {
        throw new SSEError('fetch returned an invalid Response-like value', 'ERR_SSE_RESPONSE');
      }

      if (response.status === 204) {
        stopped = true;
        if (typeof options.onClose === 'function') {
          await callHook(
            options.onClose,
            [{ attempts, lastEventId, reason: 'server', reconnects, response }],
            'onClose'
          );
        }
        return;
      }
      validateResponse(response);
      if (typeof options.onOpen === 'function') {
        const result = await callHook(
          options.onOpen,
          [response, { attempts, lastEventId, reconnects }],
          'onOpen'
        );
        if (result === false) {
          await cancelResponseBody(response);
          return;
        }
      }

      const resetIdle = () => {
        if (!idleTimeout) return;
        clearTimer(idleTimer);
        idleTimer = setTimer(() => {
          timeoutPhase = 'idle';
          attempt.abort();
        }, idleTimeout);
      };
      resetIdle();

      const parserOptions = options.parser || {};
      const userOnId = parserOptions.onId;
      const userOnRetry = parserOptions.onRetry;
      for await (const event of decodeSSE(response.body, {
        ...options.decode,
        signal: attempt.controller.signal,
        onChunk(chunk) {
          resetIdle();
          if (options.decode && typeof options.decode.onChunk === 'function') {
            options.decode.onChunk(chunk);
          }
        },
        parser: {
          ...parserOptions,
          lastEventId,
          onId(id) {
            lastEventId = id;
            if (typeof userOnId === 'function') userOnId(id);
          },
          onRetry(delay) {
            serverRetry = delay;
            if (typeof userOnRetry === 'function') userOnRetry(delay);
          }
        }
      })) {
        lastEventId = event.lastEventId;
        if (typeof options.onEvent === 'function') {
          await callHook(
            options.onEvent,
            [event, { attempts, lastEventId, reconnects, response }],
            'onEvent'
          );
        }
        yield event;
      }
      clearTimer(idleTimer);
      lastError = undefined;
    } catch (caught) {
      clearTimer(connectTimer);
      clearTimer(idleTimer);
      clearTimer(totalTimer);
      if (externalSignal && externalSignal.aborted) throw abortReason(externalSignal);
      if (timeoutPhase) {
        lastError = new SSETimeoutError(timeoutPhase, options[`${timeoutPhase}Timeout`], caught);
      } else {
        lastError = caught;
      }
      await cancelResponseBody(response);
      if (typeof options.onError === 'function') {
        const decision = await callHook(
          options.onError,
          [{ attempt: attempts, error: lastError, lastEventId, reconnects, response }],
          'onError'
        );
        if (decision === false) throw lastError;
        if (typeof decision === 'number') retryDelayOverride = decision;
      }
      if (!shouldRetryError(lastError, response, retry, fetchStarted)) throw lastError;
    } finally {
      clearTimer(totalTimer);
      await cancelResponseBody(response);
      attempt.dispose();
    }

    if (reconnects >= retry.retries) {
      if (!lastError) {
        if (typeof options.onClose === 'function') {
          await callHook(
            options.onClose,
            [{ attempts, lastEventId, reason: 'eof', reconnects, response }],
            'onClose'
          );
        }
        return;
      }
      if (retry.retries === 0) throw lastError;
      throw new SSERetryError(attempts, lastError);
    }
    reconnects++;
    let delay = retryDelay(response, serverRetry, reconnects, retry);
    if (retryDelayOverride !== undefined) delay = clampDelay(retryDelayOverride, retry.maxDelay);
    const context = {
      attempt: attempts,
      delay,
      error: lastError,
      lastEventId,
      reconnects,
      response
    };
    if (typeof options.onRetry === 'function') {
      const decision = await callHook(options.onRetry, [context], 'onRetry');
      if (decision === false) return;
      if (typeof decision === 'number') delay = clampDelay(decision, retry.maxDelay);
    }
    await sleep(delay, externalSignal, totalTimeout, startedAt);
  }
}

export async function consumeSSE(input, options = {}) {
  let count = 0;
  let lastEventId = options.lastEventId || '';
  for await (const event of fetchSSE(input, options)) {
    count++;
    lastEventId = event.lastEventId;
  }
  return { events: count, lastEventId };
}

export async function fetchEventSource(input, options = {}) {
  const mapped = {
    ...options,
    onOpen: options.onopen || options.onOpen,
    onEvent: options.onmessage || options.onEvent,
    onClose: options.onclose || options.onClose,
    async onError(context) {
      if (typeof options.onerror !== 'function') {
        return typeof options.onError === 'function' ? options.onError(context) : undefined;
      }
      const decision = await options.onerror(context.error);
      return decision === undefined ? true : decision;
    },
    async onRetry(context) {
      if (typeof options.onRetry === 'function') return options.onRetry(context);
      return undefined;
    }
  };
  return consumeSSE(input, mapped);
}

function normalizeRetry(value) {
  const input = value === false ? { retries: 0 } : typeof value === 'number' ? { retries: value } : value || {};
  const retries = input.retries === undefined ? Infinity : input.retries;
  if (retries !== Infinity && (!Number.isSafeInteger(retries) || retries < 0)) {
    throw new RangeError('retry.retries must be a non-negative safe integer or Infinity');
  }
  const minDelay = readDelay(input.minDelay, 1000, 'retry.minDelay');
  const maxDelay = readDelay(input.maxDelay, 30000, 'retry.maxDelay');
  const factor = input.factor === undefined ? 2 : input.factor;
  if (!Number.isFinite(factor) || factor < 1) throw new RangeError('retry.factor must be at least 1');
  return {
    retries,
    minDelay,
    maxDelay: Math.max(minDelay, maxDelay),
    factor,
    jitter: input.jitter === undefined ? 'full' : input.jitter,
    statusCodes: new Set(input.statusCodes || RETRYABLE_STATUS),
    shouldRetry: input.shouldRetry
  };
}

function validateResponse(response) {
  if (response.status !== 200) {
    throw new SSEHTTPError(`SSE endpoint responded with HTTP ${response.status}`, response);
  }
  const contentType = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-type')
    : null;
  if (!contentType || contentType.split(';', 1)[0].trim().toLowerCase() !== EVENT_STREAM_CONTENT_TYPE) {
    throw new SSEHTTPError(
      `Expected Content-Type ${EVENT_STREAM_CONTENT_TYPE}; received ${contentType || 'none'}`,
      response,
      'ERR_SSE_CONTENT_TYPE'
    );
  }
  if (!response.body) throw new SSEHTTPError('SSE response has no readable body', response);
}

function shouldRetryError(error, response, retry, fetchStarted) {
  if (typeof retry.shouldRetry === 'function') return retry.shouldRetry({ error, response }) === true;
  if (error && error.code === 'ERR_SSE_CONTENT_TYPE') return false;
  if (!error) return false;
  if (error.code === 'ERR_SSE_TIMEOUT') return true;
  if (response && response.status !== 200) return retry.statusCodes.has(response.status);
  if (!fetchStarted) return false;
  return error.name === 'TypeError' || NETWORK_ERROR_CODES.has(error.code);
}

function retryDelay(response, serverRetry, reconnects, options) {
  const header = response && response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('retry-after')
    : null;
  const fromHeader = parseRetryAfter(header);
  if (fromHeader !== undefined) return clampDelay(fromHeader, options.maxDelay);
  if (serverRetry !== undefined) return clampDelay(serverRetry, options.maxDelay);
  const exponential = Math.min(
    options.maxDelay,
    options.minDelay * Math.pow(options.factor, reconnects - 1)
  );
  if (options.jitter === false || options.jitter === 'none') return exponential;
  if (typeof options.jitter === 'function') return clampDelay(options.jitter(exponential), options.maxDelay);
  return Math.floor(Math.random() * (exponential + 1));
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function mergeSSEHeaders(input, lastEventId) {
  const entries = [];
  if (input && typeof input[Symbol.iterator] === 'function' && typeof input !== 'string') {
    for (const pair of input) setHeader(entries, pair[0], pair[1]);
  } else if (input && typeof input.forEach === 'function') {
    input.forEach((value, key) => setHeader(entries, key, value));
  } else if (input && typeof input === 'object') {
    for (const key of Object.keys(input)) setHeader(entries, key, input[key]);
  }
  if (!hasHeader(entries, 'accept')) setHeader(entries, 'Accept', EVENT_STREAM_CONTENT_TYPE);
  if (lastEventId) setHeader(entries, 'Last-Event-ID', lastEventId);
  else deleteHeader(entries, 'last-event-id');
  return entries;
}

function setHeader(entries, key, value) {
  const name = String(key);
  deleteHeader(entries, name);
  entries.push([name, String(value)]);
}

function deleteHeader(entries, name) {
  const lower = String(name).toLowerCase();
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index][0].toLowerCase() === lower) entries.splice(index, 1);
  }
}

function hasHeader(entries, name) {
  const lower = name.toLowerCase();
  return entries.some((entry) => entry[0].toLowerCase() === lower);
}

function omitClientOptions(options) {
  const output = {};
  const privateKeys = new Set([
    'bodyFactory', 'connectTimeout', 'decode', 'fetch', 'idleTimeout', 'lastEventId',
    'onClose', 'onError', 'onEvent', 'onOpen', 'onRetry', 'onclose', 'onerror',
    'onmessage', 'onopen', 'openWhenHidden', 'parser', 'retry', 'totalTimeout'
  ]);
  for (const key of Object.keys(options)) if (!privateKeys.has(key)) output[key] = options[key];
  return output;
}

function isReplayableBody(body) {
  if (body === undefined || body === null) return true;
  if (typeof body === 'string') return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof URLSearchParams === 'function' && body instanceof URLSearchParams) return true;
  if (typeof Blob === 'function' && body instanceof Blob) return true;
  if (typeof FormData === 'function' && body instanceof FormData) return true;
  return !(typeof body.getReader === 'function' || typeof body[Symbol.asyncIterator] === 'function');
}

function cloneInput(input) {
  if (input && typeof input === 'object' && typeof input.clone === 'function') return input.clone();
  return input;
}

function validateLastEventId(value) {
  if (typeof value !== 'string') throw new TypeError('lastEventId must be a string');
  if (value.indexOf('\0') !== -1 || value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) {
    throw new TypeError('lastEventId cannot contain NUL, CR or LF');
  }
  return value;
}

function createAttemptController(signal) {
  if (typeof AbortController !== 'function') throw new Error('AbortController is not available');
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal) signal.addEventListener('abort', forward, { once: true });
  if (signal && signal.aborted) controller.abort();
  return {
    controller,
    abort() {
      controller.abort();
    },
    dispose() {
      if (signal) signal.removeEventListener('abort', forward);
    }
  };
}

async function sleep(delay, signal, totalTimeout, startedAt) {
  if (delay <= 0) return;
  throwIfAborted(signal);
  let actual = delay;
  if (totalTimeout) {
    const remaining = totalTimeout - (monotonicNow() - startedAt);
    if (remaining <= 0) throw new SSETimeoutError('total', totalTimeout);
    actual = Math.min(actual, remaining);
  }
  await new Promise((resolve, reject) => {
    const done = () => {
      if (signal) signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimer(done, actual);
    const abort = () => {
      clearTimer(timer);
      if (signal) signal.removeEventListener('abort', abort);
      reject(abortReason(signal));
    };
    if (signal) {
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    }
  });
  if (totalTimeout && monotonicNow() - startedAt >= totalTimeout) {
    throw new SSETimeoutError('total', totalTimeout);
  }
}

function waitForAbort(value, signal, onLateValue) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      aborted = true;
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    Promise.resolve(value).then(
      (result) => {
        cleanup();
        if (aborted) {
          if (onLateValue) onLateValue(result);
          return;
        }
        resolve(result);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function setTimer(callback, delay) {
  return setTimeout(callback, delay);
}

function clearTimer(timer) {
  if (timer !== undefined) clearTimeout(timer);
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortReason(signal);
}

function abortReason(signal) {
  if (signal && signal.reason instanceof Error) return signal.reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function readDelay(value, fallback, name) {
  const number = value === undefined ? fallback : value;
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be a non-negative number`);
  return Math.round(number);
}

function readOptionalDelay(value, name) {
  if (value === undefined || value === null || value === 0) return 0;
  return readDelay(value, 0, name);
}

function clampDelay(value, max) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Retry delay must be a non-negative number');
  return Math.min(Math.round(value), max);
}

function monotonicNow() {
  return typeof performance === 'object' && performance && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function cancelResponseBody(response) {
  if (!response || !response.body || typeof response.body.cancel !== 'function') return;
  try {
    const cancellation = response.body.cancel();
    if (cancellation && typeof cancellation.catch === 'function') cancellation.catch(() => {});
  } catch {
    // A transport may have already closed the rejected response body.
  }
}

async function callHook(hook, args, name) {
  try {
    return await hook(...args);
  } catch (cause) {
    throw new SSEError(`SSE ${name} callback failed`, 'ERR_SSE_CALLBACK', { cause });
  }
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT'
]);
