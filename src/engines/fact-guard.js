/**
 * Fact guard. The 0.4.22 store had facts whose subject was a stray character
 * ("现", "只", "还") and whose object was punctuation. They came from the LLM
 * extractor, which trusted whatever JSON it got back. This module is the single
 * place that decides whether a candidate is a fact at all.
 */
const PUNCT_ONLY = /^[\s\p{P}\p{S}]+$/u;
const FORBIDDEN_ENTITY = /[|`<>{}\[\]\\\n\r]/;
const FUNCTION_WORDS = new Set([
  '他', '她', '它', '这', '那', '现', '只', '还', '也', '就', '又', '都',
  '和', '与', '或', '但', '而', '所以', '因为', '如果', '然后', '而且', '但是',
]);

function entityOk(value, max = 24) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) return false;
  if (PUNCT_ONLY.test(text)) return false;
  if (FORBIDDEN_ENTITY.test(text)) return false;
  if (FUNCTION_WORDS.has(text)) return false;
  if (/^[0-9]{1,2}$/.test(text)) return false;
  return true;
}

function predicateOk(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(text)) return null;
  return text;
}

/**
 * Returns a normalized candidate, or null when the triple is not worth storing.
 * A null here is the expected outcome for most extracted junk.
 */
export function guardFactCandidate(candidate = {}) {
  const subject = String(candidate.subject ?? '').trim();
  const object = String(candidate.object ?? '').trim();
  const predicate = predicateOk(candidate.predicate);
  if (!predicate) return null;
  if (!entityOk(subject, 24)) return null;
  if (!entityOk(object, 40)) return null;
  const raw = Number(candidate.confidence ?? 0.6);
  if (!Number.isFinite(raw)) return null;
  return {
    subject,
    predicate,
    object,
    confidence: Math.min(1, Math.max(0, raw)),
  };
}

export { entityOk, predicateOk };
