import fs from 'node:fs';
import path from 'node:path';

const FILE = 'scope-grants.json';

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEntry(raw) {
  if (typeof raw === 'string') {
    const grant = clean(raw);
    return /^[^:\s]+:\S+$/.test(grant) ? { grant, until: null } : null;
  }
  if (!raw || typeof raw !== 'object' || typeof raw.grant !== 'string') return null;
  const grant = clean(raw.grant);
  if (!/^[^:\s]+:\S+$/.test(grant)) return null;
  const until = raw.until == null ? null : clean(raw.until, 80);
  if (until && !Number.isFinite(Date.parse(until))) return null;
  return { grant, until: until || null };
}

function readFile(dataRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataRoot, FILE), 'utf8'));
    return {
      grants: Array.isArray(parsed.grants) ? parsed.grants.map(normalizeEntry).filter(Boolean).slice(0, 200) : [],
      revoked: Array.isArray(parsed.revoked) ? [...new Set(parsed.revoked.map((item) => clean(item)).filter((item) => /^[^:\s]+:\S+$/.test(item)))].slice(0, 200) : [],
    };
  } catch {
    return { grants: [], revoked: [] };
  }
}

function writeFile(dataRoot, data) {
  fs.mkdirSync(dataRoot, { recursive: true });
  const file = path.join(dataRoot, FILE);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

export function createScopeGrantStore(dataRoot) {
  let state = readFile(dataRoot);

  function all() {
    return { grants: [...state.grants], revoked: [...state.revoked] };
  }

  function add(raw) {
    const entry = normalizeEntry(raw);
    if (!entry) throw new Error('grant must be scope:agent or {grant, until}');
    state = {
      grants: [...state.grants.filter((item) => item.grant !== entry.grant), entry],
      revoked: state.revoked.filter((item) => item !== entry.grant),
    };
    writeFile(dataRoot, state);
    return entry;
  }

  function revoke(value) {
    const grant = clean(value);
    if (!/^[^:\s]+:\S+$/.test(grant)) throw new Error('grant must be scope:agent');
    state = {
      grants: state.grants.filter((item) => item.grant !== grant),
      revoked: [...new Set([...state.revoked, grant])].slice(0, 200),
    };
    writeFile(dataRoot, state);
    return grant;
  }

  return { all, add, revoke };
}
