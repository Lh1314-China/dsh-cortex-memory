import fs from 'node:fs';
import path from 'node:path';
import { hashText } from '../core/ids.js';

function parseFrontmatter(text) {
  const source = String(text ?? '');
  if (!source.startsWith('---\n')) return { meta: {}, body: source };
  const end = source.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: source };
  const head = source.slice(4, end);
  const body = source.slice(end + 4).replace(/^\n/, '');
  const meta = {};
  for (const line of head.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    meta[match[1]] = value;
  }
  return { meta, body };
}

export function parseMemoryMarkdown(text) {
  const { meta, body } = parseFrontmatter(text);
  const title = meta.title || body.split(/\r?\n/).find((line) => line.startsWith('# '))?.slice(2).trim() || '未命名记忆';
  return {
    id: meta.id || null,
    kind: meta.kind || 'utterance',
    title,
    content: body.trim(),
    tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
    importance: Number(meta.importance ?? 0.5),
    recordedAt: meta.recorded_at || meta.date || null,
    state: meta.state || 'active',
  };
}

/**
 * Split a multi-entry mirror (several `---` frontmatter blocks in one file) into
 * entries. A normal one-memory-per-file vault still yields a single entry.
 */
export function parseMemoryEntries(text) {
  const source = String(text ?? '');
  const starts = [];
  const re = /^---\s*$/gm;
  let match;
  while ((match = re.exec(source)) !== null) starts.push(match.index);
  if (starts.length < 2) return [parseMemoryMarkdown(source)];
  const entries = [];
  for (let index = 0; index + 1 < starts.length; index += 2) {
    const from = starts[index];
    const to = index + 2 < starts.length ? starts[index + 2] : source.length;
    const block = source.slice(from, to);
    const parsed = parseMemoryMarkdown(block);
    if (parsed.content) entries.push(parsed);
  }
  return entries.length ? entries : [parseMemoryMarkdown(source)];
}

const MIRROR_METADATA = new Set(['SELF.md', 'FACTS.md', 'SKILLS.md']);

export function collectMarkdownFiles(root) {
  const absolute = path.resolve(root);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return absolute.endsWith('.md') ? [absolute] : [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(file);
    }
  };
  walk(absolute);
  return out;
}

export function importMarkdown(cortex, root, { dryRun = false, scopeId = 'global', limit = 2000 } = {}) {  const files = collectMarkdownFiles(root).slice(0, Math.max(1, Math.min(10000, limit)));
  const items = [];
  for (const file of files) {
    try {
      if (MIRROR_METADATA.has(path.basename(file))) {
        items.push({ file, skipped: true, reason: 'mirror-metadata' });
        continue;
      }
      const raw = fs.readFileSync(file, 'utf8');
      const entries = parseMemoryEntries(raw);
      for (const parsed of entries) {
        if (parsed.state !== 'active' || parsed.content.length < 2) {
          items.push({ file, skipped: true, reason: 'inactive-or-empty' });
          continue;
        }
        if (dryRun) {
          items.push({ file, skipped: false, dryRun: true, title: parsed.title });
          continue;
        }
        const result = cortex.write({
          text: parsed.content,
          title: parsed.title,
          kind: parsed.kind,
          tags: parsed.tags,
          importance: parsed.importance,
          explicit: true,
          operationId: `markdown:${parsed.id ?? hashText(`${file}:${parsed.title}:${parsed.content}`)}`,
          now: parsed.recordedAt ? Date.parse(parsed.recordedAt) : undefined,
          scopeId,
        });
        items.push({ file, skipped: result.skipped === true, reason: result.reason ?? null, traceId: result.trace?.id ?? null, title: parsed.title });
      }
    } catch (error) {
      items.push({ file, skipped: true, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { root: path.resolve(root), files: files.length, imported: items.filter((item) => !item.skipped).length, skipped: items.filter((item) => item.skipped).length, items };
}

/**
 * Live mirror sync: entries carrying an existing `id` update that trace in
 * place (title/content/tags/importance) instead of creating a duplicate. This
 * is deliberately separate from import: import is additive, sync is a merge.
 */
export function syncMarkdown(cortex, root, { dryRun = false, scopeId = 'global', limit = 2000 } = {}) {
  const files = collectMarkdownFiles(root).slice(0, Math.max(1, Math.min(10000, limit)));
  const items = [];
  let updated = 0;
  let created = 0;
  for (const file of files) {
    try {
      if (MIRROR_METADATA.has(path.basename(file))) {
        items.push({ file, action: 'skip', reason: 'mirror-metadata' });
        continue;
      }
      const raw = fs.readFileSync(file, 'utf8');
      for (const parsed of parseMemoryEntries(raw)) {
        if (parsed.state !== 'active' || parsed.content.length < 2) {
          items.push({ file, action: 'skip', reason: 'inactive-or-empty' });
          continue;
        }
        if (parsed.id) {
          const current = cortex.repos.traces.get(parsed.id);
          if (current) {
            const changed = current.content.trim() !== parsed.content.trim()
              || (current.title ?? '') !== (parsed.title ?? '')
              || JSON.stringify(current.tags ?? []) !== JSON.stringify(parsed.tags ?? [])
              || Number(current.importance) !== Number(parsed.importance);
            if (!changed) {
              items.push({ file, action: 'unchanged', traceId: parsed.id });
              continue;
            }
            if (!dryRun) {
              cortex.repos.traces.update(parsed.id, {
                title: parsed.title,
                content: parsed.content,
                tags: parsed.tags,
                importance: parsed.importance,
              });
              cortex.repos.audit?.record?.({ actor: 'user', action: 'markdown.sync.update', targetType: 'trace', targetId: parsed.id, detail: { file } });
            }
            updated += 1;
            items.push({ file, action: dryRun ? 'would-update' : 'updated', traceId: parsed.id });
            continue;
          }
        }
        if (!dryRun) {
          const result = cortex.write({
            text: parsed.content,
            title: parsed.title,
            kind: parsed.kind,
            tags: parsed.tags,
            importance: parsed.importance,
            explicit: true,
            operationId: `markdown:${parsed.id ?? hashText(`${file}:${parsed.title}:${parsed.content}`)}`,
            now: parsed.recordedAt ? Date.parse(parsed.recordedAt) : undefined,
            scopeId,
          });
          created += 1;
          items.push({ file, action: 'created', traceId: result.trace?.id ?? null });
        } else {
          items.push({ file, action: 'would-create' });
        }
      }
    } catch (error) {
      items.push({ file, action: 'error', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { root: path.resolve(root), files: files.length, updated, created, items, dryRun };
}
