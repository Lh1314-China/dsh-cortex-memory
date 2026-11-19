import { guardFactCandidate } from './fact-guard.js';

const RULES = [
  // Negative predicates must be seen first; otherwise "不喜欢" also matches likes.
  { predicate: 'dislikes', pattern: /([^，。；\n]{1,20})(?:讨厌|不喜欢)([^，。；\n]{1,20})/g, confidence: 0.6 },
  { predicate: 'likes', pattern: /([^，。；\n]{1,20})(?:喜欢|爱)([^，。；\n]{1,20})/g, confidence: 0.55 },
  { predicate: 'is', pattern: /([^，。；\n]{1,20})是([^，。；\n]{1,30})/g, confidence: 0.5 },
  { predicate: 'at', pattern: /([^，。；\n]{1,20})(?:在|住在)([^，。；\n]{1,20})/g, confidence: 0.5 },
  { predicate: 'will', pattern: /([^，。；\n]{1,20})会([^，。；\n]{1,30})/g, confidence: 0.6 },
];

const NEGATED_TAIL = /[不没别未]\s*$/;

// Design discussions and status posts talk about what *might* happen; they are
// not statements of fact. They usually arrive as a pasted draft, so both the
// vocabulary and the quote markers are signals.
const DISCUSSION_DOC = /(?:新坑|设计草案|方案稿|设计文档|TODO|待办|路线图|架构设计|接口设计|需求草案)/;

// Sentence-level guards. The rule extractor is deliberately dumb, so the text it
// reads has to be checked as a whole: "你会有感觉吗" and "要是想聊两句" both used to
// produce facts because the patterns matched inside a question or an if-clause.
const SENTENCE_END = /[。！？!?；;\n]/;
const SINGLE_SUBJECT_OK = new Set(['我', '你', '他', '她', '它', '咱', '您']);

function sentenceAround(text, index, length) {
  let start = index;
  while (start > 0 && !SENTENCE_END.test(text[start - 1])) start -= 1;
  let end = index + length;
  while (end < text.length && !SENTENCE_END.test(text[end])) end += 1;
  return text.slice(start, end);
}

function isQuestionSentence(sentence) {
  const text = String(sentence ?? '').trim();
  if (!text) return false;
  if (/[？?]\s*$/.test(text)) return true;
  return /(?:吗|呢|吧|麼|么)\s*$/.test(text);
}

function isConditionalSentence(sentence) {
  return /^\s*(?:要是|如果|假如|万一|倘若|若是|若)/.test(String(sentence ?? ''));
}

// An instruction is not a fact: "记得明天把接口补上" describes what to do, not what
// is. The opener matters — imperative verbs inside a statement are fine.
function isImperativeSentence(sentence) {
  return /^\s*(?:去|把|帮我|给我|记得|别|请|麻烦|快|赶紧|先帮)/.test(String(sentence ?? ''));
}

const STOP_SUBJECTS = new Set(['他', '她', '它', '这', '那', '今天', '昨天', '明天']);
// Fragments that only look like objects:他们来自被硬切成三元组的叙述句，
// 入库后会变成「at→等」「will→收一收」这种噪音事实。
const NOISE_OBJECTS = new Set(['等', '等等', '收一收', '水里', '那里', '这里', '一下子', '一点', '一些', '什么', '怎么', '那样', '这样', '儿', '会儿']);

function clean(value) {
  return String(value ?? '').trim().replace(/^(?:今天|昨天|明天|刚才|然后|所以|但是|而且)/, '').trim();
}

function plausibleName(value, max = 16) {
  if (!value || value.length > max) return false;
  if (/[\/\\*“”"`\n\r\s：:]/.test(value)) return false;
  if (/^[0-9]/.test(value)) return false;
  if (/^(?:但|还|不能|原因|当前|你现|我现|这|那|只|哪些)/.test(value)) return false;
  return true;
}

export function extractFactCandidates(text, persona = {}) {
  const value = String(text ?? '');
  // Assistant replies and copied notes are often markdown-heavy; those are
  // not clean fact sources and produce sentence-fragment entities.
  if (/```|`[^`]*`|\*\*|^\s*[-*]\s|^\s*>\s|\|.*\|/m.test(value)) return [];
  // A pasted design draft is a discussion, not a fact: "新坑 3：…" describes a
  // problem to think about, not something that happened.
  if (DISCUSSION_DOC.test(value)) return [];
  const selfName = typeof persona?.selfName === 'string' && persona.selfName.trim() ? persona.selfName.trim().slice(0, 24) : '助手';
  const userAddress = typeof persona?.userAddress === 'string' && persona.userAddress.trim() ? persona.userAddress.trim().slice(0, 24) : '你';
  // Quoted speech is someone else's words, not a fact about the speaker.
  const quoteSpans = [];
  for (const match of value.matchAll(/[「“"]([^「」“”"]{1,300})[」”"]/g)) {
    quoteSpans.push([match.index, match.index + match[0].length]);
  }
  const inQuote = (index) => quoteSpans.some(([start, end]) => index >= start && index < end);
  const selfAliases = new Set(['你', selfName]);
  const userAliases = new Set(['我', '自己', '我们', '咱', '用户', '您', userAddress]);
  const out = [];
  const seen = new Set();
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(value)) !== null) {
      // 引号里是别人的话，不是关于说话者的事实。
      if (inQuote(match.index)) continue;
      // 问句、假设句、命令句都不是事实来源。
      const sentence = sentenceAround(value, match.index, match[0].length);
      if (isQuestionSentence(sentence) || isConditionalSentence(sentence) || isImperativeSentence(sentence)) continue;
      const rawSubject = clean(match[1]);
      // 单字主语几乎都是被切碎的功能词（"要"、"还"、"只"）；只有代词/称呼
      // 允许单独作主语。这条挡掉 is(要 → 想聊两句) 这类碎片三元组。
      if (rawSubject.length === 1 && !SINGLE_SUBJECT_OK.has(rawSubject)) continue;
      let subject = rawSubject;
      if (selfAliases.has(rawSubject)) subject = selfName;
      else if (userAliases.has(rawSubject)) subject = userAddress;
      const object = clean(match[2]);
      if (!subject || !object || subject.length < 1 || object.length < 1) continue;
      // Single function words are not objects ("会 儿", "在 等" are split sentences).
      if (object.length === 1 && '的了着过等儿啊吗呢吧嘛'.includes(object)) continue;
      if (subject.length === 1 && '的了着过等儿啊吗呢吧嘛'.includes(subject)) continue;
      if (STOP_SUBJECTS.has(rawSubject)) continue;
      if (!plausibleName(subject, 12) || !plausibleName(object, 18)) continue;
      if (NOISE_OBJECTS.has(object)) continue;
      // "用户不喜欢猫" yields subject "用户不"; never turn that into likes.
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

  function extract({ scopeId = 'global', text, traceId = null, eventId = null, recordedAt = null, persona = null } = {}) {
    const candidates = extractFactCandidates(text, persona ?? {});
    const resolved = [];
    for (const candidate of candidates) {
      const guarded = guardFactCandidate(candidate);
      if (!guarded) continue;
      try {
        const subject = entities.upsert({ scopeId, name: guarded.subject });
        const object = entities.upsert({ scopeId, name: guarded.object });
        const result = facts.resolve({
          scopeId,
          subjectId: subject.id,
          predicate: guarded.predicate,
          objectId: object.id,
          validFrom: recordedAt ?? undefined,
          recordedAt: recordedAt ?? undefined,
          confidence: guarded.confidence,
          sourceEventId: eventId,
          evidence: [{ eventId, traceId, weight: guarded.confidence, text: candidate.evidence }],
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
