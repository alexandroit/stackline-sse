import { SSEParseError } from './errors.js';

const DEFAULT_MAX_EVENT_SIZE = 1024 * 1024;
const DEFAULT_MAX_LINE_LENGTH = 1024 * 1024;
const LF = 10;
const CR = 13;
const SPACE = 32;
const BOM = 0xfeff;
const NUL = '\0';

const noop = () => {};

export function createParser(config = {}) {
  if (typeof config === 'function') config = { onEvent: config };
  if (!config || typeof config !== 'object') {
    throw new TypeError('Parser configuration must be an object or event callback');
  }

  const onEvent = typeof config.onEvent === 'function' ? config.onEvent : noop;
  const onComment = typeof config.onComment === 'function' ? config.onComment : noop;
  const onRetry = typeof config.onRetry === 'function' ? config.onRetry : noop;
  const onError = typeof config.onError === 'function' ? config.onError : noop;
  const onId = typeof config.onId === 'function' ? config.onId : noop;
  const strict = config.strict === true;
  const fatalUTF8 = config.fatalUTF8 === true;
  const maxEventSize = readLimit(
    config.maxEventSize === undefined ? config.maxBufferSize : config.maxEventSize,
    DEFAULT_MAX_EVENT_SIZE,
    'maxEventSize'
  );
  const maxLineLength = readLimit(
    config.maxLineLength,
    DEFAULT_MAX_LINE_LENGTH,
    'maxLineLength'
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
      throw new SSEParseError('Parser is terminated; call reset() before feeding more data', {
        code: 'ERR_SSE_TERMINATED',
        fatal: true
      });
    }
    if (typeof chunk === 'string') {
      if (inputMode === 'bytes') {
        throw fatal('Cannot mix string and byte chunks in one parser stream', 'ERR_SSE_CHUNK_TYPE');
      }
      inputMode = 'string';
      characters += chunk.length;
      processText(chunk);
      return api;
    }
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError('SSE parser chunks must be strings or Uint8Array values');
    }
    if (inputMode === 'string') {
      throw fatal('Cannot mix string and byte chunks in one parser stream', 'ERR_SSE_CHUNK_TYPE');
    }
    inputMode = 'bytes';
    bytes += chunk.byteLength;
    let text;
    try {
      text = getDecoder().decode(chunk, { stream: true });
    } catch (error) {
      if (error instanceof SSEParseError) throw error;
      throw fatal('Invalid UTF-8 in the SSE stream', 'ERR_SSE_UTF8', { cause: error });
    }
    characters += text.length;
    processText(text);
    return api;
  }

  function end() {
    if (terminated) return api;
    if (decoder) {
      try {
        const tail = decoder.decode();
        characters += tail.length;
        processText(tail);
      } catch (error) {
        throw fatal('Invalid UTF-8 at the end of the SSE stream', 'ERR_SSE_UTF8', { cause: error });
      }
    }
    discardPendingEvent();
    clearLine();
    return api;
  }

  function reset(options = {}) {
    if (options && options.consume && lineLength > 0) processLine(joinLine());
    const preserve = Boolean(options && options.preserveLastEventId);
    const nextId = preserve ? committedId : normalizeInitialId(config.lastEventId);
    decoder = undefined;
    inputMode = undefined;
    lineFragments = [];
    lineLength = 0;
    skipLeadingLF = false;
    atStart = true;
    dataLines = [];
    eventSize = 0;
    eventType = undefined;
    idBuffer = nextId;
    committedId = nextId;
    hasPendingId = false;
    terminated = false;
    bytes = 0;
    characters = 0;
    events = 0;
    comments = 0;
    retries = 0;
    return api;
  }

  function processText(input) {
    let text = input;
    if (atStart && text.length > 0) {
      atStart = false;
      if (text.charCodeAt(0) === BOM) text = text.slice(1);
    }
    if (text.length === 0) return;

    if (!skipLeadingLF && text.indexOf('\r') === -1) {
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
    let end = text.indexOf('\n');
    while (end !== -1) {
      if (
        lineLength === 0 &&
        dataLines.length === 0 &&
        text.charCodeAt(end + 1) === LF &&
        isDataPrefix(text, start)
      ) {
        const valueStart = text.charCodeAt(start + 5) === SPACE ? start + 6 : start + 5;
        const value = text.slice(valueStart, end);
        if (end - start > maxLineLength) {
          throw fatal(`SSE line exceeded ${maxLineLength} characters`, 'ERR_SSE_LINE_LIMIT', {
            limit: maxLineLength
          });
        }
        addEventSize(value.length + 1);
        dispatchSingleData(value);
        start = end + 2;
        end = text.indexOf('\n', start);
        continue;
      }
      if (lineLength > 0) {
        appendLine(text.slice(start, end));
        processLine(joinLine());
        clearLine();
      } else {
        const length = end - start;
        if (length > maxLineLength) {
          throw fatal(`SSE line exceeded ${maxLineLength} characters`, 'ERR_SSE_LINE_LIMIT', {
            limit: maxLineLength
          });
        }
        processLine(text.slice(start, end));
      }
      start = end + 1;
      end = text.indexOf('\n', start);
    }
    appendLine(text.slice(start));
  }

  function appendLine(fragment) {
    if (!fragment) return;
    lineFragments.push(fragment);
    lineLength += fragment.length;
    if (lineLength > maxLineLength) {
      throw fatal(`SSE line exceeded ${maxLineLength} characters`, 'ERR_SSE_LINE_LIMIT', {
        limit: maxLineLength
      });
    }
  }

  function joinLine() {
    if (lineFragments.length === 0) return '';
    if (lineFragments.length === 1) return lineFragments[0];
    return lineFragments.join('');
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
    if (
      first === 100 &&
      line.charCodeAt(1) === 97 &&
      line.charCodeAt(2) === 116 &&
      line.charCodeAt(3) === 97 &&
      line.charCodeAt(4) === 58
    ) {
      const start = line.charCodeAt(5) === SPACE ? 6 : 5;
      const value = line.slice(start);
      addEventSize(value.length + 1);
      dataLines.push(value);
      return;
    }
    if (
      first === 101 &&
      line.charCodeAt(1) === 118 &&
      line.charCodeAt(2) === 101 &&
      line.charCodeAt(3) === 110 &&
      line.charCodeAt(4) === 116 &&
      line.charCodeAt(5) === 58
    ) {
      const start = line.charCodeAt(6) === SPACE ? 7 : 6;
      const value = line.slice(start);
      addEventSize(value.length);
      eventType = value || undefined;
      return;
    }
    if (first === 105 && line.charCodeAt(1) === 100 && line.charCodeAt(2) === 58) {
      const start = line.charCodeAt(3) === SPACE ? 4 : 3;
      const value = line.slice(start);
      if (value.indexOf(NUL) === -1) {
        addEventSize(value.length);
        idBuffer = value;
        hasPendingId = true;
      }
      return;
    }
    if (
      first === 114 &&
      line.charCodeAt(1) === 101 &&
      line.charCodeAt(2) === 116 &&
      line.charCodeAt(3) === 114 &&
      line.charCodeAt(4) === 121 &&
      line.charCodeAt(5) === 58
    ) {
      const start = line.charCodeAt(6) === SPACE ? 7 : 6;
      processRetry(line.slice(start), line);
      return;
    }

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.charCodeAt(0) === SPACE) value = value.slice(1);

    switch (field) {
      case 'data':
        addEventSize(value.length + 1);
        dataLines.push(value);
        break;
      case 'event':
        addEventSize(value.length);
        eventType = value || undefined;
        break;
      case 'id':
        if (value.indexOf(NUL) === -1) {
          addEventSize(value.length);
          idBuffer = value;
          hasPendingId = true;
        }
        break;
      case 'retry':
        processRetry(value, line);
        break;
      default:
        if (strict) recoverable(`Unknown SSE field "${truncate(field)}"`, 'ERR_SSE_UNKNOWN_FIELD', {
          field,
          line
        });
    }
  }

  function processRetry(value, line) {
    if (!isAsciiDigits(value)) {
      if (strict) recoverable(`Invalid SSE retry value "${truncate(value)}"`, 'ERR_SSE_RETRY_VALUE', {
        field: 'retry',
        line
      });
      return;
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      if (strict) recoverable('SSE retry value exceeds the safe integer range', 'ERR_SSE_RETRY_VALUE', {
        field: 'retry',
        line
      });
      return;
    }
    retries++;
    onRetry(number);
  }

  function dispatchEvent() {
    const eventId = hasPendingId ? idBuffer : undefined;
    if (hasPendingId) {
      committedId = idBuffer;
      hasPendingId = false;
      onId(committedId);
    }
    if (dataLines.length === 0) {
      eventType = undefined;
      eventSize = 0;
      return;
    }
    const event = {
      data: dataLines.join('\n'),
      id: eventId,
      event: eventType,
      lastEventId: committedId
    };
    events++;
    dataLines = [];
    eventType = undefined;
    eventSize = 0;
    onEvent(event);
  }

  function dispatchSingleData(data) {
    const eventId = hasPendingId ? idBuffer : undefined;
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
    eventType = undefined;
    eventSize = 0;
    onEvent(event);
  }

  function addEventSize(amount) {
    eventSize += amount;
    if (eventSize > maxEventSize) {
      throw fatal(`SSE event exceeded ${maxEventSize} characters`, 'ERR_SSE_EVENT_LIMIT', {
        limit: maxEventSize
      });
    }
  }

  function discardPendingEvent() {
    dataLines = [];
    eventType = undefined;
    eventSize = 0;
    hasPendingId = false;
    idBuffer = committedId;
  }

  function getDecoder() {
    if (!decoder) {
      if (typeof TextDecoder !== 'function') {
        throw fatal('TextDecoder is required for byte chunks', 'ERR_SSE_TEXT_DECODER');
      }
      decoder = new TextDecoder('utf-8', { fatal: fatalUTF8 });
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
    eventType = undefined;
    eventSize = 0;
    const error = new SSEParseError(message, { ...details, code, fatal: true });
    onError(error);
    return error;
  }

  const api = {
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

  return api;
}

function readLimit(value, fallback, name) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return limit;
}

function normalizeInitialId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeError('lastEventId must be a string');
  if (value.indexOf(NUL) !== -1 || value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) {
    throw new TypeError('lastEventId cannot contain NUL, CR or LF');
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
  return (
    value.charCodeAt(index) === 100 &&
    value.charCodeAt(index + 1) === 97 &&
    value.charCodeAt(index + 2) === 116 &&
    value.charCodeAt(index + 3) === 97 &&
    value.charCodeAt(index + 4) === 58
  );
}
