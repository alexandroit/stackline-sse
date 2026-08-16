export type SSEChunk = string | Uint8Array;

export interface SSEEvent<T = string> {
  data: T;
  event?: string;
  id?: string;
  lastEventId: string;
}

export interface SSEMessage {
  comment?: string | number | boolean | bigint;
  data?: string | number | boolean | bigint;
  event?: string | number | boolean | bigint;
  id?: string | number | boolean | bigint;
  retry?: number;
}

export interface SSEParserState {
  readonly buffered: number;
  readonly bytes: number;
  readonly characters: number;
  readonly comments: number;
  readonly events: number;
  readonly lastEventId: string;
  readonly retries: number;
  readonly terminated: boolean;
}

export interface SSEParserOptions {
  fatalUTF8?: boolean;
  lastEventId?: string;
  maxBufferSize?: number;
  maxEventSize?: number;
  maxLineLength?: number;
  strict?: boolean;
  onComment?(comment: string): void;
  onError?(error: SSEParseError): void;
  onEvent?(event: SSEEvent): void;
  onId?(lastEventId: string): void;
  onRetry?(milliseconds: number): void;
}

export interface SSEParser {
  readonly state: SSEParserState;
  feed(chunk: SSEChunk): SSEParser;
  end(): SSEParser;
  reset(options?: { consume?: boolean; preserveLastEventId?: boolean }): SSEParser;
}

export interface SSEEncoderOptions {
  bytes?: boolean;
  json?: boolean;
  newline?: '\n' | '\r\n';
  replacer?: (this: any, key: string, value: any) => any;
}

export interface AsyncIteratorLike<T> {
  next(): Promise<IteratorResult<T>>;
  return?(value?: any): Promise<IteratorResult<T>>;
}

export interface AsyncIterableLike<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export interface ReadableStreamReaderLike<T> {
  read(): Promise<IteratorResult<T>>;
  cancel?(reason?: any): Promise<void>;
  releaseLock?(): void;
}

export interface ReadableStreamLike<T> {
  getReader(): ReadableStreamReaderLike<T>;
}

export interface SSEHeadersLike {
  get(name: string): string | null;
  forEach?(callback: (value: string, key: string) => void): void;
}

export interface SSEResponseLike {
  readonly body: ReadableStreamLike<Uint8Array> | AsyncIterableLike<Uint8Array> | null;
  readonly headers: SSEHeadersLike;
  readonly ok?: boolean;
  readonly redirected?: boolean;
  readonly status: number;
  readonly statusText?: string;
  readonly url?: string;
}

export type SSESource =
  | { body: ReadableStreamLike<SSEChunk> | AsyncIterableLike<SSEChunk> | null }
  | ReadableStreamLike<SSEChunk>
  | AsyncIterable<SSEChunk>
  | Iterable<SSEChunk>;

export interface SSEDecodeOptions extends SSEParserOptions {
  feedSize?: number;
  maxQueuedEvents?: number;
  parser?: SSEParserOptions;
  signal?: AbortSignalLike;
  onChunk?(chunk: SSEChunk): void;
}

export interface SSEJSONDecodeOptions extends SSEDecodeOptions {
  doneSentinel?: string | false;
  ignoreInvalidJSON?: boolean;
  reviver?: (this: any, key: string, value: any) => any;
}

export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: any;
  addEventListener(type: 'abort', listener: () => void, options?: any): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export type FetchLike = (input: any, init?: any) => Promise<SSEResponseLike>;

export interface SSERetryOptions {
  factor?: number;
  jitter?: 'full' | 'none' | false | ((maximumDelay: number) => number);
  maxDelay?: number;
  minDelay?: number;
  retries?: number;
  statusCodes?: Iterable<number>;
  shouldRetry?(context: { error: any; response?: SSEResponseLike }): boolean;
}

export interface SSEClientContext {
  attempts: number;
  lastEventId: string;
  reconnects: number;
  response?: SSEResponseLike;
}

export interface SSERetryContext {
  attempt: number;
  delay: number;
  error?: any;
  lastEventId: string;
  reconnects: number;
  response?: SSEResponseLike;
}

export interface SSEClientErrorContext {
  attempt: number;
  error: any;
  lastEventId: string;
  reconnects: number;
  response?: SSEResponseLike;
}

export interface SSEFetchOptions {
  body?: any;
  bodyFactory?(context: { attempt: number; lastEventId: string; signal: AbortSignalLike }): any | Promise<any>;
  cache?: string;
  connectTimeout?: number;
  decode?: SSEDecodeOptions;
  fetch?: FetchLike;
  headers?: any;
  idleTimeout?: number;
  lastEventId?: string;
  method?: string;
  parser?: SSEParserOptions;
  retry?: false | number | SSERetryOptions;
  signal?: AbortSignalLike;
  totalTimeout?: number;
  onClose?(context: SSEClientContext & { reason: string }): void | Promise<void>;
  onEvent?(event: SSEEvent, context: SSEClientContext): void | Promise<void>;
  onError?(context: SSEClientErrorContext): void | false | number | Promise<void | false | number>;
  onOpen?(response: SSEResponseLike, context: SSEClientContext): void | boolean | Promise<void | boolean>;
  onRetry?(context: SSERetryContext): void | false | number | Promise<void | false | number>;
  [key: string]: any;
}

export interface FetchEventSourceOptions extends SSEFetchOptions {
  onclose?(context?: any): void | Promise<void>;
  onerror?(error: any): any;
  onmessage?(event: SSEEvent): void | Promise<void>;
  onopen?(response: SSEResponseLike): void | boolean | Promise<void | boolean>;
  openWhenHidden?: boolean;
}

export interface SSEConsumeResult {
  events: number;
  lastEventId: string;
}

export interface SSEChannel {
  readonly stream: ReadableStreamLike<Uint8Array>;
  readonly closed: Promise<any>;
  readonly open: boolean;
  readonly ready: Promise<void>;
  close(): void;
  comment(value: string): boolean;
  error(reason: any): void;
  send(message: SSEMessage): boolean;
  sendJSON(data: any, fields?: Omit<SSEMessage, 'data'>): boolean;
  toResponse(init?: any): any;
}

export interface SSEChannelOptions extends SSEEncoderOptions {
  heartbeatComment?: string;
  heartbeatInterval?: number;
  highWaterMark?: number;
}

export class SSEError extends Error {
  constructor(message: string, code: string, details?: { cause?: any });
  readonly code: string;
  readonly cause?: any;
}

export class SSEParseError extends SSEError {
  constructor(message: string, details?: any);
  readonly fatal: boolean;
  readonly field?: string;
  readonly line?: string;
  readonly limit?: number;
}

export class SSEEncodeError extends SSEError {
  constructor(message: string, field: string, cause?: any);
  readonly field: string;
}

export class SSEHTTPError extends SSEError {
  constructor(message: string, response: SSEResponseLike, code?: string);
  readonly response: SSEResponseLike;
  readonly status: number;
}

export class SSETimeoutError extends SSEError {
  constructor(phase: string, timeout: number, cause?: any);
  readonly phase: string;
  readonly timeout: number;
}

export class SSERetryError extends SSEError {
  constructor(attempts: number, cause?: any);
  readonly attempts: number;
}

export class SSEReplayError extends SSEError {}

export const EVENT_STREAM_CONTENT_TYPE: 'text/event-stream';
export const EventStreamContentType: 'text/event-stream';

export function createParser(config?: SSEParserOptions | ((event: SSEEvent) => void)): SSEParser;
export function encodeSSE(message: SSEMessage, options?: SSEEncoderOptions): string;
export const encode: typeof encodeSSE;
export function encodeJSON(data: any, fields?: Omit<SSEMessage, 'data'>, options?: SSEEncoderOptions): string;
export function encodeComment(comment: string, options?: SSEEncoderOptions): string;
export function createEncoderStream(options?: SSEEncoderOptions): any;
export function decodeSSE(source: SSESource, options?: SSEDecodeOptions): AsyncGenerator<SSEEvent, void, unknown>;
export function decodeJSON<T = any>(source: SSESource, options?: SSEJSONDecodeOptions): AsyncGenerator<SSEEvent<T>, void, unknown>;
export function createDecoderStream(options?: SSEDecodeOptions): any;
export function toAsyncIterable(source: SSESource): AsyncIterable<SSEChunk>;
export function fetchSSE(input: any, options?: SSEFetchOptions): AsyncGenerator<SSEEvent, void, unknown>;
export function consumeSSE(input: any, options?: SSEFetchOptions): Promise<SSEConsumeResult>;
export function fetchEventSource(input: any, options?: FetchEventSourceOptions): Promise<SSEConsumeResult>;
export function createSSEChannel(options?: SSEChannelOptions): SSEChannel;
export function eventStreamResponse(source: Iterable<SSEMessage> | AsyncIterable<SSEMessage>, options?: SSEChannelOptions & { headers?: any; status?: number; statusText?: string; json?: boolean }): any;

declare const api: {
  EVENT_STREAM_CONTENT_TYPE: typeof EVENT_STREAM_CONTENT_TYPE;
  EventStreamContentType: typeof EventStreamContentType;
  SSEEncodeError: typeof SSEEncodeError;
  SSEError: typeof SSEError;
  SSEHTTPError: typeof SSEHTTPError;
  SSEParseError: typeof SSEParseError;
  SSEReplayError: typeof SSEReplayError;
  SSERetryError: typeof SSERetryError;
  SSETimeoutError: typeof SSETimeoutError;
  consumeSSE: typeof consumeSSE;
  createDecoderStream: typeof createDecoderStream;
  createEncoderStream: typeof createEncoderStream;
  createParser: typeof createParser;
  createSSEChannel: typeof createSSEChannel;
  decodeJSON: typeof decodeJSON;
  decodeSSE: typeof decodeSSE;
  encode: typeof encode;
  encodeComment: typeof encodeComment;
  encodeJSON: typeof encodeJSON;
  encodeSSE: typeof encodeSSE;
  eventStreamResponse: typeof eventStreamResponse;
  fetchEventSource: typeof fetchEventSource;
  fetchSSE: typeof fetchSSE;
  toAsyncIterable: typeof toAsyncIterable;
};

export default api;
