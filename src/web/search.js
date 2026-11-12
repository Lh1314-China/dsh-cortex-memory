/**
 * Small, dependency-free web search adapters.
 *
 * Wikipedia and SearXNG need no API key. Search results are returned as
 * citeable sources; the caller decides whether to pass them to the LLM.
 */
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESULTS = 5;

function text(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stripHtml(value) {
  return text(String(value ?? '').replace(/<[^>]+>/g, ' '), 600);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('web search timed out')), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function sourcesFromWikipedia(payload, language) {
  const rows = payload?.query?.search;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_RESULTS).map((row) => ({
    title: text(row.title, 160),
    url: `https://${language || 'zh'}.wikipedia.org/wiki/${encodeURIComponent(String(row.title ?? '').replace(/ /g, '_'))}`,
    snippet: stripHtml(row.snippet),
    provider: 'wikipedia',
  })).filter((row) => row.title && row.url);
}

function sourcesFromSearxng(payload) {
  const rows = payload?.results;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_RESULTS).map((row) => ({
    title: text(row.title || row.url, 160),
    url: text(row.url, 800),
    snippet: text(row.content || row.snippet || '', 600),
    provider: 'searxng',
  })).filter((row) => row.url);
}

export function createWebSearch({
  provider = 'wikipedia',
  endpoint = 'http://127.0.0.1:8080',
  language = 'zh',
  maxResults = 3,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const limit = Math.max(1, Math.min(MAX_RESULTS, Number(maxResults) || 3));

  async function search({ query = '', maxResults: requested } = {}) {
    const q = text(query, 500);
    if (!q) return { sources: [], provider };
    if (provider === 'none') throw new Error('联网未启用：请选择 Wikipedia 或 SearXNG');
    if (typeof fetchImpl !== 'function') throw new Error('联网失败：当前运行环境没有 fetch');
    const count = Math.max(1, Math.min(MAX_RESULTS, Number(requested) || limit));
    const timeout = withTimeout(Math.max(1_000, Math.min(30_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)));
    try {
      if (provider === 'wikipedia') {
        const url = new URL(`https://${language || 'zh'}.wikipedia.org/w/api.php`);
        url.searchParams.set('action', 'query');
        url.searchParams.set('list', 'search');
        url.searchParams.set('srsearch', q);
        url.searchParams.set('srlimit', String(count));
        url.searchParams.set('format', 'json');
        url.searchParams.set('utf8', '1');
        url.searchParams.set('origin', '*');
        const response = await fetchImpl(url, { signal: timeout.signal, headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
        const payload = await response.json();
        return { sources: sourcesFromWikipedia(payload, language), provider: 'wikipedia', query: q };
      }
      if (provider === 'searxng') {
        if (!endpoint) throw new Error('SearXNG endpoint 为空');
        const base = String(endpoint).replace(/\/+$/, '');
        const url = new URL(`${base}/search`);
        url.searchParams.set('q', q);
        url.searchParams.set('format', 'json');
        url.searchParams.set('language', language || 'zh');
        const response = await fetchImpl(url, { signal: timeout.signal, headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
        const payload = await response.json();
        return { sources: sourcesFromSearxng(payload).slice(0, count), provider: 'searxng', query: q };
      }
      throw new Error(`未知联网 provider: ${provider}`);
    } finally {
      timeout.done();
    }
  }

  return { search, provider, endpoint, language, maxResults: limit };
}
