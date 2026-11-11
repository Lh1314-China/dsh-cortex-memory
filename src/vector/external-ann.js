/**
 * Future external ANN client. It is intentionally not wired into the search
 * path yet: a local index service with its own lifecycle must exist first.
 */
export function createExternalAnnClient({ endpoint, timeoutMs = 800, headers = {}, fetchImpl = fetch } = {}) {
  const url = String(endpoint ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('external ANN endpoint must be http(s)');
  const timeout = Math.max(100, Math.min(10000, Number(timeoutMs) || 800));

  async function search(vector, k = 10, { signal } = {}) {
    if (!Array.isArray(vector) || !vector.length) throw new Error('external ANN query vector is required');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ vector, k: Math.max(1, Math.min(200, Number(k) || 10)) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`external ANN returned ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body?.items)) throw new Error('external ANN response needs items[]');
      return body.items
        .filter((item) => typeof item?.id === 'string' && Number.isFinite(item?.score))
        .map((item) => ({ id: item.id, score: item.score }))
        .slice(0, Math.max(1, Math.min(200, Number(k) || 10)));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  return { endpoint: url, search };
}
