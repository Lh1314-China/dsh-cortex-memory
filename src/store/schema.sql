-- dsh-cortex schema v1.
-- All timestamps are ISO-8601 UTC strings. All content is UTF-8 text.
-- The event ledger is append-only; derived tables are rebuildable in principle.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT,
  scope_id TEXT NOT NULL,
  session_id TEXT,
  turn_id TEXT,
  operation_id TEXT,
  causation_id TEXT,
  payload_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  prev_hash TEXT
);

CREATE INDEX IF NOT EXISTS events_scope_at ON events(scope_id, at);
CREATE INDEX IF NOT EXISTS events_operation ON events(operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS events_operation_unique
  ON events(operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  event_id TEXT NOT NULL REFERENCES events(id),
  session_id TEXT,
  turn_id TEXT,
  actor TEXT,
  source TEXT,
  valid_at TEXT,
  recorded_at TEXT NOT NULL,
  last_access_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.7,
  salience REAL NOT NULL DEFAULT 0.5,
  valence REAL NOT NULL DEFAULT 0,
  arousal REAL NOT NULL DEFAULT 0,
  sensitivity TEXT NOT NULL DEFAULT 'personal',
  state TEXT NOT NULL DEFAULT 'active',
  compression TEXT NOT NULL DEFAULT 'raw',
  stability REAL NOT NULL DEFAULT 1,
  difficulty REAL NOT NULL DEFAULT 5,
  retrievability REAL NOT NULL DEFAULT 1,
  review_count INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS traces_scope_state ON traces(scope_id, state);
CREATE INDEX IF NOT EXISTS traces_scope_valid ON traces(scope_id, valid_at);
CREATE INDEX IF NOT EXISTS traces_last_access ON traces(last_access_at);
CREATE INDEX IF NOT EXISTS traces_hash ON traces(hash);
CREATE INDEX IF NOT EXISTS traces_event ON traces(event_id);

CREATE VIRTUAL TABLE IF NOT EXISTS traces_fts_index USING fts5(
  trace_id UNINDEXED,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'concept',
  name TEXT NOT NULL,
  canonical TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS entities_scope_canonical
  ON entities(scope_id, canonical);
CREATE INDEX IF NOT EXISTS entities_name ON entities(name);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES entities(id),
  predicate TEXT NOT NULL,
  object_id TEXT REFERENCES entities(id),
  object_literal TEXT,
  valid_from TEXT,
  valid_to TEXT,
  recorded_at TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'active',
  source_event_id TEXT REFERENCES events(id),
  invalidated_by TEXT,
  superseded_at TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS facts_subject_predicate
  ON facts(subject_id, predicate, status);
CREATE INDEX IF NOT EXISTS facts_valid ON facts(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS facts_scope_status ON facts(scope_id, status);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS edges_from ON edges(from_id, rel);
CREATE INDEX IF NOT EXISTS edges_to ON edges(to_id, rel);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  rel TEXT NOT NULL DEFAULT 'related',
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_links_from ON memory_links(from_type, from_id);
CREATE INDEX IF NOT EXISTS memory_links_to ON memory_links(to_type, to_id);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  fact_a TEXT NOT NULL,
  fact_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  operation_id TEXT UNIQUE,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS jobs_scope ON jobs(scope_id, status);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  trace_id TEXT,
  signal TEXT NOT NULL,
  value REAL,
  source TEXT,
  event_id TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_trace ON feedback(trace_id, at);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  intent TEXT,
  preconditions_json TEXT NOT NULL DEFAULT '[]',
  steps_json TEXT NOT NULL DEFAULT '[]',
  contraindications_json TEXT NOT NULL DEFAULT '[]',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  state TEXT NOT NULL DEFAULT 'candidate',
  source_trace_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS skills_scope_state ON skills(scope_id, state);

CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'episode',
  period_start TEXT,
  period_end TEXT,
  content TEXT NOT NULL,
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  coverage REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  model TEXT
);

CREATE INDEX IF NOT EXISTS summaries_scope_level ON summaries(scope_id, level);

CREATE TABLE IF NOT EXISTS identity_versions (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  rationale TEXT,
  proposed_by TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_scope_version
  ON identity_versions(scope_id, version);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  metrics_json TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_target ON audit(target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);

CREATE TABLE IF NOT EXISTS embeddings (
  trace_id TEXT PRIMARY KEY REFERENCES traces(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS self_state (
  scope_id TEXT PRIMARY KEY,
  drives_json TEXT NOT NULL,
  mood_json TEXT NOT NULL,
  attention_json TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'infancy',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appraisals (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  event_id TEXT,
  trace_id TEXT,
  relevance REAL NOT NULL DEFAULT 0,
  novelty REAL NOT NULL DEFAULT 0,
  threat REAL NOT NULL DEFAULT 0,
  opportunity REAL NOT NULL DEFAULT 0,
  valence REAL NOT NULL DEFAULT 0,
  arousal REAL NOT NULL DEFAULT 0,
  identity_relevance REAL NOT NULL DEFAULT 0,
  drive_deltas_json TEXT NOT NULL DEFAULT '{}',
  relationship_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.6,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS appraisals_scope_at ON appraisals(scope_id, at);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  target TEXT NOT NULL,
  trust REAL NOT NULL DEFAULT 0.5,
  care REAL NOT NULL DEFAULT 0.5,
  familiarity REAL NOT NULL DEFAULT 0,
  expectations_json TEXT NOT NULL DEFAULT '[]',
  boundaries_json TEXT NOT NULL DEFAULT '[]',
  recent_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS relationships_scope_target ON relationships(scope_id, target);

CREATE TABLE IF NOT EXISTS intentions (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  created_at TEXT NOT NULL,
  due_at TEXT,
  expires_at TEXT,
  cooldown_until TEXT,
  result_json TEXT
);

CREATE INDEX IF NOT EXISTS intentions_scope_status ON intentions(scope_id, status, priority);

CREATE TABLE IF NOT EXISTS growth_metrics (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  at TEXT NOT NULL,
  metrics_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS growth_metrics_scope_at ON growth_metrics(scope_id, at);

CREATE TABLE IF NOT EXISTS working_items (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'focus',
  text TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 0.5,
  pinned INTEGER NOT NULL DEFAULT 0,
  source_trace_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS working_items_scope ON working_items(scope_id, pinned, priority);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  priority REAL NOT NULL DEFAULT 0.5,
  progress REAL NOT NULL DEFAULT 0,
  parent_id TEXT,
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS goals_scope_status ON goals(scope_id, status, priority);

CREATE TABLE IF NOT EXISTS emotion_events (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  trace_id TEXT,
  text TEXT NOT NULL,
  emotions_json TEXT NOT NULL,
  target TEXT,
  source TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS emotion_events_scope_at ON emotion_events(scope_id, at);

CREATE TABLE IF NOT EXISTS affect_targets (
  scope_id TEXT NOT NULL,
  target TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  attitude TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, target)
);

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  text TEXT NOT NULL,
  mood TEXT,
  source TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS diary_scope_at ON diary_entries(scope_id, at);

CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dreams_scope_at ON dreams(scope_id, at);

CREATE TABLE IF NOT EXISTS sleep_runs (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  at TEXT NOT NULL,
  report_json TEXT NOT NULL
);

-- L1.5 work rules / playbook. These are distilled working agreements, not
-- identity: they can expire, be retired, and carry helpful/harmful counters.
CREATE TABLE IF NOT EXISTS playbook_rules (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  helpful INTEGER NOT NULL DEFAULT 0,
  harmful INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  source_trace_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS playbook_scope_status ON playbook_rules(scope_id, status, valid_to);
CREATE INDEX IF NOT EXISTS playbook_valid ON playbook_rules(valid_from, valid_to);

-- Replayable consolidation runs. Decisions are recorded before/after applying,
-- and the input digest lets an operator verify what the model actually saw.
CREATE TABLE IF NOT EXISTS dream_runs (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  at TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT,
  input_digest TEXT NOT NULL,
  input_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL DEFAULT '[]',
  applied_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dream_runs_scope_at ON dream_runs(scope_id, at);






