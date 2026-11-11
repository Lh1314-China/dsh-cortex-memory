import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('forget deletes attachment metadata with the trace and archive keeps it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-attachments-delete-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const archived = cortex.write({
      text: '带附件的归档记忆。',
      explicit: true,
      attachments: [{ kind: 'image', uri: 'https://example.test/archive.png' }],
    });
    assert.equal(archived.trace.metadata.attachments.length, 1);
    assert.equal(cortex.forget({ traceId: archived.trace.id, mode: 'archive' }).removed, true);
    assert.equal(cortex.repos.traces.get(archived.trace.id).state, 'archived');
    assert.equal(cortex.repos.traces.get(archived.trace.id).metadata.attachments.length, 1);

    const deleted = cortex.write({
      text: '带附件的删除记忆。',
      explicit: true,
      attachments: [{ kind: 'audio', uri: 'https://example.test/voice.mp3' }],
    });
    assert.equal(cortex.forget({ traceId: deleted.trace.id, mode: 'delete' }).removed, true);
    assert.equal(cortex.repos.traces.get(deleted.trace.id), null);
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
