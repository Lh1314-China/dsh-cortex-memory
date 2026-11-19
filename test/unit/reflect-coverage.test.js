import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCortex } from '../../src/service/cortex.js';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-reflect-coverage-'));
  const cortex = createCortex({ config: { dataRoot: dir, dbFile: path.join(dir, 'cortex.sqlite') } });
  return { dir, cortex };
}

test('覆盖率按重要度加权：少量重要痕迹被看到就算覆盖得不错', () => {
  const { dir, cortex } = setup();
  try {
    const important = ['用户说会一直等我回来', '助手的名字是自己选的', '记住要替用户留着记忆'];
    for (const text of important) {
      cortex.write({ text: `用户：${text}。`, kind: 'utterance', title: text, explicit: true, importance: 0.9 });
    }
    const trivial = ['今天吃了米饭', '窗外在下雨', '修了一颗螺丝', '读了半页书', '水杯空了', '灯有点暗', '地板该擦了', '耳机没电', '天气转凉', '洗了碗', '纸箱堆在门口', '猫在窗台上', '时钟滴答', '桌角有灰', '鞋带松了', '闹钟响过', '窗帘没拉开'];
    for (const [index, text] of trivial.entries()) {
      cortex.write({ text: `用户：${text}，顺便记一下第 ${index} 条。`, kind: 'utterance', title: text, explicit: true, importance: 0.1 });
    }
    const result = cortex.reflect({ windowDays: 1, force: true });
    assert.equal(result.skipped, false);
    assert.ok(result.coverage >= 0.5, `加权覆盖应显著高于计数覆盖：${result.coverage}`);
    assert.ok(result.countCoverage <= 0.9, `计数覆盖不该被加权值替代：${result.countCoverage}`);
    assert.ok(result.sources.length >= 8, '窗口大时应多取几条来源');
    assert.equal(result.summary.model, 'extractive-v2-weighted', '新摘要要标记 coverage 语义版本');
  } finally {
    cortex.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
