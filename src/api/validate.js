import { CortexError, ERROR_CODES } from '../core/errors.js';

function fail(message) {
  throw new CortexError(ERROR_CODES.INVALID_INPUT, message);
}

export function requireString(value, name, { min = 1, max = 20000, optional = false } = {}) {
  if (value == null && optional) return undefined;
  if (typeof value !== 'string') fail(`${name} must be a string`);
  const text = value.trim();
  if (text.length < min) fail(`${name} is too short`);
  if (text.length > max) fail(`${name} is too long`);
  return text;
}

export function optionalNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (value == null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail(`${name} is out of range`);
  return number;
}

export function optionalBoolean(value, name) {
  if (value == null) return undefined;
  if (typeof value !== 'boolean') fail(`${name} must be a boolean`);
  return value;
}

export function optionalStringArray(value, name, { max = 50 } = {}) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string')) fail(`${name} must be a string array`);
  return value.map((item) => item.trim()).filter(Boolean);
}

export function validateWrite(body) {
  return {
    text: requireString(body.text, 'text'),
    kind: requireString(body.kind, 'kind', { optional: true, max: 40 }),
    title: requireString(body.title, 'title', { optional: true, max: 200 }),
    tags: optionalStringArray(body.tags, 'tags'),
    importance: optionalNumber(body.importance, 'importance', { min: 0, max: 1 }),
    explicit: optionalBoolean(body.explicit, 'explicit'),
    operationId: requireString(body.operationId, 'operationId', { optional: true, max: 200 }),
  };
}

export function validateFeedback(body) {
  return {
    id: requireString(body.id, 'id', { max: 200 }),
    signal: requireString(body.signal, 'signal', { max: 40 }),
    predicted: optionalNumber(body.predicted, 'predicted', { min: 0, max: 1 }),
    outcome: optionalNumber(body.outcome, 'outcome', { min: 0, max: 1 }),
  };
}

export function validateForget(body) {
  const mode = body.mode ?? 'archive';
  if (!['archive', 'delete'].includes(mode)) fail('mode must be archive or delete');
  return { id: requireString(body.id, 'id', { max: 200 }), mode };
}

export function validateSearch(body) {
  return {
    query: requireString(body.query, 'query', { min: 1, max: 2000 }),
    limit: optionalNumber(body.limit, 'limit', { min: 1, max: 20 }),
    budget: optionalNumber(body.budget, 'budget', { min: 64, max: 20000 }),
  };
}
