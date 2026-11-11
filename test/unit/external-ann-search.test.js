import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

test('async search uses the configured external ANN and keeps scope filtering', async () => {
  const targetIds = [];
  let calls = 0;
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw || '{}');
      assert.equal(body.vector.length, 256);
      calls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ items: targetIds.map((id, index) => ({ id, score: 0.99 - index * 0.01 })) }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-external-ann-'));
  const cortex = createCortex({
    config: {
      dataRoot: dir,
      dbFile: path.join(dir, 'cortex.sqlite'),
      features: { vector: true, vectorAnnExternal: true },
      vectorAnnEndpoint: `http://127.0.0.1:${port}/search`,
    },
  });
  try {
    assert.equal(cortex.vector.status().externalAnn.enabled, true);
    for (let index = 0; index < 6; index += 1) {
      const written = cortex.write({ text: `外部 ANN 目标记忆 ${index}。`, explicit: true });
      targetIds.push(written.trace.id);
    }
    const result = await cortex.searchAsync('外部 ANN', { limit: 5 });

    assert.equal(calls, 1);
    assert.ok(result.items.some((item) => targetIds.includes(item.id)));
    assert.ok(result.trace.sources.some((source) => source.source === 'vector'));
  } finally {
    cortex.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
