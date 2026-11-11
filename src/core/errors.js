export const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  NOT_READY: 'NOT_READY',
  UNSUPPORTED: 'UNSUPPORTED',
  INTERNAL: 'INTERNAL',
  LIMIT: 'LIMIT',
});

export class CortexError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CortexError';
    this.code = code || ERROR_CODES.INTERNAL;
    this.details = details;
  }
}

export function fail(code, message, details = null) {
  throw new CortexError(code, message, details);
}

export function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

export function toPublicError(value) {
  const error = asError(value);
  return {
    code: error.code ?? ERROR_CODES.INTERNAL,
    message: error.message,
    details: error.details ?? null,
  };
}
