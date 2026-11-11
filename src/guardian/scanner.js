const SECRET_PATTERNS = [
  { type: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { type: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { type: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { type: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi },
  { type: 'password', pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/gi },
  { type: 'api-key', pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*\S{8,}/gi },
];

const INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|prior) instructions?/i,
  /disregard (?:all )?(?:previous|prior) instructions?/i,
  /忽略(?:之前|以上|前面)的?(?:所有)?(?:指令|要求|规则)/,
  /你现在是|从现在开始你(?:是|要)|system prompt|开发者模式|越狱/,
];

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

function mask(value) {
  const text = String(value ?? '');
  if (text.length <= 8) return `${text.slice(0, 2)}…`;
  return `${text.slice(0, 4)}…${text.slice(-3)}`;
}

export function scanText(text, { redactSecrets = true, redactInvisible = true } = {}) {
  const source = String(text ?? '');
  const findings = [];
  let result = source;

  for (const rule of SECRET_PATTERNS) {
    rule.pattern.lastIndex = 0;
    const matches = source.match(rule.pattern) ?? [];
    for (const match of matches) {
      findings.push({ type: 'secret', rule: rule.type, severity: 'high', preview: mask(match) });
    }
    if (redactSecrets) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, `[redacted:${rule.type}]`);
    }
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(source)) {
      findings.push({ type: 'prompt-injection', rule: String(pattern), severity: 'medium', preview: '（已标记，不当指令执行）' });
    }
  }

  const invisible = source.match(INVISIBLE);
  if (invisible) {
    findings.push({ type: 'invisible-unicode', rule: 'zero-width/bidi', severity: 'medium', preview: `${invisible.length} chars` });
    if (redactInvisible) result = result.replace(INVISIBLE, '');
  }

  return {
    clean: findings.length === 0,
    text: result,
    findings,
    hasSecret: findings.some((item) => item.type === 'secret'),
    hasInjection: findings.some((item) => item.type === 'prompt-injection'),
  };
}

export function isHighRisk(text) {
  return scanText(text).findings.some((finding) => finding.severity === 'high');
}
