/**
 * Dependency-free HTTP client for the dsh-cortex API.
 *
 * The server routes live in `src/api/routes.js` and are mounted under
 * `/api/cortex`. This client only uses `fetch` (or an injected equivalent)
 * and has no runtime dependencies.
 *
 * Error model:
 * - transport failure          -> ApiError { status: 0, code: 'NETWORK_ERROR' }
 * - non-JSON success response  -> ApiError { code: 'INVALID_JSON' }
 * - `{ ok: false, error }`     -> ApiError { status, code: 'HTTP_<status>' }
 * - host-only operation        -> ApiError { code: 'ROUTE_NOT_EXPOSED' }
 *
 * Successful responses are unwrapped: `{ ok: true, data }` resolves to `data`.
 * The `/ping` response has no `data` member, so it resolves to `{ ok, at }`.
 */

export const API_BASE = '/api/cortex';
export const DEFAULT_BASE_URL = 'http://127.0.0.1:7430';

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, method?: string | null, url?: string | null, payload?: unknown, cause?: unknown }} [options]
   */
  constructor(message, { status = 0, code = 'API_ERROR', method = null, url = null, payload = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.method = method;
    this.url = url;
    this.payload = payload;
  }
}

function normalizeBaseUrl(input) {
  const text = input == null || input === '' ? DEFAULT_BASE_URL : String(input);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new TypeError(`baseUrl must be an absolute http(s) URL: ${text}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`baseUrl must use http or https: ${text}`);
  }

  // Preserve an existing path (reverse proxies, a pre-suffixed API base) while
  // guaranteeing the final path ends in /api/cortex and never contains `//`.
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith(API_BASE)) pathname = `${pathname}${API_BASE}`;
  url.pathname = pathname.replace(/\/{2,}/g, '/');
  url.search = '';
  url.hash = '';
  return url;
}

function buildUrl(base, path, query) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError('cortex API path must start with "/"');
  }
  const url = new URL(base.href);
  url.pathname = `${base.pathname}/${path.replace(/^\/+/, '')}`;
  url.search = '';
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

function defined(source, keys) {
  const value = {};
  for (const key of keys) {
    if (source[key] !== undefined) value[key] = source[key];
  }
  return value;
}

function assertObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function routeNotExposed(method, path, hostTool) {
  return new ApiError(
    `The cortex HTTP API does not expose ${method} ${API_BASE}${path}; use the host tool ${hostTool} instead.`,
    { status: 0, code: 'ROUTE_NOT_EXPOSED', method },
  );
}

async function readPayload(response) {
  if (response.status === 204 || response.status === 205) return { payload: null, parsed: true };
  if (typeof response.json !== 'function') return { payload: null, parsed: false };
  try {
    return { payload: await response.json(), parsed: true };
  } catch {
    return { payload: null, parsed: false };
  }
}

/**
 * Create a client bound to one cortex server.
 *
 * @param {{
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   tokenHeader?: string | number | null
 * }} [options]
 *   baseUrl   server origin (default http://127.0.0.1:7430); an existing path
 *             is preserved and /api/cortex is appended unless already present.
 *   fetchImpl fetch implementation; defaults to globalThis.fetch.
 *   tokenHeader value sent as `x-cortex` on POST (default "1").
 */
export function createApiClient({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  tokenHeader = '1',
  scopeId = null,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createApiClient needs fetchImpl or globalThis.fetch');
  }
  if (scopeId !== null && (typeof scopeId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(scopeId))) {
    throw new TypeError('scopeId must be a safe 1..120 character string');
  }
  const base = normalizeBaseUrl(baseUrl);

  /**
   * Perform one request and unwrap the cortex envelope.
   * @param {'GET' | 'POST'} method
   * @param {string} path path below /api/cortex, starting with "/"
   * @param {{ query?: Record<string, unknown> | null, body?: unknown }} [options]
   */
  async function request(method, path, { query = null, body } = {}) {
    const url = buildUrl(base, path, query);
    const headers = { accept: 'application/json' };
    if (scopeId) headers['x-cortex-scope'] = scopeId;
    let encodedBody;

    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      if (tokenHeader !== undefined && tokenHeader !== null) headers['x-cortex'] = String(tokenHeader);
      encodedBody = JSON.stringify(body ?? {});
    } else if (body !== undefined) {
      throw new TypeError(`a ${method} request cannot carry a body`);
    }

    const init = { method, headers, cache: 'no-store' };
    if (encodedBody !== undefined) init.body = encodedBody;

    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError(`request failed: ${method} ${url}: ${detail}`, {
        status: 0,
        code: 'NETWORK_ERROR',
        method,
        url,
        cause,
      });
    }

    if (!response || typeof response !== 'object') {
      throw new ApiError(`fetchImpl returned no Response for ${method} ${url}`, {
        status: 0,
        code: 'INVALID_RESPONSE',
        method,
        url,
      });
    }

    const status = Number(response.status) || 0;
    const { payload, parsed } = await readPayload(response);
    const envelope = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const failed = response.ok !== true || envelope?.ok === false;

    if (failed) {
      const message = typeof envelope?.error === 'string' && envelope.error
        ? envelope.error
        : typeof envelope?.message === 'string' && envelope.message
          ? envelope.message
          : `HTTP ${status || 'error'} for ${method} ${url}`;
      const code = typeof envelope?.code === 'string' && envelope.code
        ? envelope.code
        : response.ok === true
          ? 'API_ERROR'
          : `HTTP_${status || 'ERROR'}`;
      throw new ApiError(message, { status, code, method, url, payload });
    }

    if (!parsed) {
      if (status === 204 || status === 205) return null;
      throw new ApiError(`invalid JSON response from ${method} ${url}`, {
        status,
        code: 'INVALID_JSON',
        method,
        url,
      });
    }

    if (envelope && 'data' in envelope) return envelope.data;
    return payload;
  }

  const get = (path, query = null) => request('GET', path, { query });
  const post = (path, body = {}) => request('POST', path, { body });

  return {
    /** GET /ping -> { ok, at } (the only route without a data envelope). */
    ping: () => get('/ping'),

    /** GET /health -> health report. */
    health: () => get('/health'),

    /** GET /self -> self, identity, relationships, intentions, working, goals. */
    self: () => get('/self'),

    /** GET /report -> combined health/self/guardian/retention/evolution/metrics. */
    report: () => get('/report'),

    /** GET /stats -> scope/db/vector status. */
    stats: () => get('/stats'),

    /** GET /settings -> read-only runtime settings. */
    settings: () => get('/settings'),

    /** GET /metrics -> in-process counters and timings. */
    metrics: () => get('/metrics'),

    /** GET /graph -> graph summary. */
    graph: () => get('/graph'),

    /** GET /models -> redacted embedding/rerank config. */
    models: () => get('/models'),

    /** POST /models { embedding, rerank, confirm:true } -> restart required. */
    saveModels: (options = {}) => post('/models', defined(assertObject(options, 'model options'), ['embedding', 'rerank', 'confirm'])),

    /** POST /permissions { key, value, confirm:true } -> persisted, restart required. */
    setPermission: (options = {}) => post('/permissions', defined(assertObject(options, 'permission options'), ['key', 'value', 'confirm'])),

    /** POST /permissions/rollback -> restore last permission change. */
    rollbackPermission: () => post('/permissions/rollback', {}),

    /** GET /permissions -> current overrides and history. */
    permissions: () => get('/permissions'),

    /** POST /vector/rebuild -> async rebuild from active traces. */
    rebuildVector: (options = {}) => post('/vector/rebuild', defined(assertObject(options, 'vector rebuild options'), ['limit'])),

    /** POST /vector/index { id } -> async index one trace. */
    indexVector: (id) => post('/vector/index', { id }),

    /** POST /consolidate { dryRun?, limit? } -> replayable consolidation run. */
    consolidate: (options = {}) => post('/consolidate', defined(assertObject(options, 'consolidate options'), ['dryRun', 'limit'])),

    /** GET /dream-runs -> consolidation history. */
    dreamRuns: ({ limit } = {}) => get('/dream-runs', { limit }),

    /** GET /playbook -> rules; POST /playbook -> add/vote/retire/render. */
    playbook: (action = 'list', options = {}) => {
      if (action === 'list') return get('/playbook', { status: options.status, includeExpired: options.includeExpired });
      return post('/playbook', defined({ ...assertObject(options, 'playbook options'), action }, ['action', 'id', 'title', 'body', 'tags', 'validTo', 'signal', 'limit']));
    },

    /** GET /as-of?subject=&predicate=&at=&mode= -> temporal facts. */
    asOf: (options = {}) => get('/as-of', defined(assertObject(options, 'as-of options'), ['subject', 'predicate', 'at', 'asOf', 'mode', 'includeDisputed'])),

    /** GET /graph/edges -> nodes + edges + summary (bounded). */
    graphData: () => get('/graph/edges'),

    /** GET /retention -> retention plan. */
    retention: () => get('/retention'),

    /** POST /retention/apply { dryRun? } -> archive the returned plan. */
    retentionApply: (options = {}) => post('/retention/apply', defined(assertObject(options, 'retentionApply options'), ['dryRun'])),

    /** GET /audit?limit=... -> audit rows (default 50, 1..200). */
    audit: ({ limit } = {}) => get('/audit', { limit }),

    /** GET /skills -> active skills (limit 100 server-side). */
    skills: () => get('/skills'),

    /**
     * GET /search?q=...&limit=...&budget=...
     * @param {string} query
     * @param {{ limit?: number, budget?: number }} [options]
     */
    search: (query, { limit, budget } = {}) => {
      if (typeof query !== 'string') throw new TypeError('search query must be a string');
      return get('/search', { q: query, limit, budget });
    },

    /** GET /search?async=true -> hybrid search with async vector query. */
    searchAsync: (query, { limit, budget } = {}) => {
      if (typeof query !== 'string') throw new TypeError('async search query must be a string');
      return get('/search', { q: query, async: true, limit, budget });
    },

    /** GET /search?q&tiered=true -> perm/hot/cold budgeted blocks. */
    searchTiered: (query, { limit, permBudget, hotBudget, coldBudget } = {}) => {
      if (typeof query !== 'string') throw new TypeError('tiered search query must be a string');
      return get('/search', { q: query, tiered: true, limit, permBudget, hotBudget, coldBudget });
    },

    /** GET /trace?id=... -> one trace, or a 404 ApiError. */
    trace: (id) => {
      if (typeof id !== 'string' || id.length === 0) throw new TypeError('trace id must be a non-empty string');
      return get('/trace', { id });
    },

    /** GET /timeline?id=...&before=...&after=... (server defaults 4/4). */
    timeline: (id, { before, after } = {}) => get('/timeline', { id, before, after }),

    /** POST /write -> encode one memory. */
    write: (input) => post('/write', assertObject(input, 'write input')),

    /** POST /write with { items } -> batch encode. */
    writeMany: (items) => {
      if (!Array.isArray(items)) throw new TypeError('writeMany items must be an array');
      return post('/write', { items });
    },

    /** POST /feedback -> growth feedback for a trace. */
    feedback: (input = {}) => post('/feedback', defined(assertObject(input, 'feedback input'), ['id', 'signal', 'predicted', 'outcome'])),

    /** POST /forget -> archive (default) or delete one trace. */
    forget: (input = {}) => post('/forget', defined(assertObject(input, 'forget input'), ['id', 'mode'])),

    /** POST /reflect -> run reflection for a time window. */
    reflect: (input = {}) => post('/reflect', defined(assertObject(input, 'reflect input'), ['windowDays', 'force'])),

    /**
     * Guardian actions exposed over HTTP.
     * - check    GET  /guard
     * - backup   POST /guard/backup { file? }
     * - validate POST /guard/validate { file }
     * - restore  POST /guard/restore { file, target }
     * - export   POST /guard/export { dir }
     * - sync     POST /guard/sync { dir, dryRun? }
     * - prune    POST /guard/prune { dir, retain?, dryRun? }
     * - repair   POST /guard/repair
     */
    guard: (action = 'check', options = {}) => {
      const input = assertObject(options, 'guard options');
      if (action === 'check') return get('/guard');
      if (action === 'backup') return post('/guard/backup', defined(input, ['file']));
      if (action === 'validate') return post('/guard/validate', defined(input, ['file']));
      if (action === 'restore') return post('/guard/restore', defined(input, ['file', 'target']));
      if (action === 'export') return post('/guard/export', defined(input, ['dir']));
      if (action === 'sync') return post('/guard/sync', defined(input, ['dir', 'dryRun']));
      if (action === 'prune') return post('/guard/prune', defined(input, ['dir', 'retain', 'dryRun']));
      if (action === 'repair') return post('/guard/repair', {});
      throw new TypeError('guard action must be "check", "backup", "validate", "restore", "export", "prune", or "repair"');
    },

    /**
     * Evolution actions exposed over HTTP.
     * - status    GET  /evolution
     * - optimize  POST /evolve/optimize
     * - propose   POST /evolve/propose { kind, config?, rationale? }
     * - approve   POST /evolve/approve { id }
     * - rollback  POST /evolve/rollback { kind, id? }
     */
    evolve: (action = 'status', options = {}) => {
      const input = assertObject(options, 'evolve options');
      if (action === 'status') return get('/evolution');
      if (action === 'optimize') return post('/evolve/optimize', {});
      if (action === 'propose') return post('/evolve/propose', defined(input, ['kind', 'config', 'rationale']));
      if (action === 'approve') return post('/evolve/approve', defined(input, ['id']));
      if (action === 'rollback') return post('/evolve/rollback', defined(input, ['kind', 'id']));
      throw new TypeError('evolve action must be "status", "optimize", "propose", "approve", or "rollback"');
    },

    /**
     * Emotion actions exposed over HTTP.
     * - status/affect GET  /emotion
     * - record        POST /emotion/record { text, target?, traceId? }
     */
    emotion: (action = 'status', options = {}) => {
      const input = assertObject(options, 'emotion options');
      if (action === 'status' || action === 'affect') return get('/emotion');
      if (action === 'record') return post('/emotion/record', defined(input, ['text', 'target', 'traceId']));
      if (action === 'generate') return post('/emotion/generate', {});
      throw new TypeError('emotion action must be "status", "affect", "record", or "generate"');
    },

    /**
     * Life actions exposed over HTTP.
     * - status/overview GET  /life
     * - diary           POST /life/diary { text, mood? }
     * - dream           POST /life/dream
     * - sleep           POST /life/sleep { windowDays? }
     */
    life: (action = 'status', options = {}) => {
      const input = assertObject(options, 'life options');
      if (action === 'status' || action === 'overview') return get('/life');
      if (action === 'diary') return post('/life/diary', defined(input, ['text', 'mood']));
      if (action === 'diary-generate') return post('/life/diary/generate', {});
      if (action === 'dream') return post('/life/dream', {});
      if (action === 'feeling-generate') return post('/emotion/generate', {});
      if (action === 'sleep') return post('/life/sleep', defined(input, ['windowDays']));
      throw new TypeError('life action must be "status", "overview", "diary", "diary-generate", "dream", "feeling-generate", or "sleep"');
    },

    /**
     * Working-memory actions exposed over HTTP.
     * - list   GET  /working
     * - add    POST /working/add { text, kind?, priority?, pinned?, ttlMs? }
     * - update POST /working/update { id, text?, priority?, pinned? }
     * - remove POST /working/remove { id }
     * - pin    POST /working/update { id, pinned: true } (convenience)
     *
     * `purge` is a host-tool-only operation; no HTTP route exists.
     */
    working: (action = 'list', options = {}) => {
      const input = assertObject(options, 'working options');
      if (action === 'list') return get('/working');
      if (action === 'add') return post('/working/add', defined(input, ['text', 'kind', 'priority', 'pinned', 'ttlMs']));
      if (action === 'update') return post('/working/update', defined(input, ['id', 'text', 'priority', 'pinned']));
      if (action === 'remove') return post('/working/remove', defined(input, ['id']));
      if (action === 'pin') return post('/working/update', { id: input.id, pinned: input.pinned !== false });
      if (action === 'purge') return post('/working/purge', {});
      throw new TypeError('working action must be "list", "add", "update", "remove", "pin", or "purge"');
    },

    /**
     * Goal actions exposed over HTTP.
     * - list     GET  /goals?status=...
     * - add      POST /goals/add { title, description?, priority?, dueAt? }
     * - update   POST /goals/update { id, title?, description?, priority?, progress?, status? }
     * - complete POST /goals/complete { id }
     */
    goals: (action = 'list', options = {}) => {
      const input = assertObject(options, 'goals options');
      if (action === 'list') return get('/goals', { status: input.status });
      if (action === 'add') return post('/goals/add', defined(input, ['title', 'description', 'priority', 'dueAt']));
      if (action === 'update') return post('/goals/update', defined(input, ['id', 'title', 'description', 'priority', 'progress', 'status']));
      if (action === 'complete') return post('/goals/complete', defined(input, ['id']));
      throw new TypeError('goals action must be "list", "add", "update", or "complete"');
    },

    /** POST /compress { limit? } -> archive covered, low-value traces. */
    compress: (options = {}) => post('/compress', defined(assertObject(options, 'compress options'), ['limit'])),

    /** POST /tick { max? } -> safe intentions executed, rest as proposals. */
    tick: (options = {}) => post('/tick', defined(assertObject(options, 'tick options'), ['max'])),

    /** POST /qa { question } -> retrieval-augmented answer (LLM or extractive). */
    qa: ({ question } = {}) => post('/qa', defined(assertObject({ question }, 'qa options'), ['question'])),

    /** GET /digest?date=YYYY-MM-DD -> daily digest. */
    digest: ({ date } = {}) => get('/digest', { date }),
  };
}
