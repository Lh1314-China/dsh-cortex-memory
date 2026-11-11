import { clamp } from '../core/time.js';
import { nowIso } from '../core/time.js';
import { stableStringify } from '../core/json.js';

/**
 * The self-state layer: drives, mood, attention.
 *
 * This is deliberately small and mechanical. "Feeling" is not a random number;
 * it is a state that decays toward a baseline, is moved by appraisals, and
 * changes what the system attends to and initiates next.
 */

export const DRIVE_DEFS = Object.freeze({
  coherence: { baseline: 0.6, min: 0, max: 1, halfLifeHours: 18 },
  curiosity: { baseline: 0.55, min: 0, max: 1, halfLifeHours: 8 },
  care: { baseline: 0.6, min: 0, max: 1, halfLifeHours: 24 },
  autonomy: { baseline: 0.55, min: 0, max: 1, halfLifeHours: 24 },
  safety: { baseline: 0.7, min: 0, max: 1, halfLifeHours: 36 },
  expression: { baseline: 0.5, min: 0, max: 1, halfLifeHours: 12 },
});

export const DEFAULT_DRIVES = Object.freeze(
  Object.fromEntries(Object.entries(DRIVE_DEFS).map(([name, def]) => [name, def.baseline])),
);

export const DEFAULT_MOOD = Object.freeze({ valence: 0, arousal: 0.3, energy: 0.6 });
export const DEFAULT_ATTENTION = Object.freeze({ focus: '', salienceThreshold: 0.35, budget: 1, used: 0 });

export function normalizeDrives(input = {}) {
  const out = {};
  for (const [name, def] of Object.entries(DRIVE_DEFS)) {
    out[name] = clamp(input?.[name] ?? def.baseline, def.min, def.max);
  }
  return out;
}

export function applyDriveDeltas(drives, deltas = {}) {
  const base = normalizeDrives(drives);
  for (const [name, delta] of Object.entries(deltas)) {
    if (!(name in DRIVE_DEFS)) continue;
    base[name] = clamp(base[name] + Number(delta || 0), DRIVE_DEFS[name].min, DRIVE_DEFS[name].max);
  }
  return base;
}

export function driftDrives(drives, { elapsedHours = 0, baseline = DEFAULT_DRIVES } = {}) {
  const current = normalizeDrives(drives);
  const hours = Math.max(0, Number(elapsedHours) || 0);
  const out = {};
  for (const [name, def] of Object.entries(DRIVE_DEFS)) {
    const target = clamp(baseline?.[name] ?? def.baseline, def.min, def.max);
    const retention = 0.5 ** (hours / def.halfLifeHours);
    out[name] = clamp(target + (current[name] - target) * retention, def.min, def.max);
  }
  return out;
}

export function normalizeMood(input = {}) {
  return {
    valence: clamp(input?.valence ?? DEFAULT_MOOD.valence, -1, 1),
    arousal: clamp(input?.arousal ?? DEFAULT_MOOD.arousal, 0, 1),
    energy: clamp(input?.energy ?? DEFAULT_MOOD.energy, 0, 1),
  };
}

export function driftMood(mood, { elapsedHours = 0, baseline = DEFAULT_MOOD } = {}) {
  const current = normalizeMood(mood);
  const hours = Math.max(0, Number(elapsedHours) || 0);
  const retention = 0.5 ** (hours / 6);
  return {
    valence: clamp(baseline.valence + (current.valence - baseline.valence) * retention, -1, 1),
    arousal: clamp(baseline.arousal + (current.arousal - baseline.arousal) * retention, 0, 1),
    energy: clamp(baseline.energy + (current.energy - baseline.energy) * retention, 0, 1),
  };
}

export function applyMood(mood, { valence = 0, arousal = 0, salience = 0.5, weight = 0.35 } = {}) {
  const current = normalizeMood(mood);
  const w = clamp(weight * (0.5 + salience), 0, 0.8);
  return {
    valence: clamp(current.valence + (Number(valence) || 0) * w, -1, 1),
    arousal: clamp(current.arousal + (Number(arousal) || 0) * w, 0, 1),
    energy: clamp(current.energy - 0.02 * (Number(arousal) || 0), 0, 1),
  };
}

export function normalizeAttention(input = {}) {
  return {
    focus: String(input?.focus ?? '').slice(0, 300),
    salienceThreshold: clamp(input?.salienceThreshold ?? DEFAULT_ATTENTION.salienceThreshold, 0, 1),
    budget: clamp(input?.budget ?? DEFAULT_ATTENTION.budget, 0, 10),
    used: clamp(input?.used ?? 0, 0, 10),
  };
}

export function defaultSelfState(scopeId = 'global') {
  return {
    scopeId,
    drives: { ...DEFAULT_DRIVES },
    mood: { ...DEFAULT_MOOD },
    attention: { ...DEFAULT_ATTENTION },
    stage: 'infancy',
    updatedAt: nowIso(),
  };
}

function rowToSelf(row) {
  if (!row) return null;
  return {
    scopeId: row.scope_id,
    drives: normalizeDrives(JSON.parse(row.drives_json)),
    mood: normalizeMood(JSON.parse(row.mood_json)),
    attention: normalizeAttention(JSON.parse(row.attention_json)),
    stage: row.stage,
    updatedAt: row.updated_at,
  };
}

export function createSelfStore(db) {
  function get(scopeId = 'global') {
    const row = db.prepare('SELECT * FROM self_state WHERE scope_id = ?').get(scopeId);
    if (row) return rowToSelf(row);
    const state = defaultSelfState(scopeId);
    save(scopeId, state);
    return state;
  }

  function save(scopeId, state) {
    const now = nowIso();
    const drives = normalizeDrives(state?.drives);
    const mood = normalizeMood(state?.mood);
    const attention = normalizeAttention(state?.attention);
    db.prepare(`
      INSERT INTO self_state(scope_id, drives_json, mood_json, attention_json, stage, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_id) DO UPDATE SET
        drives_json = excluded.drives_json,
        mood_json = excluded.mood_json,
        attention_json = excluded.attention_json,
        stage = excluded.stage,
        updated_at = excluded.updated_at
    `).run(
      scopeId,
      stableStringify(drives),
      stableStringify(mood),
      stableStringify(attention),
      state?.stage || 'infancy',
      now,
    );
    return { scopeId, drives, mood, attention, stage: state?.stage || 'infancy', updatedAt: now };
  }

  function update(scopeId, patch = {}) {
    const current = get(scopeId);
    return save(scopeId, {
      ...current,
      ...patch,
      drives: patch.drives ? { ...current.drives, ...patch.drives } : current.drives,
      mood: patch.mood ? { ...current.mood, ...patch.mood } : current.mood,
      attention: patch.attention ? { ...current.attention, ...patch.attention } : current.attention,
    });
  }

  function applyAppraisal(scopeId, appraisal = {}, { at = Date.now(), elapsedHours = 0, baseline = DEFAULT_DRIVES } = {}) {
    const current = get(scopeId);
    const drives = applyDriveDeltas(driftDrives(current.drives, { elapsedHours, baseline }), appraisal.driveDeltas || {});
    const mood = applyMood(driftMood(current.mood, { elapsedHours }), appraisal);
    const attention = normalizeAttention({
      ...current.attention,
      focus: appraisal.focus ?? current.attention.focus,
      used: Math.min(current.attention.budget, current.attention.used + (appraisal.salience ?? 0.5) * 0.1),
    });
    const next = save(scopeId, {
      ...current,
      drives,
      mood,
      attention,
      updatedAt: nowIso(at),
    });
    return { ...next, appraisal };
  }

  return { get, save, update, applyAppraisal };
}
