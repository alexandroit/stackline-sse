export class SSEError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details && details.cause !== undefined) this.cause = details.cause;
  }
}

export class SSEParseError extends SSEError {
  constructor(message, details = {}) {
    super(message, details.code || 'ERR_SSE_PARSE', details);
    this.fatal = details.fatal === true;
    if (details.field !== undefined) this.field = details.field;
    if (details.line !== undefined) this.line = details.line;
    if (details.limit !== undefined) this.limit = details.limit;
  }
}

export class SSEEncodeError extends SSEError {
  constructor(message, field, cause) {
    super(message, 'ERR_SSE_ENCODE', { cause });
    this.field = field;
  }
}

export class SSEHTTPError extends SSEError {
  constructor(message, response, code = 'ERR_SSE_HTTP') {
    super(message, code);
    this.response = response;
    this.status = response && typeof response.status === 'number' ? response.status : 0;
  }
}

export class SSETimeoutError extends SSEError {
  constructor(phase, timeout, cause) {
    super(`SSE ${phase} timeout after ${timeout}ms`, 'ERR_SSE_TIMEOUT', { cause });
    this.phase = phase;
    this.timeout = timeout;
  }
}

export class SSERetryError extends SSEError {
  constructor(attempts, cause) {
    super(`SSE retry budget exhausted after ${attempts} attempt${attempts === 1 ? '' : 's'}`, 'ERR_SSE_RETRY', { cause });
    this.attempts = attempts;
  }
}

export class SSEReplayError extends SSEError {
  constructor() {
    super(
      'The request body cannot be replayed. Provide bodyFactory or disable reconnection.',
      'ERR_SSE_BODY_REPLAY'
    );
  }
}
