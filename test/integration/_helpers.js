/**
 * Shared helpers for the integration suite.
 *
 * The tests are deliberately black-box: every helper here only creates real
 * cortex instances in throwaway directories, drives real repository/engine
 * code, and cleans up afterwards. Nothing mocks the module under test.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createCortex } from '../../src/service/cortex.js';
import { API_BASE } from '../../src/api/routes.js';

export const DAY_MS = 86_400_000;
/** Fixed reference instant: 2026-11-11T10:00:00+08:00. */
export const BASE_MS = Date.parse('2026-11-11T10:00:00+08:00');

/**
 * Create a cortex backed by a fresh temporary directory.
 * Returns the directory (for cleanup) and the service.
 */
export function makeCortex(config = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-integration-'));
  const dataRoot = config.dataRoot ?? path.join(dir, 'data');
  const dbFile = config.dbFile ?? path.join(dataRoot, 'cortex.sqlite');
  const cortex = createCortex({ config: { ...config, dataRoot, dbFile } });
  return { dir, cortex };
}

/**
 * Close every cortex first, then delete every temporary directory. Safe to
 * call from a finally block even when the test failed halfway through setup.
 */
export function cleanup(...contexts) {
  for (const context of contexts) {
    try {
      context?.cortex?.close();
    } catch {
      /* closing is best-effort, cleanup must not mask the real assertion */
    }
    if (context?.dir) rmSync(context.dir, { recursive: true, force: true });
  }
}

/** Request stream shaped the way the API handler expects node:http objects. */
export function apiRequest({
  method = 'GET',
  route = '/ping',
  body = null,
  headers = {},
  remoteAddress = '127.0.0.1',
  host = '127.0.0.1:7430',
  origin = 'http://127.0.0.1:7430',
  site = 'same-origin',
  url = null,
} = {}) {
  const stream = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]);
  stream.method = method;
  stream.url = url ?? `${API_BASE}${route}`;
  const merged = {
    host,
    origin,
    'sec-fetch-site': site,
    ...(body === null ? {} : { 'content-type': 'application/json' }),
    ...headers,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  stream.headers = merged;
  stream.socket = { remoteAddress };
  return stream;
}

/** Minimal ServerResponse recorder: enough for the route handler. */
export function apiResponse() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers ?? null;
    },
    end(chunk) {
      if (chunk != null) this.body += String(chunk);
    },
  };
}

export async function invokeApi(handler, options = {}) {
  const response = apiResponse();
  await handler(apiRequest(options), response);
  return { status: response.statusCode, headers: response.headers, json: JSON.parse(response.body || '{}') };
}

/**
 * Split an exported MEMORY.md mirror into its per-memory frontmatter blocks.
 *
 * The exporter writes one multi-entry document; the importer expects one
 * memory per file. This helper converts the mirror into the vault shape the
 * importer documents, using the same textual boundaries the exporter emits.
 */
export function splitMirrorEntries(markdown) {
  const entries = [];
  const pattern = /^---\n([\s\S]*?)\n---\n\n([\s\S]*?)(?=\n---\n|$)/gm;
  for (const match of String(markdown ?? '').matchAll(pattern)) {
    entries.push({ frontmatter: match[1], body: match[2].trim() });
  }
  return entries;
}

/** Write one frontmatter memory file into a vault directory. */
export function writeVaultEntry(dir, name, { frontmatter, body }) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
  return file;
}

/** Write a raw file, mainly for hand-authored vault fixtures. */
export function writeRaw(dir, name, content) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content, 'utf8');
  return file;
}
