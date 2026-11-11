const RULES = [
  // Negative predicates must be seen first; otherwise "不喜欢" also matches likes.
  { predicate: 'dislikes', pattern: /([^，。；\n]{1,20})(?:讨厌|不喜欢)([^，。；\n]{1,20})/g, confidence: 0.6 },
  { predicate: 'likes', pattern: /([^，。；\n]{1,20})(?:喜欢|爱)([^，。；\n]{1,20})/g, confidence: 0.55 },
  { predicate: 'is', pattern: /([^，。；\n]{1,20})是([^，。；\n]{1,30})/g, confidence: 0.5 },
  { predicate: 'at', pattern: /([^，。；\n]{1,20})(?:在|住在)([^，。；\n]{1,20})/g, confidence: 0.5 },
  { predicate: 'will', pattern: /([^，。；\n]{1,20})会([^，。；\n]{1,30})/g, confidence: 0.6 },
];

const NEGATED_TAIL = /[不没别未]\s*$/;

const STOP_SUBJECTS = new Set(['本鲸', '我', '你', '他', '她', '它', '这', '那', '今天', '昨天', '明天']);

function clean(value) {
  return String(value ?? '').trim().replace(/^(?:今天|昨天|明天|刚才|然后|所以|但是|而且)/, '').trim();
}

export function extractFactCandidates(text) {
  const value = String(text ?? '');
  const out = [];
  const seen = new Set();
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(value)) !== null) {
      const subject = clean(match[1]);
      const object = clean(match[2]);
      if (!subject || !object || subject.length < 1 || object.length < 1) continue;
      if (STOP_SUBJECTS.has(subject) && !/本鲸/.test(subject)) continue;
      // "主人不喜欢猫" yields subject "主人不"; never turn that into likes.
      if ((rule.predicate === 'likes' || rule.predicate === 'is') && NEGATED_TAIL.test(match[1])) continue;
      const key = `${subject}|${rule.predicate}|${object}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ subject, predicate: rule.predicate, object, confidence: rule.confidence, evidence: match[0], rule: rule.predicate });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

export function createFactExtractor({ entities, facts } = {}) {
  if (!entities || !facts) throw new Error('fact extractor needs entities and facts');

  function extract({ scopeId = 'global', text, traceId = null, eventId = null, recordedAt = null } = {}) {
    const candidates = extractFactCandidates(text);
    const resolved = [];
    for (const candidate of candidates) {
      try {
        const subject = entities.upsert({ scopeId, name: candidate.subject });
        const object = entities.upsert({ scopeId, name: candidate.object });
        const result = facts.resolve({
          scopeId,
          subjectId: subject.id,
          predicate: candidate.predicate,
          objectId: object.id,
          validFrom: recordedAt ?? undefined,
          recordedAt: recordedAt ?? undefined,
          confidence: candidate.confidence,
          sourceEventId: eventId,
          evidence: [{ eventId, traceId, weight: candidate.confidence, text: candidate.evidence }],
        });
        resolved.push({ candidate, ...result });
      } catch {
        /* one bad candidate must not stop extraction */
      }
    }
    return { candidates, resolved };
  }

  return { extract, extractFactCandidates };
}
