import { hashText } from '../core/ids.js';
import { clamp, nowIso } from '../core/time.js';
import { estimateTokens } from '../memory/tokenizer.js';
import { CortexError, ERROR_CODES } from '../core/errors.js';
import { scanText } from '../guardian/scanner.js';

const HIGH_SIGNAL = [
  { pattern: /决定|确定|定了|采用|选择/, kind: 'decision', weight: 0.22 },
  { pattern: /答应|承诺|会买|会去|会一直|说好/, kind: 'promise', weight: 0.2 },
  { pattern: /喜欢|爱|讨厌|不喜欢|偏好|prefer/i, kind: 'preference', weight: 0.18 },
  { pattern: /难过|开心|心疼|累了|焦虑|温暖|害怕|生气/, kind: 'emotion', weight: 0.16 },
  { pattern: /记住|别忘了|重要|一定要/, kind: 'instruction', weight: 0.2 },
];

const EMOTION_VALENCE = [
  [/开心|高兴|温暖|喜欢|爱|甜|安心/, 0.7],
  [/难过|伤心|心疼|焦虑|害怕|生气|累|孤独/, -0.6],
];

const STOP_PHRASES = new Set(['嗯', '好', '好的', '谢谢', '在吗', '收到', 'ok', 'okay']);

export function scoreTraceText(text, { kind = null, importance = null } = {}) {
  const value = String(text ?? '').trim();
  let importanceScore = Number.isFinite(importance) ? clamp(importance, 0, 1) : 0.42;
  let candidateKind = kind || 'utterance';
  let valence = 0;
  if (!kind) {
    let best = null;
    for (const signal of HIGH_SIGNAL) {
      if (signal.pattern.test(value) && (!best || signal.weight > best.weight)) best = signal;
    }
    if (best) {
      candidateKind = best.kind;
      importanceScore += best.weight;
    }
  }
  for (const [pattern, v] of EMOTION_VALENCE) {
    if (pattern.test(value)) valence = v;
  }
  const salience = clamp(0.3 + Math.abs(valence) * 0.6 + Math.min(0.2, value.length / 500), 0, 1);
  importanceScore += Math.min(0.15, value.length / 400);
  if (salience > 0.6) importanceScore += 0.08;
  return {
    kind: candidateKind,
    importance: clamp(importanceScore, 0, 1),
    salience,
    valence,
    arousal: clamp(Math.abs(valence) * 0.8 + 0.1, 0, 1),
  };
}

export function compressionValue(text, { importance = 0.5, salience = 0.5 } = {}) {
  const cost = Math.max(1, estimateTokens(text));
  return (importance * (0.6 + salience * 0.8)) / cost;
}

export function createEncodeEngine({
  events,
  traces,
  entities = null,
  facts = null,
  edges = null,
  audit = null,
  vector = null,
  config = {},
} = {}) {
  if (!events || !traces) throw new CortexError(ERROR_CODES.INVALID_INPUT, 'encode engine needs events and traces');
  const minChars = config.minContentChars ?? 2;
  const minCompression = config.minCompressionValue ?? 0.08;

  function applyFacts(rawFacts, { scopeId, recordedAt, sourceEventId }) {
    const resolved = [];
    if (!Array.isArray(rawFacts) || !entities || !facts) return resolved;
    for (const raw of rawFacts) {
      if (!raw || !raw.subject || !raw.predicate) continue;
      const subject = entities.upsert({ scopeId, name: raw.subject, type: raw.subjectType || 'concept' });
      let objectId = null;
      const objectLiteral = raw.objectLiteral ?? null;
      if (raw.object && !raw.objectLiteral) {
        const object = entities.upsert({ scopeId, name: raw.object, type: raw.objectType || 'concept' });
        objectId = object.id;
      }
      const resolution = facts.resolve({
        scopeId,
        subjectId: subject.id,
        predicate: raw.predicate,
        objectId,
        objectLiteral,
        validFrom: raw.validFrom || recordedAt,
        validTo: raw.validTo || null,
        recordedAt,
        confidence: raw.confidence ?? 0.7,
        sourceEventId,
      });
      resolved.push(resolution);
    }
    return resolved;
  }

  function queueFactEdges(resolvedFacts, { scopeId, sourceEventId, sourceTraceId }) {
    if (!edges || !Array.isArray(resolvedFacts) || resolvedFacts.length === 0) return [];
    const queued = [];
    for (const resolution of resolvedFacts) {
      const fact = resolution?.fact;
      if (!fact?.subjectId || !fact?.objectId || fact.status !== 'active') continue;
      try {
        queued.push(edges.addCandidate({
          scopeId,
          fromId: fact.subjectId,
          toId: fact.objectId,
          rel: fact.predicate,
          weight: fact.confidence ?? 0.5,
          confidence: fact.confidence ?? 0.5,
          sourceEventId,
          sourceTraceId,
          evidence: { factId: fact.id ?? null, validFrom: fact.validFrom ?? null },
        }));
      } catch {
        /* a bad candidate should not fail the write */
      }
    }
    return queued;
  }

  function encode(input = {}) {
    const original = String(input.text ?? input.content ?? '').trim();
    const scanned = scanText(original);
    const text = scanned.text.trim();
    if (text.length < minChars) return { skipped: true, reason: 'too-short' };
    if (STOP_PHRASES.has(text.toLowerCase())) return { skipped: true, reason: 'stop-phrase' };
    const sensitivity = scanned.hasSecret ? 'secret' : (input.sensitivity || 'personal');
    const scopeId = input.scopeId || 'global';
    const now = input.now || Date.now();
    const recordedAt = input.recordedAt || nowIso(now);
    const scored = scoreTraceText(text, { kind: input.kind, importance: input.importance });
    const explicit = input.explicit === true || Boolean(input.kind);
    const compression = compressionValue(text, scored);
    if (!explicit && compression < minCompression) return { skipped: true, reason: 'low-compression', compression };

    const event = events.append({
      kind: input.eventKind || (input.actor === 'user' ? 'utterance' : 'observation'),
      actor: input.actor || 'user',
      scopeId,
      sessionId: input.sessionId || null,
      turnId: input.turnId || null,
      operationId: input.operationId || null,
      causationId: input.causationId || null,
      payload: {
        textHash: hashText(text),
        textLength: text.length,
        source: input.source || input.actor || 'user',
        kind: scored.kind,
        explicit,
      },
      at: recordedAt,
    });

    const existing = traces.findByEvent(event.id);
    if (existing) {
      const factsApplied = applyFacts(input.facts, { scopeId, recordedAt, sourceEventId: event.id });
      const edgeCandidates = queueFactEdges(factsApplied, { scopeId, sourceEventId: event.id, sourceTraceId: existing.id });
      return { skipped: true, reason: 'idempotent', event, trace: existing, facts: factsApplied, edgeCandidates };
    }

    const duplicate = traces.findByHash(scopeId, hashText(text));
    if (duplicate) {
      const factsApplied = applyFacts(input.facts, { scopeId, recordedAt, sourceEventId: event.id });
      const edgeCandidates = queueFactEdges(factsApplied, { scopeId, sourceEventId: event.id, sourceTraceId: duplicate.id });
      audit?.record?.({
        actor: input.actor || 'user',
        action: 'trace.duplicate',
        targetType: 'trace',
        targetId: duplicate.id,
        detail: { eventId: event.id, textHash: hashText(text), factsApplied: factsApplied.length, edgeCandidates: edgeCandidates.length },
      });
      return { skipped: true, reason: 'duplicate', event, trace: duplicate, facts: factsApplied, edgeCandidates };
    }

    const trace = traces.insert({
      scopeId,
      kind: scored.kind,
      title: input.title || null,
      content: text,
      summary: input.summary || null,
      keywords: input.keywords || [],
      tags: input.tags || [],
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      eventId: event.id,
      sessionId: input.sessionId || null,
      turnId: input.turnId || null,
      actor: input.actor || 'user',
      source: input.source || input.actor || 'user',
      validAt: input.validAt || recordedAt,
      recordedAt,
      importance: scored.importance,
      confidence: input.confidence ?? (input.actor === 'user' ? 0.8 : 0.65),
      salience: scored.salience,
      valence: scored.valence,
      arousal: scored.arousal,
      sensitivity: sensitivity,
    });

    const resolvedFacts = applyFacts(input.facts, { scopeId, recordedAt, sourceEventId: event.id });
    const edgeCandidates = queueFactEdges(resolvedFacts, { scopeId, sourceEventId: event.id, sourceTraceId: trace.id });

    audit?.record?.({
      actor: input.actor || 'user',
      action: 'trace.create',
      targetType: 'trace',
      targetId: trace.id,
      detail: { eventId: event.id, kind: trace.kind, compression, findings: scanned.findings.map((item) => ({ type: item.type, rule: item.rule, severity: item.severity })) },
    });

    for (const resolution of resolvedFacts) {
      if (!resolution?.action || resolution.action === 'none') continue;
      audit?.record?.({
        actor: input.actor || 'user',
        action: `fact.${resolution.action}`,
        targetType: 'fact',
        targetId: resolution.fact?.id ?? null,
        detail: { traceId: trace.id, invalidated: resolution.invalidated?.map((fact) => fact.id) ?? [], disputeId: resolution.dispute?.id ?? null },
      });
    }

    if (vector) {
      try {
        vector.upsert(trace.id, `${trace.title ?? ''} ${trace.content ?? ''} ${trace.summary ?? ''}`);
      } catch {
        /* vector indexing is optional and must never fail the write */
      }
    }

    return { skipped: false, event, trace, facts: resolvedFacts, edgeCandidates, compression, score: scored };
  }

  return { encode, scoreTraceText, compressionValue };
}
