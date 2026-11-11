import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('extracted text becomes a derived trace without mutating the target', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-ingest-extracted-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  try {
    const target = cortex.write({ text: '目标记忆：这张图以后有用。', explicit: true });
    const targetId = target.trace.id;
    const before = cortex.get(targetId);
    const result = cortex.ingestExtractedText({
      targetTraceId: targetId,
      text: '白饭 HELLO 123',
      uri: 'file:///C:/tmp/frame.png',
      mode: 'ocr',
      engine: 'windows-ocr',
    });
    assert.equal(result.targetTraceId, targetId);
    assert.ok(result.extractedTraceId);
    const after = cortex.get(targetId);
    assert.equal(after.content, before.content);
    const extracted = cortex.get(result.extractedTraceId);
    assert.equal(extracted.content, '白饭 HELLO 123');
    assert.equal(extracted.metadata.derivedFrom, targetId);
    assert.equal(extracted.metadata.extractor.mode, 'ocr');
    assert.ok(cortex.search('白饭').items.some((item) => item.id === result.extractedTraceId));
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
