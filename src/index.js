export {
  SSEError,
  SSEEncodeError,
  SSEHTTPError,
  SSEParseError,
  SSEReplayError,
  SSERetryError,
  SSETimeoutError
} from './errors.js';
export { createParser } from './parser.js';
export {
  EVENT_STREAM_CONTENT_TYPE,
  EventStreamContentType,
  createEncoderStream,
  encode,
  encodeComment,
  encodeJSON,
  encodeSSE
} from './encoder.js';
export { createDecoderStream, decodeJSON, decodeSSE, toAsyncIterable } from './iterable.js';
export { consumeSSE, fetchEventSource, fetchSSE } from './client.js';
export { createSSEChannel, eventStreamResponse } from './server.js';

import { createParser } from './parser.js';
import {
  EVENT_STREAM_CONTENT_TYPE,
  EventStreamContentType,
  createEncoderStream,
  encode,
  encodeComment,
  encodeJSON,
  encodeSSE
} from './encoder.js';
import {
  SSEEncodeError,
  SSEError,
  SSEHTTPError,
  SSEParseError,
  SSEReplayError,
  SSERetryError,
  SSETimeoutError
} from './errors.js';
import { createDecoderStream, decodeJSON, decodeSSE, toAsyncIterable } from './iterable.js';
import { consumeSSE, fetchEventSource, fetchSSE } from './client.js';
import { createSSEChannel, eventStreamResponse } from './server.js';

const api = Object.freeze({
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

export default api;
