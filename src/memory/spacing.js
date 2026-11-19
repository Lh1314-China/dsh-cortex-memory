/**
 * Spacing for retrieval practice.
 *
 * The first recall of a trace is cheap to record, but touching it on every
 * step turns access_count into noise. The interval grows with the number of
 * previous recalls (a simple spacing curve), so a memory that is recalled
 * often is written to less often — and a memory nobody touches stays easy to
 * pick up again.
 */
export function touchInterval(accessCount, { baseMs = 300_000, maxMs = 21_600_000 } = {}) {
  const count = Math.max(0, Math.min(8, Number(accessCount) || 0));
  const base = Math.max(1_000, Number(baseMs) || 300_000);
  const max = Math.max(base, Number(maxMs) || 21_600_000);
  return Math.min(max, base * (2 ** count));
}
