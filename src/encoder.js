import { SSEEncodeError } from './errors.js';

export const EVENT_STREAM_CONTENT_TYPE = 'text/event-stream';
export const EventStreamContentType = EVENT_STREAM_CONTENT_TYPE;

export function encodeSSE(message, options = {}) {
  if (!message || typeof message !== 'object') {
    throw new TypeError('SSE message must be an object');
  }
  const newline = options.newline === undefined ? '\n' : options.newline;
  if (newline !== '\n' && newline !== '\r\n') {
    throw new SSEEncodeError('newline must be "\\n" or "\\r\\n"', 'newline');
  }

  const lines = [];
  if (message.comment !== undefined) {
    for (const line of splitLines(toText(message.comment, 'comment'))) lines.push(`:${line ? ` ${line}` : ''}`);
  }
  if (message.event !== undefined && message.event !== '') {
    const value = toText(message.event, 'event');
    assertSingleLine(value, 'event', false);
    lines.push(`event: ${value}`);
  }
  if (message.id !== undefined) {
    const value = toText(message.id, 'id');
    assertSingleLine(value, 'id', true);
    lines.push(`id: ${value}`);
  }
  if (message.retry !== undefined) {
    if (!Number.isSafeInteger(message.retry) || message.retry < 0) {
      throw new SSEEncodeError('retry must be a non-negative safe integer', 'retry');
    }
    lines.push(`retry: ${message.retry}`);
  }
  if (message.data !== undefined) {
    for (const line of splitLines(toText(message.data, 'data'))) lines.push(`data: ${line}`);
  }
  if (lines.length === 0) {
    throw new SSEEncodeError('SSE message must contain data, comment, event, id or retry', 'message');
  }
  return `${lines.join(newline)}${newline}${newline}`;
}

export const encode = encodeSSE;

export function encodeJSON(data, fields = {}, options = {}) {
  let encoded;
  try {
    encoded = JSON.stringify(data, options.replacer);
  } catch (error) {
    throw new SSEEncodeError('Unable to encode SSE JSON data', 'data', error);
  }
  if (encoded === undefined) {
    throw new SSEEncodeError('JSON data cannot be undefined, a function or a symbol', 'data');
  }
  return encodeSSE({ ...fields, data: encoded }, options);
}

export function encodeComment(comment, options = {}) {
  return encodeSSE({ comment }, options);
}

export function createEncoderStream(options = {}) {
  const Transform = getTransformStream();
  const bytes = options.bytes !== false;
  const encoder = bytes ? getTextEncoder() : null;
  return new Transform({
    transform(message, controller) {
      const output = options.json === true
        ? encodeJSON(message.data, message, options)
        : encodeSSE(message, options);
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
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  throw new SSEEncodeError(`${field} must be a string or primitive value`, field);
}

function assertSingleLine(value, field, rejectNul) {
  if (value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1 || (rejectNul && value.indexOf('\0') !== -1)) {
    throw new SSEEncodeError(`${field} contains a forbidden control character`, field);
  }
}

function getTransformStream() {
  if (typeof TransformStream !== 'function') {
    throw new Error('TransformStream is not available in this runtime');
  }
  return TransformStream;
}

function getTextEncoder() {
  if (typeof TextEncoder !== 'function') throw new Error('TextEncoder is not available in this runtime');
  return new TextEncoder();
}
