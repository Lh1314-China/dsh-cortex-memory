import fs from 'node:fs';
import path from 'node:path';

function front(value) {
  const text = String(value ?? '');
  return text.replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

export function traceToMarkdown(trace) {
  const attachments = Array.isArray(trace.metadata?.attachments) ? trace.metadata.attachments : [];
  const lines = [
    '---',
    `id: "${front(trace.id)}"`,
    `kind: "${front(trace.kind)}"`,
    `title: "${front(trace.title ?? '')}"`,
    `state: "${front(trace.state)}"`,
    `recorded_at: "${front(trace.recordedAt)}"`,
    `valid_at: "${front(trace.validAt ?? '')}"`,
    `source: "${front(trace.source ?? '')}"`,
    `importance: ${Number(trace.importance ?? 0)}`,
    `confidence: ${Number(trace.confidence ?? 0)}`,
    `tags: [${(trace.tags ?? []).map((tag) => `"${front(tag)}"`).join(', ')}]`,
    ...(attachments.length ? [`attachments: ${JSON.stringify(attachments)}`] : []),
    '---',
    '',
    trace.content ?? '',
    '',
  ];
  if (attachments.length) {
    lines.push('## Attachments (metadata only)', '');
    for (const item of attachments) {
      lines.push(`- ${item.kind}: ${item.name ?? item.uri}${item.mime ? ` (${item.mime})` : ''}${item.bytes ? ` · ${item.bytes} B` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function exportMarkdown(cortex, targetDir, { scopeId = 'global' } = {}) {
  const root = path.resolve(targetDir);
  fs.mkdirSync(root, { recursive: true });
  const traces = cortex.repos.traces.list({ scopeId, state: 'active', limit: 5000 });
  const publicTraces = traces.filter((trace) => trace.sensitivity !== 'secret');
  const content = [
    '# Cortex memory mirror',
    '',
    `> Exported at ${new Date().toISOString()} · scope ${scopeId}`,
    '',
    ...publicTraces.map(traceToMarkdown),
  ].join('\n');
  writeAtomic(path.join(root, 'MEMORY.md'), content);

  const self = cortex.self(scopeId);
  writeAtomic(path.join(root, 'SELF.md'), [
    '# Self',
    '',
    `- stage: ${self.self.stage}`,
    `- drives: ${JSON.stringify(self.self.drives)}`,
    `- mood: ${JSON.stringify(self.self.mood)}`,
    '',
    '## Identity',
    self.identity?.content?.narrative ?? '',
    '',
    '## Values',
    ...(self.identity?.content?.values ?? []).map((value) => `- ${value}`),
    '',
    '## Boundaries',
    ...(self.identity?.content?.boundaries ?? []).map((value) => `- ${value}`),
    '',
    '## Relationships',
    ...(self.relationships ?? []).map((rel) => `- ${rel.target}: trust ${rel.trust} / care ${rel.care}`),
    '',
  ].join('\n'));

  const facts = cortex.repos.facts.list({ scopeId, limit: 5000 }).filter((fact) => fact.status === 'active');
  const entityMap = new Map(cortex.repos.entities.list({ scopeId, limit: 5000 }).map((entity) => [entity.id, entity.name]));
  writeAtomic(path.join(root, 'FACTS.md'), [
    '# Facts',
    '',
    ...facts.map((fact) => `- ${entityMap.get(fact.subjectId) ?? fact.subjectId} —${fact.predicate}→ ${fact.objectId ? entityMap.get(fact.objectId) ?? fact.objectId : fact.objectLiteral} (confidence ${fact.confidence.toFixed(2)}, valid ${fact.validFrom ?? '?'} → ${fact.validTo ?? 'now'})`),
    '',
  ].join('\n'));

  const skills = cortex.engines.skills.list({ scopeId, limit: 500 });
  writeAtomic(path.join(root, 'SKILLS.md'), [
    '# Skills',
    '',
    ...skills.map((skill) => `## ${skill.name} (${skill.state})\n- success: ${skill.successCount} / failure: ${skill.failureCount}\n- steps: ${skill.steps.map((step) => typeof step === 'string' ? step : JSON.stringify(step)).join(' → ')}\n`),
  ].join('\n'));

  return {
    root,
    files: ['MEMORY.md', 'SELF.md', 'FACTS.md', 'SKILLS.md'],
    traces: publicTraces.length,
    skippedSecrets: traces.length - publicTraces.length,
    facts: facts.length,
    skills: skills.length,
  };
}
