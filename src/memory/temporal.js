const DAY = 86_400_000;

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function parseTemporal(text, now = Date.now()) {
  const value = String(text ?? '');
  const day = startOfDay(now);
  const iso = (ms) => new Date(ms).toISOString();
  const range = (from, to, label) => ({ from: iso(from), to: iso(to), label, confidence: 0.85 });
  if (/今天|today/i.test(value)) return range(day, day + DAY, 'today');
  if (/昨天|yesterday/i.test(value)) return range(day - DAY, day, 'yesterday');
  if (/明天|tomorrow/i.test(value)) return range(day + DAY, day + 2 * DAY, 'tomorrow');
  if (/本周|这周|this week/i.test(value)) return range(day - 6 * DAY, day + DAY, 'this-week');
  if (/上周|last week/i.test(value)) return range(day - 13 * DAY, day - 6 * DAY, 'last-week');
  if (/本月|这个月|this month/i.test(value)) {
    const at = new Date(now);
    return range(new Date(at.getFullYear(), at.getMonth(), 1).getTime(), now, 'this-month');
  }
  if (/上个月|last month/i.test(value)) {
    const at = new Date(now);
    return range(new Date(at.getFullYear(), at.getMonth() - 1, 1).getTime(), new Date(at.getFullYear(), at.getMonth(), 1).getTime(), 'last-month');
  }
  const ago = value.match(/(\d+)\s*(?:天|日|days?)\s*前/i);
  if (ago) {
    const days = Number(ago[1]);
    return range(now - days * DAY, now - (days - 1) * DAY, `${days}-days-ago`);
  }
  const date = value.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (date) {
    const from = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    return range(from, from + DAY, 'date');
  }
  return null;
}

export function withinWindow(timestamp, window) {
  if (!window) return true;
  const at = Date.parse(timestamp);
  return Number.isFinite(at) && at >= Date.parse(window.from) && at < Date.parse(window.to);
}

export function parseDuration(text, fallbackMs = 0) {
  const value = String(text ?? '').trim();
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY }[unit] ?? 1;
  return amount * factor;
}

export function formatRelative(timestamp, now = Date.now()) {
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return '—';
  const delta = now - at;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < DAY) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)} 天前`;
  return new Date(at).toISOString().slice(0, 10);
}
