/*! @stackline/sse v1.0.1 | MIT */

// src/errors.js
var SSEError = class extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details && details.cause !== void 0) this.cause = details.cause;
  }
};
var SSEParseError = class extends SSEError {
  constructor(message, details = {}) {
    super(message, details.code || "ERR_SSE_PARSE", details);
    this.fatal = details.fatal === true;
    if (details.field !== void 0) this.field = details.field;
    if (details.line !== void 0) this.line = details.line;
    if (details.limit !== void 0) this.limit = details.limit;
  }
};
var SSEEncodeError = class extends SSEError {
  constructor(message, field, cause) {
    super(message, "ERR_SSE_ENCODE", { cause });
    this.field = field;
  }
};
var SSEHTTPError = class extends SSEError {
  constructor(message, response, code = "ERR_SSE_HTTP") {
    super(message, code);
    this.response = response;
    this.status = response && typeof response.status === "number" ? response.status : 0;
  }
};
var SSETimeoutError = class extends SSEError {
  constructor(phase, timeout, cause) {
    super(`SSE ${phase} timeout after ${timeout}ms`, "ERR_SSE_TIMEOUT", { cause });
    this.phase = phase;
    this.timeout = timeout;
  }
};
var SSERetryError = class extends SSEError {
  constructor(attempts, cause) {
    super(`SSE retry budget exhausted after ${attempts} attempt${attempts === 1 ? "" : "s"}`, "ERR_SSE_RETRY", { cause });
    this.attempts = attempts;
  }
};
var SSEReplayError = class extends SSEError {
  constructor() {
    super(
      "The request body cannot be replayed. Provide bodyFactory or disable reconnection.",
      "ERR_SSE_BODY_REPLAY"
    );
  }
};

// src/parser.js
var DEFAULT_MAX_EVENT_SIZE = 1024 * 1024;
var DEFAULT_MAX_LINE_LENGTH = 1024 * 1024;
var LF = 10;
var CR = 13;
var SPACE = 32;
var BOM = 65279;
var NUL = "\0";
var noop = () => {
};
function createParser(config = {}) {
  if (typeof config === "function") config = { onEvent: config };
  if (!config || typeof config !== "object") {
    throw new TypeError("Parser configuration must be an object or event callback");
  }
  const onEvent = typeof config.onEvent === "function" ? config.onEvent : noop;
  const onComment = typeof config.onComment === "function" ? config.onComment : noop;
  const onRetry = typeof config.onRetry === "function" ? config.onRetry : noop;
  const onError = typeof config.onError === "function" ? config.onError : noop;
  const onId = typeof config.onId === "function" ? config.onId : noop;
  const strict = config.strict === true;
  const fatalUTF8 = config.fatalUTF8 === true;
  const maxEventSize = readLimit(
    config.maxEventSize === void 0 ? config.maxBufferSize : config.maxEventSize,
    DEFAULT_MAX_EVENT_SIZE,
    "maxEventSize"
  );
  const maxLineLength = readLimit(
    config.maxLineLength,
    DEFAULT_MAX_LINE_LENGTH,
    "maxLineLength"
  );
  let decoder;
  let inputMode;
  let lineFragments = [];
  let lineLength = 0;
  let skipLeadingLF = false;
  let atStart = true;
  let dataLines = [];
  let eventSize = 0;
  let eventType;
  let idBuffer = normalizeInitialId(config.lastEventId);
  let committedId = idBuffer;
  let hasPendingId = false;
  let terminated = false;
  let bytes = 0;
  let characters = 0;
  let events = 0;
  let comments = 0;
  let retries = 0;
  function feed(chunk) {
    if (terminated) {
      throw new SSEParseError("Parser is terminated; call reset() before feeding more data", {
        code: "ERR_SSE_TERMINATED",
        fatal: true
      });
    }
    if (typeof chunk === "string") {
      if (inputMode === "bytes") {
        throw fatal("Cannot mix string and byte chunks in one parser stream", "ERR_SSE_CHUNK_TYPE");
      }
      inputMode = "string";
      characters += chunk.length;
      processText(chunk);
      return api2;
    }
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("SSE parser chunks must be strings or Uint8Array values");
    }
    if (inputMode === "string") {
      throw fatal("Cannot mix string and byte chunks in one parser stream", "ERR_SSE_CHUNK_TYPE");
    }
    inputMode = "bytes";
    bytes += chunk.byteLength;
    let text;
    try {
      text = getDecoder().decode(chunk, { stream: true });
    } catch (error) {
      if (error instanceof SSEParseError) throw error;
      throw fatal("Invalid UTF-8 in the SSE stream", "ERR_SSE_UTF8", { cause: error });
    }
    characters += text.length;
    processText(text);
    return api2;
  }
  function end() {
    if (terminated) return api2;
    if (decoder) {
      try {
        const tail = decoder.decode();
        characters += tail.length;
        processText(tail);
      } catch (error) {
        throw fatal("Invalid UTF-8 at the end of the SSE stream", "ERR_SSE_UTF8", { cause: error });
      }
    }
    discardPendingEvent();
    clearLine();
    return api2;
  }
  function reset(options = {}) {
    if (options && options.consume && lineLength > 0) processLine(joinLine());
    const preserve = Boolean(options && options.preserveLastEventId);
    const nextId = preserve ? committedId : normalizeInitialId(config.lastEventId);
    decoder = void 0;
    inputMode = void 0;
    lineFragments = [];
    lineLength = 0;
    skipLeadingLF = false;
    atStart = true;
    dataLines = [];
    eventSize = 0;
    eventType = void 0;
    idBuffer = nextId;
    committedId = nextId;
    hasPendingId = false;
    terminated = false;
    bytes = 0;
    characters = 0;
    events = 0;
    comments = 0;
    retries = 0;
    return api2;
  }
  function processText(input) {
    let text = input;
    if (atStart && text.length > 0) {
      atStart = false;
      if (text.charCodeAt(0) === BOM) text = text.slice(1);
    }
    if (text.length === 0) return;
    if (!skipLeadingLF && text.indexOf("\r") === -1) {
      processLFText(text);
      return;
    }
    let index = 0;
    let segmentStart = 0;
    if (skipLeadingLF) {
      skipLeadingLF = false;
      if (text.charCodeAt(0) === LF) {
        index = 1;
        segmentStart = 1;
      }
    }
    for (; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code !== LF && code !== CR) continue;
      appendLine(text.slice(segmentStart, index));
      processLine(joinLine());
      clearLine();
      if (code === CR) {
        if (text.charCodeAt(index + 1) === LF) index++;
        else if (index + 1 === text.length) skipLeadingLF = true;
      }
      segmentStart = index + 1;
    }
    appendLine(text.slice(segmentStart));
  }
  function processLFText(text) {
    let start = 0;
    let end2 = text.indexOf("\n");
    while (end2 !== -1) {
      if (lineLength === 0 && dataLines.length === 0 && text.charCodeAt(end2 + 1) === LF && isDataPrefix(text, start)) {
        const valueStart = text.charCodeAt(start + 5) === SPACE ? start + 6 : start + 5;
        const value = text.slice(valueStart, end2);
        if (end2 - start > maxLineLength) {
          throw fatal(`SSE line exceeded ${maxLineLength} characters`, "ERR_SSE_LINE_LIMIT", {
            limit: maxLineLength
          });
        }
        addEventSize(value.length + 1);
        dispatchSingleData(value);
        start = end2 + 2;
        end2 = text.indexOf("\n", start);
        continue;
      }
      if (lineLength > 0) {
        appendLine(text.slice(start, end2));
        processLine(joinLine());
        clearLine();
      } else {
        const length = end2 - start;
        if (length > maxLineLength) {
          throw fatal(`SSE line exceeded ${maxLineLength} characters`, "ERR_SSE_LINE_LIMIT", {
            limit: maxLineLength
          });
        }
        processLine(text.slice(start, end2));
      }
      start = end2 + 1;
      end2 = text.indexOf("\n", start);
    }
    appendLine(text.slice(start));
  }
  function appendLine(fragment) {
    if (!fragment) return;
    lineFragments.push(fragment);
    lineLength += fragment.length;
    if (lineLength > maxLineLength) {
      throw fatal(`SSE line exceeded ${maxLineLength} characters`, "ERR_SSE_LINE_LIMIT", {
        limit: maxLineLength
      });
    }
  }
  function joinLine() {
    if (lineFragments.length === 0) return "";
    if (lineFragments.length === 1) return lineFragments[0];
    return lineFragments.join("");
  }
  function clearLine() {
    lineFragments = [];
    lineLength = 0;
  }
  function processLine(line) {
    if (line.length === 0) {
      dispatchEvent();
      return;
    }
    if (line.charCodeAt(0) === 58) {
      comments++;
      onComment(line.slice(line.charCodeAt(1) === SPACE ? 2 : 1));
      return;
    }
    const first = line.charCodeAt(0);
    if (first === 100 && line.charCodeAt(1) === 97 && line.charCodeAt(2) === 116 && line.charCodeAt(3) === 97 && line.charCodeAt(4) === 58) {
      const start = line.charCodeAt(5) === SPACE ? 6 : 5;
      const value2 = line.slice(start);
      addEventSize(value2.length + 1);
      dataLines.push(value2);
      return;
    }
    if (first === 101 && line.charCodeAt(1) === 118 && line.charCodeAt(2) === 101 && line.charCodeAt(3) === 110 && line.charCodeAt(4) === 116 && line.charCodeAt(5) === 58) {
      const start = line.charCodeAt(6) === SPACE ? 7 : 6;
      const value2 = line.slice(start);
      addEventSize(value2.length);
      eventType = value2 || void 0;
      return;
    }
    if (first === 105 && line.charCodeAt(1) === 100 && line.charCodeAt(2) === 58) {
      const start = line.charCodeAt(3) === SPACE ? 4 : 3;
      const value2 = line.slice(start);
      if (value2.indexOf(NUL) === -1) {
        addEventSize(value2.length);
        idBuffer = value2;
        hasPendingId = true;
      }
      return;
    }
    if (first === 114 && line.charCodeAt(1) === 101 && line.charCodeAt(2) === 116 && line.charCodeAt(3) === 114 && line.charCodeAt(4) === 121 && line.charCodeAt(5) === 58) {
      const start = line.charCodeAt(6) === SPACE ? 7 : 6;
      processRetry(line.slice(start), line);
      return;
    }
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.charCodeAt(0) === SPACE) value = value.slice(1);
    switch (field) {
      case "data":
        addEventSize(value.length + 1);
        dataLines.push(value);
        break;
      case "event":
        addEventSize(value.length);
        eventType = value || void 0;
        break;
      case "id":
        if (value.indexOf(NUL) === -1) {
          addEventSize(value.length);
          idBuffer = value;
          hasPendingId = true;
        }
        break;
      case "retry":
        processRetry(value, line);
        break;
      default:
        if (strict) recoverable(`Unknown SSE field "${truncate(field)}"`, "ERR_SSE_UNKNOWN_FIELD", {
          field,
          line
        });
    }
  }
  function processRetry(value, line) {
    if (!isAsciiDigits(value)) {
      if (strict) recoverable(`Invalid SSE retry value "${truncate(value)}"`, "ERR_SSE_RETRY_VALUE", {
        field: "retry",
        line
      });
      return;
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      if (strict) recoverable("SSE retry value exceeds the safe integer range", "ERR_SSE_RETRY_VALUE", {
        field: "retry",
        line
      });
      return;
    }
    retries++;
    onRetry(number);
  }
  function dispatchEvent() {
    const eventId = hasPendingId ? idBuffer : void 0;
    if (hasPendingId) {
      committedId = idBuffer;
      hasPendingId = false;
      onId(committedId);
    }
    if (dataLines.length === 0) {
      eventType = void 0;
      eventSize = 0;
      return;
    }
    const event = {
      data: dataLines.join("\n"),
      id: eventId,
      event: eventType,
      lastEventId: committedId
    };
    events++;
    dataLines = [];
    eventType = void 0;
    eventSize = 0;
    onEvent(event);
  }
  function dispatchSingleData(data) {
    const eventId = hasPendingId ? idBuffer : void 0;
    if (hasPendingId) {
      committedId = idBuffer;
      hasPendingId = false;
      onId(committedId);
    }
    const event = {
      data,
      id: eventId,
      event: eventType,
      lastEventId: committedId
    };
    events++;
    eventType = void 0;
    eventSize = 0;
    onEvent(event);
  }
  function addEventSize(amount) {
    eventSize += amount;
    if (eventSize > maxEventSize) {
      throw fatal(`SSE event exceeded ${maxEventSize} characters`, "ERR_SSE_EVENT_LIMIT", {
        limit: maxEventSize
      });
    }
  }
  function discardPendingEvent() {
    dataLines = [];
    eventType = void 0;
    eventSize = 0;
    hasPendingId = false;
    idBuffer = committedId;
  }
  function getDecoder() {
    if (!decoder) {
      if (typeof TextDecoder !== "function") {
        throw fatal("TextDecoder is required for byte chunks", "ERR_SSE_TEXT_DECODER");
      }
      decoder = new TextDecoder("utf-8", { fatal: fatalUTF8 });
    }
    return decoder;
  }
  function recoverable(message, code, details) {
    const error = new SSEParseError(message, { ...details, code, fatal: false });
    onError(error);
    return error;
  }
  function fatal(message, code, details = {}) {
    terminated = true;
    lineFragments = [];
    lineLength = 0;
    dataLines = [];
    eventType = void 0;
    eventSize = 0;
    const error = new SSEParseError(message, { ...details, code, fatal: true });
    onError(error);
    return error;
  }
  const api2 = {
    feed,
    end,
    reset,
    get state() {
      return Object.freeze({
        buffered: lineLength + eventSize,
        bytes,
        characters,
        comments,
        events,
        lastEventId: committedId,
        retries,
        terminated
      });
    }
  };
  return api2;
}
function readLimit(value, fallback, name) {
  const limit = value === void 0 ? fallback : value;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return limit;
}
function normalizeInitialId(value) {
  if (value === void 0 || value === null) return "";
  if (typeof value !== "string") throw new TypeError("lastEventId must be a string");
  if (value.indexOf(NUL) !== -1 || value.indexOf("\r") !== -1 || value.indexOf("\n") !== -1) {
    throw new TypeError("lastEventId cannot contain NUL, CR or LF");
  }
  return value;
}
function isAsciiDigits(value) {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}
function truncate(value) {
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}
function isDataPrefix(value, index) {
  return value.charCodeAt(index) === 100 && value.charCodeAt(index + 1) === 97 && value.charCodeAt(index + 2) === 116 && value.charCodeAt(index + 3) === 97 && value.charCodeAt(index + 4) === 58;
}

// src/encoder.js
var EVENT_STREAM_CONTENT_TYPE = "text/event-stream";
var EventStreamContentType = EVENT_STREAM_CONTENT_TYPE;
function encodeSSE(message, options = {}) {
  if (!message || typeof message !== "object") {
    throw new TypeError("SSE message must be an object");
  }
  const newline = options.newline === void 0 ? "\n" : options.newline;
  if (newline !== "\n" && newline !== "\r\n") {
    throw new SSEEncodeError('newline must be "\\n" or "\\r\\n"', "newline");
  }
  const lines = [];
  if (message.comment !== void 0) {
    for (const line of splitLines(toText(message.comment, "comment"))) lines.push(`:${line ? ` ${line}` : ""}`);
  }
  if (message.event !== void 0 && message.event !== "") {
    const value = toText(message.event, "event");
    assertSingleLine(value, "event", false);
    lines.push(`event: ${value}`);
  }
  if (message.id !== void 0) {
    const value = toText(message.id, "id");
    assertSingleLine(value, "id", true);
    lines.push(`id: ${value}`);
  }
  if (message.retry !== void 0) {
    if (!Number.isSafeInteger(message.retry) || message.retry < 0) {
      throw new SSEEncodeError("retry must be a non-negative safe integer", "retry");
    }
    lines.push(`retry: ${message.retry}`);
  }
  if (message.data !== void 0) {
    for (const line of splitLines(toText(message.data, "data"))) lines.push(`data: ${line}`);
  }
  if (lines.length === 0) {
    throw new SSEEncodeError("SSE message must contain data, comment, event, id or retry", "message");
  }
  return `${lines.join(newline)}${newline}${newline}`;
}
var encode = encodeSSE;
function encodeJSON(data, fields = {}, options = {}) {
  let encoded;
  try {
    encoded = JSON.stringify(data, options.replacer);
  } catch (error) {
    throw new SSEEncodeError("Unable to encode SSE JSON data", "data", error);
  }
  if (encoded === void 0) {
    throw new SSEEncodeError("JSON data cannot be undefined, a function or a symbol", "data");
  }
  return encodeSSE({ ...fields, data: encoded }, options);
}
function encodeComment(comment, options = {}) {
  return encodeSSE({ comment }, options);
}
function createEncoderStream(options = {}) {
  const Transform = getTransformStream();
  const bytes = options.bytes !== false;
  const encoder = bytes ? getTextEncoder() : null;
  return new Transform({
    transform(message, controller) {
      const output = options.json === true ? encodeJSON(message.data, message, options) : encodeSSE(message, options);
      controller.enqueue(encoder ? encoder.encode(output) : output);
    }
  });
}
function splitLines(value) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code !== 10 && code !== 13) continue;
    lines.push(value.slice(start, index));
    if (code === 13 && value.charCodeAt(index + 1) === 10) index++;
    start = index + 1;
  }
  lines.push(value.slice(start));
  return lines;
}
function toText(value, field) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  throw new SSEEncodeError(`${field} must be a string or primitive value`, field);
}
function assertSingleLine(value, field, rejectNul) {
  if (value.indexOf("\r") !== -1 || value.indexOf("\n") !== -1 || rejectNul && value.indexOf("\0") !== -1) {
    throw new SSEEncodeError(`${field} contains a forbidden control character`, field);
  }
}
function getTransformStream() {
  if (typeof TransformStream !== "function") {
    throw new Error("TransformStream is not available in this runtime");
  }
  return TransformStream;
}
function getTextEncoder() {
  if (typeof TextEncoder !== "function") throw new Error("TextEncoder is not available in this runtime");
  return new TextEncoder();
}

// src/iterable.js
var DEFAULT_FEED_SIZE = 16 * 1024;
var DEFAULT_MAX_QUEUED_EVENTS = 4096;
async function* decodeSSE(source, options = {}) {
  const signal = options.signal;
  const feedSize = readPositive(options.feedSize, DEFAULT_FEED_SIZE, "feedSize");
  const maxQueuedEvents = readPositive(
    options.maxQueuedEvents,
    DEFAULT_MAX_QUEUED_EVENTS,
    "maxQueuedEvents"
  );
  const queue = [];
  const parserOptions = options.parser || options;
  const userOnEvent = parserOptions.onEvent;
  const parser = createParser({
    ...parserOptions,
    onEvent(event) {
      if (queue.length >= maxQueuedEvents) {
        throw new SSEParseError(`Queued SSE events exceeded ${maxQueuedEvents}`, {
          code: "ERR_SSE_QUEUE_LIMIT",
          fatal: true,
          limit: maxQueuedEvents
        });
      }
      queue.push(event);
      if (typeof userOnEvent === "function") userOnEvent(event);
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
      if (typeof options.onChunk === "function") options.onChunk(chunk);
      if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
        throw new TypeError("SSE stream chunks must be strings or Uint8Array values");
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
async function* decodeJSON(source, options = {}) {
  const doneSentinel = options.doneSentinel === void 0 ? "[DONE]" : options.doneSentinel;
  for await (const event of decodeSSE(source, options)) {
    if (doneSentinel !== false && event.data === doneSentinel) return;
    try {
      yield { ...event, data: JSON.parse(event.data, options.reviver) };
    } catch (cause) {
      if (options.ignoreInvalidJSON === true) continue;
      throw new SSEParseError("SSE event data is not valid JSON", {
        code: "ERR_SSE_JSON",
        fatal: true,
        cause
      });
    }
  }
}
function createDecoderStream(options = {}) {
  if (typeof TransformStream !== "function") {
    throw new Error("TransformStream is not available in this runtime");
  }
  let controller;
  const parser = createParser({
    ...options.parser || options,
    onEvent(event) {
      controller.enqueue(event);
      const callback = (options.parser || options).onEvent;
      if (typeof callback === "function") callback(event);
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
function toAsyncIterable(source) {
  const value = source && source.body ? source.body : source;
  if (!value) throw new TypeError("An SSE stream source is required");
  if (typeof value[Symbol.asyncIterator] === "function") return value;
  if (typeof value.getReader === "function") return webStreamIterable(value);
  if (typeof value[Symbol.iterator] === "function") return syncToAsync(value);
  throw new TypeError("Source must be a Response, ReadableStream, AsyncIterable or Iterable");
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
    } catch (e) {
    }
    if (typeof reader.releaseLock === "function") reader.releaseLock();
  }
}
async function* syncToAsync(iterable) {
  yield* iterable;
}
function throwIfAborted(signal) {
  if (!signal || !signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  throw error;
}
function nextWithAbort(iterator, signal) {
  if (!signal) return iterator.next();
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
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
  if (typeof iterator.return !== "function") return;
  try {
    const result = iterator.return();
    if (!signal || !signal.aborted) await result;
    else Promise.resolve(result).catch(() => {
    });
  } catch (error) {
    if (!signal || !signal.aborted) throw error;
  }
}
function readPositive(value, fallback, name) {
  const number = value === void 0 ? fallback : value;
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return number;
}

// src/client.js
var RETRYABLE_STATUS = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504]);
async function* fetchSSE(input, options = {}) {
  const fetchImpl = options.fetch === void 0 ? globalThis.fetch : options.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("No fetch implementation is available; pass options.fetch");
  }
  const retry = normalizeRetry(options.retry);
  const connectTimeout = readOptionalDelay(options.connectTimeout, "connectTimeout");
  const idleTimeout = readOptionalDelay(options.idleTimeout, "idleTimeout");
  const totalTimeout = readOptionalDelay(options.totalTimeout, "totalTimeout");
  const externalSignal = options.signal;
  const requestInit = omitClientOptions(options);
  const originalBody = requestInit.body;
  const bodyReplayable = isReplayableBody(originalBody);
  let lastEventId = validateLastEventId(
    options.lastEventId === void 0 ? "" : options.lastEventId
  );
  let serverRetry;
  let attempts = 0;
  let reconnects = 0;
  let lastError;
  let stopped = false;
  const startedAt = monotonicNow();
  while (!stopped) {
    attempts++;
    throwIfAborted2(externalSignal);
    if (attempts > 1 && !bodyReplayable && typeof options.bodyFactory !== "function") {
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
        if (remaining <= 0) throw new SSETimeoutError("total", totalTimeout);
        totalTimer = setTimer(() => {
          timeoutPhase = "total";
          attempt.abort();
        }, remaining);
      }
      if (connectTimeout) {
        connectTimer = setTimer(() => {
          timeoutPhase = "connect";
          attempt.abort();
        }, connectTimeout);
      }
      let body = originalBody;
      if (typeof options.bodyFactory === "function") {
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
          throw new SSEError("SSE bodyFactory failed", "ERR_SSE_BODY_FACTORY", { cause });
        }
      }
      const sourceHeaders = requestInit.headers === void 0 && input && input.headers ? input.headers : requestInit.headers;
      const init = {
        ...requestInit,
        body,
        cache: requestInit.cache === void 0 ? "no-store" : requestInit.cache,
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
      connectTimer = void 0;
      if (!response || typeof response.status !== "number") {
        throw new SSEError("fetch returned an invalid Response-like value", "ERR_SSE_RESPONSE");
      }
      if (response.status === 204) {
        stopped = true;
        if (typeof options.onClose === "function") {
          await callHook(
            options.onClose,
            [{ attempts, lastEventId, reason: "server", reconnects, response }],
            "onClose"
          );
        }
        return;
      }
      validateResponse(response);
      if (typeof options.onOpen === "function") {
        const result = await callHook(
          options.onOpen,
          [response, { attempts, lastEventId, reconnects }],
          "onOpen"
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
          timeoutPhase = "idle";
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
          if (options.decode && typeof options.decode.onChunk === "function") {
            options.decode.onChunk(chunk);
          }
        },
        parser: {
          ...parserOptions,
          lastEventId,
          onId(id) {
            lastEventId = id;
            if (typeof userOnId === "function") userOnId(id);
          },
          onRetry(delay2) {
            serverRetry = delay2;
            if (typeof userOnRetry === "function") userOnRetry(delay2);
          }
        }
      })) {
        lastEventId = event.lastEventId;
        if (typeof options.onEvent === "function") {
          await callHook(
            options.onEvent,
            [event, { attempts, lastEventId, reconnects, response }],
            "onEvent"
          );
        }
        yield event;
      }
      clearTimer(idleTimer);
      lastError = void 0;
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
      if (typeof options.onError === "function") {
        const decision = await callHook(
          options.onError,
          [{ attempt: attempts, error: lastError, lastEventId, reconnects, response }],
          "onError"
        );
        if (decision === false) throw lastError;
        if (typeof decision === "number") retryDelayOverride = decision;
      }
      if (!shouldRetryError(lastError, response, retry, fetchStarted)) throw lastError;
    } finally {
      clearTimer(totalTimer);
      await cancelResponseBody(response);
      attempt.dispose();
    }
    if (reconnects >= retry.retries) {
      if (!lastError) {
        if (typeof options.onClose === "function") {
          await callHook(
            options.onClose,
            [{ attempts, lastEventId, reason: "eof", reconnects, response }],
            "onClose"
          );
        }
        return;
      }
      if (retry.retries === 0) throw lastError;
      throw new SSERetryError(attempts, lastError);
    }
    reconnects++;
    let delay = retryDelay(response, serverRetry, reconnects, retry);
    if (retryDelayOverride !== void 0) delay = clampDelay(retryDelayOverride, retry.maxDelay);
    const context = {
      attempt: attempts,
      delay,
      error: lastError,
      lastEventId,
      reconnects,
      response
    };
    if (typeof options.onRetry === "function") {
      const decision = await callHook(options.onRetry, [context], "onRetry");
      if (decision === false) return;
      if (typeof decision === "number") delay = clampDelay(decision, retry.maxDelay);
    }
    await sleep(delay, externalSignal, totalTimeout, startedAt);
  }
}
async function consumeSSE(input, options = {}) {
  let count = 0;
  let lastEventId = options.lastEventId || "";
  for await (const event of fetchSSE(input, options)) {
    count++;
    lastEventId = event.lastEventId;
  }
  return { events: count, lastEventId };
}
async function fetchEventSource(input, options = {}) {
  const mapped = {
    ...options,
    onOpen: options.onopen || options.onOpen,
    onEvent: options.onmessage || options.onEvent,
    onClose: options.onclose || options.onClose,
    async onError(context) {
      if (typeof options.onerror !== "function") {
        return typeof options.onError === "function" ? options.onError(context) : void 0;
      }
      const decision = await options.onerror(context.error);
      return decision === void 0 ? true : decision;
    },
    async onRetry(context) {
      if (typeof options.onRetry === "function") return options.onRetry(context);
      return void 0;
    }
  };
  return consumeSSE(input, mapped);
}
function normalizeRetry(value) {
  const input = value === false ? { retries: 0 } : typeof value === "number" ? { retries: value } : value || {};
  const retries = input.retries === void 0 ? Infinity : input.retries;
  if (retries !== Infinity && (!Number.isSafeInteger(retries) || retries < 0)) {
    throw new RangeError("retry.retries must be a non-negative safe integer or Infinity");
  }
  const minDelay = readDelay(input.minDelay, 1e3, "retry.minDelay");
  const maxDelay = readDelay(input.maxDelay, 3e4, "retry.maxDelay");
  const factor = input.factor === void 0 ? 2 : input.factor;
  if (!Number.isFinite(factor) || factor < 1) throw new RangeError("retry.factor must be at least 1");
  return {
    retries,
    minDelay,
    maxDelay: Math.max(minDelay, maxDelay),
    factor,
    jitter: input.jitter === void 0 ? "full" : input.jitter,
    statusCodes: new Set(input.statusCodes || RETRYABLE_STATUS),
    shouldRetry: input.shouldRetry
  };
}
function validateResponse(response) {
  if (response.status !== 200) {
    throw new SSEHTTPError(`SSE endpoint responded with HTTP ${response.status}`, response);
  }
  const contentType = response.headers && typeof response.headers.get === "function" ? response.headers.get("content-type") : null;
  if (!contentType || contentType.split(";", 1)[0].trim().toLowerCase() !== EVENT_STREAM_CONTENT_TYPE) {
    throw new SSEHTTPError(
      `Expected Content-Type ${EVENT_STREAM_CONTENT_TYPE}; received ${contentType || "none"}`,
      response,
      "ERR_SSE_CONTENT_TYPE"
    );
  }
  if (!response.body) throw new SSEHTTPError("SSE response has no readable body", response);
}
function shouldRetryError(error, response, retry, fetchStarted) {
  if (typeof retry.shouldRetry === "function") return retry.shouldRetry({ error, response }) === true;
  if (error && error.code === "ERR_SSE_CONTENT_TYPE") return false;
  if (!error) return false;
  if (error.code === "ERR_SSE_TIMEOUT") return true;
  if (response && response.status !== 200) return retry.statusCodes.has(response.status);
  if (!fetchStarted) return false;
  return error.name === "TypeError" || NETWORK_ERROR_CODES.has(error.code);
}
function retryDelay(response, serverRetry, reconnects, options) {
  const header = response && response.headers && typeof response.headers.get === "function" ? response.headers.get("retry-after") : null;
  const fromHeader = parseRetryAfter(header);
  if (fromHeader !== void 0) return clampDelay(fromHeader, options.maxDelay);
  if (serverRetry !== void 0) return clampDelay(serverRetry, options.maxDelay);
  const exponential = Math.min(
    options.maxDelay,
    options.minDelay * Math.pow(options.factor, reconnects - 1)
  );
  if (options.jitter === false || options.jitter === "none") return exponential;
  if (typeof options.jitter === "function") return clampDelay(options.jitter(exponential), options.maxDelay);
  return Math.floor(Math.random() * (exponential + 1));
}
function parseRetryAfter(value) {
  if (!value) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1e3);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return void 0;
  return Math.max(0, date - Date.now());
}
function mergeSSEHeaders(input, lastEventId) {
  const entries = [];
  if (input && typeof input[Symbol.iterator] === "function" && typeof input !== "string") {
    for (const pair of input) setHeader(entries, pair[0], pair[1]);
  } else if (input && typeof input.forEach === "function") {
    input.forEach((value, key) => setHeader(entries, key, value));
  } else if (input && typeof input === "object") {
    for (const key of Object.keys(input)) setHeader(entries, key, input[key]);
  }
  if (!hasHeader(entries, "accept")) setHeader(entries, "Accept", EVENT_STREAM_CONTENT_TYPE);
  if (lastEventId) setHeader(entries, "Last-Event-ID", lastEventId);
  else deleteHeader(entries, "last-event-id");
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
  const privateKeys = /* @__PURE__ */ new Set([
    "bodyFactory",
    "connectTimeout",
    "decode",
    "fetch",
    "idleTimeout",
    "lastEventId",
    "onClose",
    "onError",
    "onEvent",
    "onOpen",
    "onRetry",
    "onclose",
    "onerror",
    "onmessage",
    "onopen",
    "openWhenHidden",
    "parser",
    "retry",
    "totalTimeout"
  ]);
  for (const key of Object.keys(options)) if (!privateKeys.has(key)) output[key] = options[key];
  return output;
}
function isReplayableBody(body) {
  if (body === void 0 || body === null) return true;
  if (typeof body === "string") return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof URLSearchParams === "function" && body instanceof URLSearchParams) return true;
  if (typeof Blob === "function" && body instanceof Blob) return true;
  if (typeof FormData === "function" && body instanceof FormData) return true;
  return !(typeof body.getReader === "function" || typeof body[Symbol.asyncIterator] === "function");
}
function cloneInput(input) {
  if (input && typeof input === "object" && typeof input.clone === "function") return input.clone();
  return input;
}
function validateLastEventId(value) {
  if (typeof value !== "string") throw new TypeError("lastEventId must be a string");
  if (value.indexOf("\0") !== -1 || value.indexOf("\r") !== -1 || value.indexOf("\n") !== -1) {
    throw new TypeError("lastEventId cannot contain NUL, CR or LF");
  }
  return value;
}
function createAttemptController(signal) {
  if (typeof AbortController !== "function") throw new Error("AbortController is not available");
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal) signal.addEventListener("abort", forward, { once: true });
  if (signal && signal.aborted) controller.abort();
  return {
    controller,
    abort() {
      controller.abort();
    },
    dispose() {
      if (signal) signal.removeEventListener("abort", forward);
    }
  };
}
async function sleep(delay, signal, totalTimeout, startedAt) {
  if (delay <= 0) return;
  throwIfAborted2(signal);
  let actual = delay;
  if (totalTimeout) {
    const remaining = totalTimeout - (monotonicNow() - startedAt);
    if (remaining <= 0) throw new SSETimeoutError("total", totalTimeout);
    actual = Math.min(actual, remaining);
  }
  await new Promise((resolve, reject) => {
    const done = () => {
      if (signal) signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimer(done, actual);
    const abort = () => {
      clearTimer(timer);
      if (signal) signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
    };
    if (signal) {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }
  });
  if (totalTimeout && monotonicNow() - startedAt >= totalTimeout) {
    throw new SSETimeoutError("total", totalTimeout);
  }
}
function waitForAbort(value, signal, onLateValue) {
  throwIfAborted2(signal);
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      aborted = true;
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
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
  if (timer !== void 0) clearTimeout(timer);
}
function throwIfAborted2(signal) {
  if (signal && signal.aborted) throw abortReason(signal);
}
function abortReason(signal) {
  if (signal && signal.reason instanceof Error) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}
function readDelay(value, fallback, name) {
  const number = value === void 0 ? fallback : value;
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be a non-negative number`);
  return Math.round(number);
}
function readOptionalDelay(value, name) {
  if (value === void 0 || value === null || value === 0) return 0;
  return readDelay(value, 0, name);
}
function clampDelay(value, max) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Retry delay must be a non-negative number");
  return Math.min(Math.round(value), max);
}
function monotonicNow() {
  return typeof performance === "object" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
}
function cancelResponseBody(response) {
  if (!response || !response.body || typeof response.body.cancel !== "function") return;
  try {
    const cancellation = response.body.cancel();
    if (cancellation && typeof cancellation.catch === "function") cancellation.catch(() => {
    });
  } catch (e) {
  }
}
async function callHook(hook, args, name) {
  try {
    return await hook(...args);
  } catch (cause) {
    throw new SSEError(`SSE ${name} callback failed`, "ERR_SSE_CALLBACK", { cause });
  }
}
var NETWORK_ERROR_CODES = /* @__PURE__ */ new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT"
]);

// src/server.js
function createSSEChannel(options = {}) {
  var _a;
  if (typeof ReadableStream !== "function") throw new Error("ReadableStream is not available in this runtime");
  if (typeof TextEncoder !== "function") throw new Error("TextEncoder is not available in this runtime");
  const encoder = new TextEncoder();
  const highWaterMark = readHighWaterMark(options.highWaterMark);
  const heartbeatInterval = readHeartbeatInterval(options.heartbeatInterval);
  const heartbeat = heartbeatInterval ? encoder.encode(encodeSSE({ comment: (_a = options.heartbeatComment) != null ? _a : "keep-alive" }, options)) : void 0;
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
        if (heartbeatTimer && typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
      }
    },
    pull() {
      if (resolveReady) {
        resolveReady();
        resolveReady = void 0;
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
    if (typeof Response !== "function") throw new Error("Response is not available in this runtime");
    if (responseClaimed) throw new Error("SSE channel response has already been created");
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
    if (!open) throw new Error("SSE channel is closed");
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
function eventStreamResponse(source, options = {}) {
  if (typeof ReadableStream !== "function") throw new Error("ReadableStream is not available in this runtime");
  if (typeof Response !== "function") throw new Error("Response is not available in this runtime");
  if (typeof TextEncoder !== "function") throw new Error("TextEncoder is not available in this runtime");
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
        const output = options.json === true ? encodeJSON(item.value.data, item.value, options) : encodeSSE(item.value, options);
        controller.enqueue(encoder.encode(output));
      } catch (error) {
        if (typeof iterator.return === "function") {
          try {
            await iterator.return(error);
          } catch (e) {
          }
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (typeof iterator.return === "function") await iterator.return(reason);
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
  const headers = typeof Headers === "function" ? new Headers(input) : /* @__PURE__ */ new Map();
  const has = (name) => typeof headers.has === "function" && headers.has(name);
  const set = (name, value) => {
    if (typeof headers.set === "function") headers.set(name, value);
  };
  if (!has("Content-Type")) set("Content-Type", `${EVENT_STREAM_CONTENT_TYPE}; charset=utf-8`);
  if (!has("Cache-Control")) set("Cache-Control", "no-cache, no-transform");
  if (!has("X-Accel-Buffering")) set("X-Accel-Buffering", "no");
  return headers;
}
function toIterator(source) {
  if (!source) throw new TypeError("An event iterable is required");
  if (typeof source[Symbol.asyncIterator] === "function") return source[Symbol.asyncIterator]();
  if (typeof source[Symbol.iterator] === "function") {
    const iterator = source[Symbol.iterator]();
    return {
      next() {
        return Promise.resolve(iterator.next());
      },
      return(value) {
        return Promise.resolve(typeof iterator.return === "function" ? iterator.return(value) : { done: true, value });
      }
    };
  }
  throw new TypeError("Events must be an Iterable or AsyncIterable");
}
function readHighWaterMark(value) {
  const number = value === void 0 ? 64 * 1024 : value;
  if (!Number.isFinite(number) || number < 1) throw new RangeError("highWaterMark must be a positive number");
  return number;
}
function readHeartbeatInterval(value) {
  if (value === void 0 || value === null || value === 0) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("heartbeatInterval must be a non-negative number");
  }
  return Math.round(value);
}

// src/index.js
var api = Object.freeze({
  EVENT_STREAM_CONTENT_TYPE,
  EventStreamContentType,
  SSEEncodeError,
  SSEError,
  SSEHTTPError,
  SSEParseError,
  SSEReplayError,
  SSERetryError,
  SSETimeoutError,
  consumeSSE,
  createDecoderStream,
  createEncoderStream,
  createParser,
  createSSEChannel,
  decodeJSON,
  decodeSSE,
  encode,
  encodeComment,
  encodeJSON,
  encodeSSE,
  eventStreamResponse,
  fetchEventSource,
  fetchSSE,
  toAsyncIterable
});
var index_default = api;
export {
  EVENT_STREAM_CONTENT_TYPE,
  EventStreamContentType,
  SSEEncodeError,
  SSEError,
  SSEHTTPError,
  SSEParseError,
  SSEReplayError,
  SSERetryError,
  SSETimeoutError,
  consumeSSE,
  createDecoderStream,
  createEncoderStream,
  createParser,
  createSSEChannel,
  decodeJSON,
  decodeSSE,
  index_default as default,
  encode,
  encodeComment,
  encodeJSON,
  encodeSSE,
  eventStreamResponse,
  fetchEventSource,
  fetchSSE,
  toAsyncIterable
};
//# sourceMappingURL=index.js.map
