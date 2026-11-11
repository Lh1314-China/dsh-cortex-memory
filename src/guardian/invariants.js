import { integrityCheck } from '../store/database.js';

const TRACE_STATES = new Set(['active', 'archived', 'superseded']);
const FACT_STATES = new Set(['active', 'disputed', 'invalidated']);

export function checkInvariants({ db, events, traces, selfStore = null, identityStore = null } = {}) {
  if (!db || !events || !traces) throw new Error('invariants need db, events and traces');
  const issues = [];
  const add = (code, message, detail = null) => issues.push({ code, message, detail });

  const chain = events.verifyChain();
  if (!chain.ok) add('EVENT_CHAIN', `事件链断裂：${chain.reason}`, { at: chain.at });

  const integrity = integrityCheck(db);
  if (integrity !== 'ok') add('SQLITE_INTEGRITY', `SQLite integrity_check: ${integrity}`);

  const badTraceState = Number(db.prepare('SELECT COUNT(*) AS c FROM traces WHERE state NOT IN (?, ?, ?)').get(...TRACE_STATES).c);
  if (badTraceState > 0) add('TRACE_STATE', `${badTraceState} 条 trace 状态非法`);

  const badFactState = Number(db.prepare('SELECT COUNT(*) AS c FROM facts WHERE status NOT IN (?, ?, ?)').get(...FACT_STATES).c);
  if (badFactState > 0) add('FACT_STATE', `${badFactState} 条 fact 状态非法`);

  const badWindow = Number(db.prepare('SELECT COUNT(*) AS c FROM facts WHERE valid_from IS NOT NULL AND valid_to IS NOT NULL AND valid_from >= valid_to').c);
  if (badWindow > 0) add('FACT_WINDOW', `${badWindow} 条事实有效期倒置`);

  const fts = traces.ftsCount();
  const total = traces.count();
  if (fts !== total) add('FTS_DRIFT', `FTS ${fts} / traces ${total}`);

  if (selfStore) {
    try {
      const self = selfStore.get('global');
      for (const [name, value] of Object.entries(self.drives)) {
        if (!(value >= 0 && value <= 1)) add('DRIVE_RANGE', `驱力 ${name} 越界：${value}`);
      }
      for (const [name, value] of Object.entries(self.mood)) {
        if (!Number.isFinite(value)) add('MOOD_RANGE', `情绪 ${name} 非数字`);
      }
    } catch (error) {
      add('SELF_STATE', `self state 读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (identityStore) {
    try {
      const rows = db.prepare("SELECT scope_id, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM identity_versions GROUP BY scope_id").all();
      for (const row of rows) {
        if (Number(row.active) !== 1) add('IDENTITY_ACTIVE', `scope ${row.scope_id} 的 active 身份版本数 ${row.active ?? 0}（应为 1）`, { scopeId: row.scope_id });
      }
    } catch {
      /* optional */
    }
  }

  const badJobs = Number(db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE attempts > max_attempts').c);
  if (badJobs > 0) add('JOB_ATTEMPTS', `${badJobs} 个任务 attempts 超过 max_attempts`);

  return { ok: issues.length === 0, issues, integrity, chain };
}
