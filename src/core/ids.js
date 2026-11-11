import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Sortable-ish identifier: `<prefix>_<time36><random>`.
 * The timestamp prefix keeps recent ids near each other in lexical order,
 * while the random suffix removes the need for a global counter.
 */
export function makeId(prefix = 'id', now = Date.now(), random = randomBytes(8)) {
  const stamp = Math.max(0, Math.floor(now)).toString(36).padStart(9, '0');
  let suffix = '';
  for (const byte of random) suffix += ALPHABET[byte % 36];
  const clean = String(prefix || 'id').replace(/[^a-z0-9_]/gi, '').slice(0, 12) || 'id';
  return `${clean}_${stamp}${suffix.slice(0, 8)}`;
}

export function eventId(now = Date.now()) {
  return makeId('evt', now);
}

export function traceId(now = Date.now()) {
  return makeId('trc', now);
}

export function factId(now = Date.now()) {
  return makeId('fct', now);
}

export function entityId(now = Date.now()) {
  return makeId('ent', now);
}

export function edgeId(now = Date.now()) {
  return makeId('edg', now);
}

export function jobId(now = Date.now()) {
  return makeId('job', now);
}

export function skillId(now = Date.now()) {
  return makeId('skl', now);
}

export function summaryId(now = Date.now()) {
  return makeId('sum', now);
}

export function policyId(now = Date.now()) {
  return makeId('pol', now);
}

export function auditId(now = Date.now()) {
  return makeId('aud', now);
}

export function feedbackId(now = Date.now()) {
  return makeId('fbk', now);
}

/** Stable content hash for dedupe; short by default, full for audit. */
export function hashText(text, length = 16) {
  return createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, length);
}

/** Hash chaining for the event ledger. */
export function chainHash(prevHash, payloadJson) {
  return createHash('sha256').update(`${prevHash ?? ''}\n${payloadJson}`).digest('hex');
}
