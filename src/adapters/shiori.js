import fs from 'node:fs';
import path from 'node:path';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function parseFrontMatter(text) {
  const source = String(text ?? '');
  if (!source.startsWith('---')) return { meta: {}, body: source };
  const end = source.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: source };
  const meta = {};
  for (const line of source.slice(3, end).split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, body: source.slice(end + 4).replace(/^\r?\n/, '') };
}

function listFiles(dir, extension) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function classifySparkCard(card = {}) {
  const text = `${card.title ?? ''} ${card.content ?? card.contentPreview ?? card.summary ?? ''} ${(card.triggers ?? []).join(' ')}`;
  if (/应该|必须|不要|先|再|每次|以后|记得|避免|优先|禁止|务必|规则|教训/.test(text)) return 'instruction';
  if (/插件|安装|配置|命令|路径|报错|测试|接口|版本|构建|项目|函数|文件|系统|git|npm|dsh|api|bug|fix|build|deploy|代码|模块|记忆区域|海马体|语义|面板|开关|检索|时间线|叙事|焦点|健康|体检|策略|权限|工具|上下文|注入|向量|图谱|工作卡|火花|协议|服务|进程|数据库|SQLite|脚本|日志/i.test(text)) return 'observation';
  if (/主人|本鲸|喜欢|爱|难过|开心|心疼|陪|声音|白饭|抱|想|梦|日记|称呼|相处|情绪|温暖|孤单|甜|笑|哭|晚安|早安/.test(text)) return 'preference';
  return 'utterance';
}

/**
 * Read-only importer for the shiori layout:
 *   persona/<scope>.md
 *   scopes/<scope>/core.md
 *   scopes/<scope>/topics/*.md
 *   sparks/scopes/<scope>/sparks.json
 *
 * It never writes to dataRoot. Every item gets a deterministic operationId, so
 * running it again is idempotent.
 */
export function createShioriImporter({ cortex, logger = null } = {}) {
  if (!cortex) throw new Error('shiori importer needs a cortex service');

  function importFrom(dataRoot, { scopeId = 'global', now = Date.now(), activateIdentity = false } = {}) {
    const root = path.resolve(dataRoot);
    if (!fs.existsSync(root)) throw new Error(`shiori dataRoot not found: ${root}`);
    const counts = { persona: 0, core: 0, topics: 0, sparks: 0, skipped: 0, errors: [] };
    const at = now;

    const personaFile = path.join(root, 'persona', `${scopeId}.md`);
    const personaText = readText(personaFile);
    if (personaText) {
      const existing = cortex.stores.identityStore.list(scopeId).some((item) => item.rationale === 'shiori:persona');
      if (!existing) {
        cortex.stores.identityStore.propose(scopeId, { narrative: personaText.trim() }, {
          rationale: 'shiori:persona',
          proposedBy: 'shiori-import',
          activate: activateIdentity,
        });
        counts.persona += 1;
      } else {
        counts.skipped += 1;
      }
    }

    const coreFile = path.join(root, 'scopes', scopeId, 'core.md');
    const coreText = readText(coreFile);
    if (coreText) {
      const written = cortex.write({
        text: coreText,
        kind: 'identity',
        title: 'shiori 核心记忆',
        tags: ['shiori', 'core'],
        source: 'shiori:core',
        importance: 0.95,
        explicit: true,
        operationId: `shiori:${scopeId}:core`,
        now: at,
      });
      if (written.skipped) counts.skipped += 1;
      else counts.core += 1;
    }

    const topicDir = path.join(root, 'scopes', scopeId, 'topics');
    for (const name of listFiles(topicDir, '.md')) {
      const key = name.slice(0, -3);
      const parsed = parseFrontMatter(readText(path.join(topicDir, name)) ?? '');
      const written = cortex.write({
        text: parsed.body,
        kind: 'reflection',
        title: parsed.meta.title || key,
        summary: parsed.meta.summary || null,
        tags: ['shiori', 'topic', key],
        source: `shiori:topic:${key}`,
        importance: 0.72,
        explicit: true,
        operationId: `shiori:${scopeId}:topic:${key}`,
        now: at,
      });
      if (written.skipped) counts.skipped += 1;
      else counts.topics += 1;
    }

    const sparksFile = path.join(root, 'sparks', 'scopes', scopeId, 'sparks.json');
    const sparksText = readText(sparksFile);
    if (sparksText) {
      try {
        const db = JSON.parse(sparksText);
        const cards = db?.cards && typeof db.cards === 'object' ? db.cards : {};
        for (const [id, card] of Object.entries(cards)) {
          if (!card || typeof card !== 'object') continue;
          if (card.state === 'archived' || card.archivedAt) { counts.skipped += 1; continue; }
          const content = String(card.content ?? card.contentPreview ?? card.summary ?? '').trim();
          if (!content) continue;
          const written = cortex.write({
            text: content,
            kind: classifySparkCard(card),
            title: card.title || id,
            summary: card.summary || null,
            tags: ['shiori', 'spark', ...(Array.isArray(card.triggers) ? card.triggers : [])],
            source: `shiori:spark:${id}`,
            importance: card.vitality === 'evergreen' ? 0.85 : 0.6,
            confidence: 0.8,
            explicit: true,
            operationId: `shiori:${scopeId}:spark:${id}`,
            now: at,
          });
          if (written.skipped) counts.skipped += 1;
          else counts.sparks += 1;
        }
      } catch (error) {
        counts.errors.push(`sparks: ${error instanceof Error ? error.message : String(error)}`);
        logger?.warn?.(`shiori import sparks failed: ${counts.errors.at(-1)}`);
      }
    }

    return { dataRoot: root, scopeId, ...counts, at: new Date(at).toISOString() };
  }

  return { importFrom };
}
