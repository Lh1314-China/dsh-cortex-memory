/**
 * Deterministic synthetic memory workload. It is not a public benchmark and
 * must not be reported as LoCoMo/LongMemEval numbers; it is a local regression
 * and latency harness.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES = ['米饭', '插件', '记忆引擎', '鲸鱼', '主人', '同伴', '直播', '语音', '项目', '代码', '测试', 'legacy-data', 'QQ', 'B站', '声音', '梦', '日记'];
const VERBS = ['修好了', '想起来了', '决定继续', '记录一下', '有点担心', '很开心', '测试了', '重新整理了', '发现了', '计划明天'];
const TOPICS = ['图检索', '向量检索', '遗忘曲线', '工作卡', '火花卡', '身份版本', '关系模型', '反思', '巩固', '守护', '备份', '权限'];
const PARAPHRASES = new Map([
  ['白饭', '米饭'],
  ['插件', '扩展程序'],
  ['记忆引擎', '记忆系统'],
  ['鲸鱼', '鲸'],
  ['直播', '实况'],
  ['测试', '验证'],
  ['图检索', '图谱查询'],
  ['向量检索', '向量查询'],
  ['遗忘曲线', '遗忘衰减'],
  ['工作卡', '任务卡'],
  ['火花卡', '灵感卡'],
  ['身份版本', '人设版本'],
  ['关系模型', '关系图谱'],
  ['巩固', '强化'],
  ['守护', '保护'],
  ['备份', '存档'],
  ['权限', '许可'],
]);

export function generateSynthetic({ count = 1000, queries = 50, seed = 42, task = 'needle' } = {}) {
  const random = mulberry32(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const traces = [];
  const idByToken = new Map();
  for (let i = 0; i < count; i += 1) {
    const place = pick(PLACES);
    const verb = pick(VERBS);
    const topic = pick(TOPICS);
    const day = 1 + Math.floor(random() * 300);
    const text = `${place} ${verb} ${topic}，第 ${i} 条合成记忆。`;
    const id = `trc_syn_${i}`;
    traces.push({
      id,
      text,
      title: `${topic} #${i}`,
      tags: [place, topic],
      importance: Math.round(random() * 100) / 100,
      recordedAt: new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString(),
    });
    for (const token of [place, topic]) {
      const list = idByToken.get(token) ?? [];
      list.push(id);
      idByToken.set(token, list);
    }
  }
  const queryList = [];
  if (task === 'needle') {
    for (let i = 0; i < queries; i += 1) {
      // A unique needle: the query names one specific row by its ordinal.
      // This measures index/ranking correctness, not semantic paraphrase recall.
      const targetIndex = Math.floor(random() * count);
      const target = traces[targetIndex];
      queryList.push({
        query: `${target.title} 第 ${targetIndex} 条合成记忆`,
        type: 'needle',
        relevant: [target.id],
        targetId: target.id,
      });
    }
  } else if (task === 'theme' || task === 'paraphrase') {
    const tokens = [...idByToken.keys()].filter((token) =>
      (idByToken.get(token)?.length ?? 0) >= 2 && (task !== 'paraphrase' || PARAPHRASES.has(token)));
    for (let i = 0; i < queries && tokens.length; i += 1) {
      const token = pick(tokens);
      const relevant = idByToken.get(token).slice();
      const query = task === 'paraphrase' ? (PARAPHRASES.get(token) ?? token) : token;
      queryList.push({
        query,
        type: task,
        relevant,
        targetToken: token,
      });
    }
  } else {
    throw new Error(`unknown synthetic task: ${task}`);
  }
  return { traces, queries: queryList, seed, task, generatedAt: new Date().toISOString() };
}
