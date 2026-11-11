export function createCircuitBreaker({ threshold = 5, cooldownMs = 60_000, now = () => Date.now() } = {}) {
  let failures = 0;
  let openedAt = null;

  function allow() {
    if (openedAt == null) return true;
    if (now() - openedAt >= cooldownMs) {
      openedAt = null;
      failures = 0;
      return true;
    }
    return false;
  }

  function success() {
    failures = 0;
    openedAt = null;
  }

  function failure() {
    failures += 1;
    if (failures >= threshold && openedAt == null) openedAt = now();
    return snapshot();
  }

  function snapshot() {
    return { state: openedAt == null ? 'closed' : 'open', failures, openedAt, remainingMs: openedAt == null ? 0 : Math.max(0, cooldownMs - (now() - openedAt)) };
  }

  return { allow, success, failure, snapshot };
}

export function createBudgetGuard({ maxCallsPerHour = 120, maxTokensPerHour = 120_000, now = () => Date.now() } = {}) {
  let windowStart = now();
  let calls = 0;
  let tokens = 0;

  function roll() {
    const at = now();
    if (at - windowStart >= 3_600_000) {
      windowStart = at;
      calls = 0;
      tokens = 0;
    }
  }

  function allow(cost = 0) {
    roll();
    return calls < maxCallsPerHour && tokens + Math.max(0, Number(cost) || 0) <= maxTokensPerHour;
  }

  function spend(cost = 0) {
    roll();
    if (!allow(cost)) return { ok: false, ...snapshot() };
    calls += 1;
    tokens += Math.max(0, Number(cost) || 0);
    return { ok: true, ...snapshot() };
  }

  function snapshot() {
    roll();
    return { calls, tokens, maxCallsPerHour, maxTokensPerHour, windowStart, remainingCalls: Math.max(0, maxCallsPerHour - calls), remainingTokens: Math.max(0, maxTokensPerHour - tokens) };
  }

  return { allow, spend, snapshot };
}
