import { isIP } from 'node:net';
import { pruneBackups } from '../guardian/rotation.js';
import { validateWrite, validateFeedback, validateForget, validateSearch, requireString } from './validate.js';

export const API_BASE = '/api/cortex';
const MAX_BODY = 256 * 1024;

function header(request, name) {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function agentOf(request) {
  const value = header(request, 'x-cortex-agent');
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(trimmed) ? trimmed : null;
}

function isLoopback(value) {
  const address = String(value ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (address === 'localhost' || address === 'localhost.') return true;
  const family = isIP(address);
  if (family === 4) return address.startsWith('127.');
  if (family === 6) return address === '::1' || address === '0:0:0:0:0:0:0:1' || address.startsWith('::ffff:127.');
  return false;
}

function trusted(request) {
  if (!isLoopback(request.socket?.remoteAddress)) return false;
  const site = header(request, 'sec-fetch-site');
  if (site !== undefined && site !== 'same-origin') return false;
  const host = header(request, 'host');
  if (!host) return false;
  const origin = header(request, 'origin');
  if (!origin) {
    try { return isLoopback(new URL(`http://${host}`).hostname); } catch { return false; }
  }
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host && isLoopback(url.hostname);
  } catch {
    return false;
  }
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    request.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY) {
        finish(null);
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        finish(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);
      } catch { finish(null); }
    });
    request.on('error', () => finish(null));
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function toInt(value, fallback, min, max) {
  // Number(null) is 0, which would silently turn an omitted ?limit into min.
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

function scopeOf(request, url, body = null) {
  const raw = header(request, 'x-cortex-scope') || url.searchParams.get('scope') || body?.scopeId || 'global';
  const value = String(raw).trim();
  return value && value.length <= 120 && /^[A-Za-z0-9._:-]+$/.test(value) ? value : 'global';
}

export function createApiHandler({ cortex, logger = null, getExtractor = null } = {}) {
  if (!cortex) throw new Error('api handler needs cortex');

  async function handler(request, response) {
    if (!trusted(request)) {
      sendJson(response, 403, { ok: false, error: 'forbidden' });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const route = url.pathname.startsWith(API_BASE) ? url.pathname.slice(API_BASE.length) || '/' : url.pathname;
    const method = String(request.method ?? 'GET').toUpperCase();

    if (method === 'GET' || method === 'HEAD') {
      try {
        if (route === '/ping') return sendJson(response, 200, { ok: true, at: new Date().toISOString() });
        if (route === '/health') return sendJson(response, 200, { ok: true, data: cortex.health() });
        if (route === '/self') return sendJson(response, 200, { ok: true, data: cortex.self(scopeOf(request, url)) });
        if (route === '/stats') {
          return sendJson(response, 200, { ok: true, data: { config: { scope: cortex.config.scope, dbFile: cortex.config.dbFile }, vector: cortex.vector?.status?.() ?? null } });
        }
        if (route === '/guard') return sendJson(response, 200, { ok: true, data: cortex.guardian.check() });
        if (route === '/evolution') return sendJson(response, 200, { ok: true, data: cortex.evolution.status() });
        if (route === '/working') return sendJson(response, 200, { ok: true, data: cortex.working.list({ scopeId: scopeOf(request, url) }) });
        if (route === '/goals') return sendJson(response, 200, { ok: true, data: cortex.goals.list({ scopeId: scopeOf(request, url), status: url.searchParams.get('status') ?? undefined }) });
        if (route === '/emotion') return sendJson(response, 200, { ok: true, data: { text: cortex.emotion.text(), targets: cortex.emotion.targets(), events: cortex.emotion.events({ limit: 20 }) } });
        if (route === '/life') return sendJson(response, 200, { ok: true, data: { diary: cortex.life.diaryList({ limit: 10 }), dreams: cortex.life.dreamList({ limit: 5 }), sleeps: cortex.life.sleepRuns({ limit: 5 }) } });
        if (route === '/skills') return sendJson(response, 200, { ok: true, data: cortex.engines.skills.list({ scopeId: scopeOf(request, url), limit: 100 }) });
        if (route === '/models') return sendJson(response, 200, { ok: true, data: cortex.models.get() });
        if (route === '/permissions') return sendJson(response, 200, { ok: true, data: cortex.permissions.status() });
        if (route === '/security/grants') return sendJson(response, 200, { ok: true, data: cortex.security.grants() });
        if (route === '/settings') return sendJson(response, 200, { ok: true, data: cortex.settings() });
        if (route === '/report') return sendJson(response, 200, { ok: true, data: cortex.report(scopeOf(request, url)) });
        if (route === '/metrics') return sendJson(response, 200, { ok: true, data: cortex.metrics() });
        if (route === '/retention') return sendJson(response, 200, { ok: true, data: cortex.retention.plan({ scopeId: scopeOf(request, url) }) });
        if (route === '/digest') return sendJson(response, 200, { ok: true, data: cortex.digest.daily({ date: url.searchParams.get('date') ?? undefined }) });        if (route === '/audit') return sendJson(response, 200, { ok: true, data: cortex.repos.audit.list({ limit: toInt(url.searchParams.get('limit'), 50, 1, 200) }) });
        if (route === '/graph') return sendJson(response, 200, { ok: true, data: cortex.graphSummary({ scopeId: scopeOf(request, url) }) });
        if (route === '/graph/edges') return sendJson(response, 200, { ok: true, data: cortex.graphData({ scopeId: scopeOf(request, url) }) });
        if (route === '/graph/candidates') return sendJson(response, 200, { ok: true, data: cortex.graphCandidates({ scopeId: scopeOf(request, url), limit: toInt(url.searchParams.get('limit'), 200, 1, 2000) }) });
        if (route === '/search') {
          const query = url.searchParams.get('q') ?? '';
          const tiered = url.searchParams.get('tiered') === 'true';
          const asyncVector = url.searchParams.get('async') === 'true' || cortex.vector?.status?.().async === true;
          if (asyncVector) {
            const budgets = {
              perm: toInt(url.searchParams.get('permBudget'), 700, 40, 4000),
              hot: toInt(url.searchParams.get('hotBudget'), 900, 40, 4000),
              cold: toInt(url.searchParams.get('coldBudget'), 400, 20, 2000),
            };
            const data = tiered
              ? await cortex.recallTieredAsync({ query, ...budgets, scopeId: scopeOf(request, url) })
              : await cortex.searchAsync(query, { scopeId: scopeOf(request, url), limit: toInt(url.searchParams.get('limit'), 10, 1, 20), budget: toInt(url.searchParams.get('budget'), 2200, 200, 20000) });
            return sendJson(response, 200, { ok: true, data });
          }
          if (tiered) {
            const budgets = {
              perm: toInt(url.searchParams.get('permBudget'), 700, 40, 4000),
              hot: toInt(url.searchParams.get('hotBudget'), 900, 40, 4000),
              cold: toInt(url.searchParams.get('coldBudget'), 400, 20, 2000),
            };
            return sendJson(response, 200, { ok: true, data: cortex.recallTiered({ query, ...budgets, scopeId: scopeOf(request, url) }) });
          }
          const result = cortex.search(query, {
            limit: toInt(url.searchParams.get('limit'), 10, 1, 20),
            budget: toInt(url.searchParams.get('budget'), 2200, 200, 20000),
            scopeId: scopeOf(request, url),
          });
          return sendJson(response, 200, { ok: true, data: result });
        }
        if (route === '/dream-runs') return sendJson(response, 200, { ok: true, data: cortex.consolidation.list({ scopeId: scopeOf(request, url), limit: toInt(url.searchParams.get('limit'), 20, 1, 200) }) });
        if (route === '/playbook') {
          return sendJson(response, 200, {
            ok: true,
            data: cortex.playbook.list({
              status: url.searchParams.get('status') ?? null,
              includeExpired: url.searchParams.get('includeExpired') === 'true',
              scopeId: scopeOf(request, url),
            }),
          });
        }
        if (route === '/as-of') {
          const subject = requireString(url.searchParams.get('subject'), 'subject', { max: 200 });
          return sendJson(response, 200, {
            ok: true,
            data: cortex.asOf({
              subject,
              predicate: url.searchParams.get('predicate') ?? undefined,
              at: url.searchParams.get('at') ?? url.searchParams.get('asOf') ?? null,
              mode: url.searchParams.get('mode') ?? 'historical',
              includeDisputed: url.searchParams.get('includeDisputed') !== 'false',
              scopeId: scopeOf(request, url),
            }),
          });
        }
        if (route === '/trace') {
          const trace = cortex.get(url.searchParams.get('id'));
          if (!trace || trace.scopeId !== scopeOf(request, url)) return sendJson(response, 404, { ok: false, error: 'not found' });
          return sendJson(response, 200, { ok: true, data: trace });
        }
        if (route === '/timeline') {
          const result = cortex.timeline({
            aroundId: url.searchParams.get('id'),
            before: toInt(url.searchParams.get('before'), 4, 0, 50),
            after: toInt(url.searchParams.get('after'), 4, 0, 50),
            scopeId: scopeOf(request, url),
          });
          return sendJson(response, 200, { ok: true, data: result });
        }
        return sendJson(response, 404, { ok: false, error: 'not found' });
      } catch (error) {
        logger?.warn?.(`cortex api GET failed: ${error instanceof Error ? error.message : String(error)}`);
        return sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (method !== 'POST') {
      response.writeHead(405, { allow: 'GET, HEAD, POST' });
      response.end();
      return;
    }
    if (header(request, 'x-cortex') !== '1') {
      sendJson(response, 403, { ok: false, error: 'missing x-cortex header' });
      return;
    }
    const body = await readBody(request);
    if (!body) {
      sendJson(response, 400, { ok: false, error: 'invalid json body' });
      return;
    }
    try {
      const scopedWriteRoutes = new Set([
        '/write',
        '/working/add',
        '/working/purge',
        '/goals/add',
        '/graph/candidates/action',
        '/retention/apply',
        '/consolidate',
        '/vector/rebuild',
        '/emotion/record',
        '/compress',
        '/life/diary',
        '/life/dream',
        '/life/sleep',
      ]);
      if (scopedWriteRoutes.has(route)) {
        const writeScope = scopeOf(request, url, body);
        if (!cortex.scopeWritable(writeScope, agentOf(request))) {
          return sendJson(response, 403, { ok: false, error: 'scope-read-only', scopeId: writeScope });
        }
      }
      const byIdWriteRoutes = {
        '/working/update': 'working',
        '/working/remove': 'working',
        '/goals/update': 'goal',
        '/goals/complete': 'goal',
      };
      if (byIdWriteRoutes[route]) {
        const kind = byIdWriteRoutes[route];
        const id = requireString(body.id, 'id', { max: 200 });
        if (!cortex.scopeWritableById(kind, id, agentOf(request))) {
          return sendJson(response, 403, { ok: false, error: 'scope-read-only' });
        }
      }
      if (route === '/search') {
        const input = validateSearch(body);
        const useAsync = body.async === true || body.tiered === true && cortex.vector?.status?.().async === true || cortex.vector?.status?.().async === true;
        if (body.tiered === true) {
          const data = useAsync
            ? await cortex.recallTieredAsync({ query: input.query, limit: input.limit ?? 20, scopeId: scopeOf(request, url, body) })
            : cortex.recallTiered({ query: input.query, limit: input.limit ?? 20, scopeId: scopeOf(request, url, body) });
          return sendJson(response, 200, { ok: true, data });
        }
        if (useAsync) return sendJson(response, 200, { ok: true, data: await cortex.searchAsync(input.query, { limit: input.limit ?? 10, budget: input.budget ?? 2200, scopeId: scopeOf(request, url, body) }) });
        return sendJson(response, 200, { ok: true, data: cortex.search(input.query, { limit: input.limit ?? 10, budget: input.budget ?? 2200, scopeId: scopeOf(request, url, body) }) });
      }
      if (route === '/graph/candidates/action') {
        const action = requireString(body.action, 'action', { max: 20 });
        const result = cortex.graphCandidateAction({
          action,
          id: body.id ? requireString(body.id, 'id', { max: 200 }) : undefined,
          scopeId: scopeOf(request, url, body),
          fromId: body.fromId ? requireString(body.fromId, 'fromId', { max: 200 }) : undefined,
          toId: body.toId ? requireString(body.toId, 'toId', { max: 200 }) : undefined,
          rel: body.rel ? requireString(body.rel, 'rel', { max: 100 }) : undefined,
          weight: body.weight,
          confidence: body.confidence,
          sourceEventId: body.sourceEventId ? requireString(body.sourceEventId, 'sourceEventId', { max: 200 }) : null,
          sourceTraceId: body.sourceTraceId ? requireString(body.sourceTraceId, 'sourceTraceId', { max: 200 }) : null,
          evidence: body.evidence ?? null,
          metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
        });
        if (!result) return sendJson(response, 404, { ok: false, error: 'candidate not found or not pending' });
        return sendJson(response, 200, { ok: true, data: result });
      }
      if (route === '/write') {
        const writeScope = scopeOf(request, url, body);
        if (!cortex.scopeWritable(writeScope, agentOf(request))) {
          return sendJson(response, 403, { ok: false, error: 'scope-read-only', scopeId: writeScope });
        }
        if (Array.isArray(body.items)) {
          return sendJson(response, 200, { ok: true, data: cortex.writeMany(body.items.map((item) => ({ ...validateWrite(item), scopeId: scopeOf(request, url, item) }))) });
        }
        const result = cortex.write({ ...validateWrite(body), scopeId: scopeOf(request, url, body) });
        return sendJson(response, 200, { ok: true, data: result });
      }
      if (route === '/feedback') {
        const input = validateFeedback(body);
        return sendJson(response, 200, { ok: true, data: cortex.feedback({ traceId: input.id, signal: input.signal, predicted: input.predicted, outcome: input.outcome }) });
      }
      if (route === '/forget') {
        const input = validateForget(body);
        if (!input.id || typeof input.id !== 'string' || !input.id.trim()) {
          return sendJson(response, 400, { ok: false, error: 'traceId is required' });
        }
        if (!cortex.scopeWritableById('trace', input.id, agentOf(request))) {
          return sendJson(response, 403, { ok: false, error: 'scope-read-only' });
        }
        return sendJson(response, 200, { ok: true, data: cortex.forget({ traceId: input.id, mode: input.mode }) });
      }
      if (route === '/reflect') {
        return sendJson(response, 200, { ok: true, data: cortex.reflect({ windowDays: body.windowDays ?? 1, force: body.force === true }) });
      }
      if (route === '/guard/prune') {
        const dir = requireString(body.dir, 'dir', { max: 1000 });
        return sendJson(response, 200, { ok: true, data: pruneBackups(dir, { retain: body.retain, dryRun: body.dryRun === true }) });
      }
      if (route === '/guard/backup') {
        return sendJson(response, 200, { ok: true, data: cortex.guardian.backup(body.file) });
      }
      if (route === '/guard/repair') {
        return sendJson(response, 200, { ok: true, data: cortex.guardian.repairFts() });
      }
      if (route === '/guard/validate') {
        return sendJson(response, 200, { ok: true, data: cortex.guardian.validateBackup(requireString(body.file, 'file', { max: 4000 })) });
      }
      if (route === '/guard/restore') {
        return sendJson(response, 200, { ok: true, data: cortex.guardian.restore(requireString(body.file, 'file', { max: 4000 }), requireString(body.target, 'target', { max: 4000 })) });
      }
      if (route === '/guard/export') {
        return sendJson(response, 200, { ok: true, data: cortex.exportMarkdown(requireString(body.dir, 'dir', { max: 4000 })) });
      }
      if (route === '/guard/sync') {
        const dir = requireString(body.dir, 'dir', { max: 4000 });
        const dryRun = body.dryRun === true;
        if (!dryRun && !cortex.scopeWritable(scopeOf(request, url, body), agentOf(request))) {
          return sendJson(response, 403, { ok: false, error: 'scope-read-only' });
        }
        return sendJson(response, 200, { ok: true, data: cortex.syncMarkdown(dir, { dryRun, scopeId: scopeOf(request, url, body) }) });
      }
      if (route === '/qa') {
        const question = requireString(body.question, 'question', { max: 2000 });
        return sendJson(response, 200, { ok: true, data: await cortex.qa.answer({ question }) });
      }
      if (route === '/playbook') {
        const action = String(body.action ?? 'add');
        if (['vote', 'retire', 'approve'].includes(action)) {
          const id = requireString(body.id, 'id', { max: 200 });
          if (!cortex.scopeWritableById('playbook', id, agentOf(request))) {
            return sendJson(response, 403, { ok: false, error: 'scope-read-only' });
          }
        }
        if (['add', 'suggest'].includes(action) && !cortex.scopeWritable(scopeOf(request, url, body), agentOf(request))) {
          return sendJson(response, 403, { ok: false, error: 'scope-read-only' });
        }
        if (action === 'add') {
          return sendJson(response, 200, { ok: true, data: cortex.playbook.add({ title: requireString(body.title, 'title', { max: 200 }), body: requireString(body.body, 'body', { max: 4000 }), tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [], validTo: body.validTo ? requireString(body.validTo, 'validTo', { max: 40 }) : null, scopeId: scopeOf(request, url, body) }) });
        }
        if (action === 'vote') return sendJson(response, 200, { ok: true, data: cortex.playbook.vote({ id: requireString(body.id, 'id', { max: 200 }), signal: body.signal === 'harmful' ? 'harmful' : 'helpful' }) });
        if (action === 'retire') return sendJson(response, 200, { ok: true, data: cortex.playbook.retire(requireString(body.id, 'id', { max: 200 })) });
        if (action === 'suggest') return sendJson(response, 200, { ok: true, data: cortex.playbook.suggest({ scopeId: scopeOf(request, url, body), limit: body.limit }) });
        if (action === 'approve') return sendJson(response, 200, { ok: true, data: cortex.playbook.approve(requireString(body.id, 'id', { max: 200 })) });
        if (action === 'render') return sendJson(response, 200, { ok: true, data: cortex.playbook.render({ scopeId: scopeOf(request, url, body) }) });
        throw new Error('playbook action must be add, vote, retire, suggest, approve or render');
      }
      if (route === '/attachments/extract') {
        const extractor = typeof getExtractor === 'function' ? getExtractor() : null;
        if (!extractor || typeof extractor.extract !== 'function') {
          return sendJson(response, 503, { ok: false, error: 'extractor-unavailable' });
        }
        try {
          const extracted = await extractor.extract({
            uri: requireString(body.uri, 'uri', { max: 2000 }),
            mode: requireString(body.mode, 'mode', { max: 16 }),
            language: body.language ? requireString(body.language, 'language', { max: 32 }) : undefined,
          });
          const ingested = cortex.ingestExtractedText({
            targetTraceId: requireString(body.traceId, 'traceId', { max: 200 }),
            text: extracted.text,
            uri: extracted.uri,
            mode: extracted.mode,
            engine: extracted.engine ?? null,
          });
          return sendJson(response, 200, { ok: true, data: { ...extracted, ...ingested } });
        } catch (error) {
          return sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (route === '/trace/attachments') {
        try {
          const result = cortex.attachments.attach({
            traceId: requireString(body.id, 'id', { max: 200 }),
            attachments: body.attachments,
          });
          return sendJson(response, 200, { ok: true, data: result });
        } catch (error) {
          return sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (route === '/attachments/inspect') {
        if (cortex.settings().features?.attachmentReader !== true) {
          return sendJson(response, 403, { ok: false, error: 'attachment-reader-disabled' });
        }
        try {
          const result = cortex.attachments.inspect({ uri: requireString(body.uri, 'uri', { max: 2000 }) });
          return sendJson(response, 200, { ok: true, data: result });
        } catch (error) {
          return sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (route === '/models') {
        return sendJson(response, 200, { ok: true, data: cortex.models.save({ embedding: body.embedding ?? {}, rerank: body.rerank ?? {}, confirm: body.confirm === true }) });
      }
      if (route === '/permissions') {
        return sendJson(response, 200, { ok: true, data: cortex.permissions.update({ key: requireString(body.key, 'key', { max: 80 }), value: body.value === true, confirm: body.confirm === true }) });
      }
      if (route === '/security/grants') {
        const action = requireString(body.action, 'action', { max: 20 });
        if (action === 'add') {
          return sendJson(response, 200, { ok: true, data: cortex.security.addGrant({ grant: requireString(body.grant, 'grant', { max: 200 }), until: body.until ?? null }) });
        }
        if (action === 'revoke') {
          return sendJson(response, 200, { ok: true, data: cortex.security.revokeGrant({ grant: requireString(body.grant, 'grant', { max: 200 }) }) });
        }
        return sendJson(response, 400, { ok: false, error: 'grant action must be add or revoke' });
      }
      if (route === '/permissions/rollback') {
        return sendJson(response, 200, { ok: true, data: cortex.permissions.rollback() });
      }
      if (route === '/vector/rebuild') {
        return sendJson(response, 200, { ok: true, data: await cortex.rebuildVectorAsync({ scopeId: scopeOf(request, url, body), limit: body.limit }) });
      }
      if (route === '/vector/index') {
        return sendJson(response, 200, { ok: true, data: await cortex.indexVectorAsync(requireString(body.id, 'id', { max: 200 })) });
      }
      if (route === '/consolidate') {
        return sendJson(response, 200, { ok: true, data: await cortex.consolidation.run({ scopeId: scopeOf(request, url, body), limit: body.limit, dryRun: body.dryRun === true }) });
      }
      if (route === '/retention/apply') {
        const plan = cortex.retention.plan({ scopeId: scopeOf(request, url, body) });
        return sendJson(response, 200, { ok: true, data: cortex.retention.apply(plan, { dryRun: body.dryRun === true }) });
      }
      if (route === '/tick') {
        return sendJson(response, 200, { ok: true, data: cortex.autonomy.tick({ max: toInt(body.max, 2, 1, 20) }) });
      }
      if (route === '/evolve/propose') {
        return sendJson(response, 200, { ok: true, data: cortex.evolution.propose({
          kind: requireString(body.kind, 'kind', { max: 40 }),
          config: body.config && typeof body.config === 'object' ? body.config : {},
          rationale: requireString(body.rationale, 'rationale', { optional: true, max: 2000 }) ?? '',
        }) });
      }
      if (route === '/working/purge') {
        return sendJson(response, 200, { ok: true, data: { purged: cortex.working.purgeExpired() } });
      }
      if (route === '/evolve/optimize') {
        return sendJson(response, 200, { ok: true, data: cortex.evolution.selfOptimize() });
      }
      if (route === '/evolve/approve') {
        return sendJson(response, 200, { ok: true, data: cortex.evolution.approve(body.id) });
      }
      if (route === '/evolve/rollback') {
        return sendJson(response, 200, { ok: true, data: cortex.evolution.rollback(requireString(body.kind, 'kind', { max: 80 }), body.id) });
      }
      if (route === '/working/add') {
        return sendJson(response, 200, { ok: true, data: cortex.working.add({ scopeId: scopeOf(request, url, body), text: body.text, kind: body.kind, priority: body.priority, pinned: body.pinned === true, ttlMs: body.ttlMs }) });
      }
      if (route === '/working/update') {
        return sendJson(response, 200, { ok: true, data: cortex.working.update(requireString(body.id, 'id', { max: 200 }), { text: body.text, priority: body.priority, pinned: body.pinned }) });
      }
      if (route === '/working/remove') {
        return sendJson(response, 200, { ok: true, data: { removed: cortex.working.remove(requireString(body.id, 'id', { max: 200 })) } });
      }
      if (route === '/goals/add') {
        return sendJson(response, 200, { ok: true, data: cortex.goals.add({ scopeId: scopeOf(request, url, body), title: body.title, description: body.description, priority: body.priority, dueAt: body.dueAt }) });
      }
      if (route === '/goals/update') {
        return sendJson(response, 200, { ok: true, data: cortex.goals.update(requireString(body.id, 'id', { max: 200 }), { title: body.title, description: body.description, priority: body.priority, progress: body.progress, status: body.status }) });
      }
      if (route === '/goals/complete') {
        return sendJson(response, 200, { ok: true, data: cortex.goals.complete(requireString(body.id, 'id', { max: 200 })) });
      }
      if (route === '/emotion/record') {
        return sendJson(response, 200, { ok: true, data: cortex.emotion.record({ text: body.text, target: body.target, traceId: body.traceId }) });
      }
      if (route === '/life/diary') {
        return sendJson(response, 200, { ok: true, data: cortex.life.diaryWrite({ text: body.text, mood: body.mood }) });
      }
      if (route === '/life/dream') {
        return sendJson(response, 200, { ok: true, data: await cortex.life.dreamGenerate() });
      }
      if (route === '/life/sleep') {
        return sendJson(response, 200, { ok: true, data: await cortex.life.sleep({ windowDays: body.windowDays ?? 1 }) });
      }
      if (route === '/compress') {
        return sendJson(response, 200, { ok: true, data: cortex.compression.compress({ limit: body.limit }) });
      }
      return sendJson(response, 404, { ok: false, error: 'not found' });
    } catch (error) {
      logger?.warn?.(`cortex api POST failed: ${error instanceof Error ? error.message : String(error)}`);
      return sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return handler;
}

export function mountApi(ctx, { cortex, logger = null, getExtractor = null } = {}) {
  const handler = createApiHandler({ cortex, logger, getExtractor });
  const mount = (server) => {
    if (!server || typeof server.register !== 'function') return () => {};
    try {
      const dispose = server.register({ kind: 'prefix', path: API_BASE, handler });
      logger?.info?.(`cortex: API mounted at ${API_BASE}`);
      return dispose;
    } catch (error) {
      logger?.warn?.(`cortex: API mount failed: ${error instanceof Error ? error.message : String(error)}`);
      return () => {};
    }
  };
  const server = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
  if (server) return mount(server);
  if (typeof ctx.inject === 'function') {
    try {
      const injected = ctx.inject(['webServer'], (webCtx) => {
        const late = typeof webCtx.get === 'function' ? webCtx.get('webServer') : undefined;
        if (!late) return undefined;
        return webCtx.effect(() => mount(late), 'cortex: api (late webServer)');
      });
      if (typeof injected === 'function') return injected;
    } catch (error) {
      logger?.warn?.(`cortex: late API mount failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return () => {};
}
