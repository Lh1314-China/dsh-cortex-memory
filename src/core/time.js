export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

export function toMs(value, fallback = NaN) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isValidIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function daysBetween(from, to = Date.now()) {
  const a = toMs(from);
  const b = toMs(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / DAY_MS);
}

export function hoursBetween(from, to = Date.now()) {
  return daysBetween(from, to) * 24;
}

export function addDays(value, days) {
  const ms = toMs(value, Date.now());
  return new Date(ms + Number(days) * DAY_MS).toISOString();
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function isFresh(timestamp, ttlMs, now = Date.now()) {
  const ms = toMs(timestamp);
  return Number.isFinite(ms) && now - ms <= ttlMs;
}

/** ISO timestamp truncated to a stable bucket, used for cache keys. */
export function bucket(value, sizeMs = HOUR_MS) {
  const ms = toMs(value, Date.now());
  return new Date(Math.floor(ms / sizeMs) * sizeMs).toISOString();
}

export function parseTimeWindow(text, now = Date.now()) {
  const value = String(text ?? '');
  const at = new Date(now);
  const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const rules = [
    [/今天|today/i, [dayStart, dayStart + DAY_MS]],
    [/昨天|yesterday/i, [dayStart - DAY_MS, dayStart]],
    [/明天|tomorrow/i, [dayStart + DAY_MS, dayStart + 2 * DAY_MS]],
    [/本周|这周|this week/i, [dayStart - 6 * DAY_MS, dayStart + DAY_MS]],
    [/上周|last week/i, [dayStart - 13 * DAY_MS, dayStart - 6 * DAY_MS]],
    [/本月|这个月|this month/i, [new Date(at.getFullYear(), at.getMonth(), 1).getTime(), now]],
    [/上个月|last month/i, [
      new Date(at.getFullYear(), at.getMonth() - 1, 1).getTime(),
      new Date(at.getFullYear(), at.getMonth(), 1).getTime(),
    ]],
    [/(\d+)\s*天前|(\d+)\s*days?\s*ago/i, null],
  ];
  for (const [pattern, range] of rules) {
    const match = pattern.exec(value);
    if (!match) continue;
    if (range) return { from: new Date(range[0]).toISOString(), to: new Date(range[1]).toISOString() };
    const days = Number(match[1] ?? match[2] ?? 0);
    return { from: new Date(now - days * DAY_MS).toISOString(), to: new Date(now + DAY_MS).toISOString() };
  }
  return null;
}
