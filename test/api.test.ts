/**
 * HTTP 接口层与批量调度测试：
 *  - 单篇/批量关键词抽取、建图检查接口；
 *  - 批量中某篇校验错误不影响同批其它篇，顺序与提交一致；
 *  - 返回数量 = min(topK, 入图词数)；
 *  - 服务无跨请求状态（同一请求重复调用结果一致）。
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/routes';

let app: FastifyInstance;

before(async () => {
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

async function post(path: string, body: unknown) {
  return app.inject({ method: 'POST', path, payload: body as Record<string, never> });
}

const DOC = {
  document: {
    sentences: [
      ['猫','坐','在','垫子','上','猫','追','线','球','线','球','滚','到','沙发','下','猫','趴','下','休息'],
      ['垫子','很','软','线','球','很','轻','猫','喜欢','线','球','沙发','很','大','猫','在','沙发','上','睡觉'],
    ],
  },
  stopwords: [],
  topK: 5,
  damping: 0.85,
  windowSize: 3,
};

test('POST /health', async () => {
  const res = await app.inject({ method: 'GET', path: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
});

test('POST /v1/keywords 正常抽取：分数降序、数量等于 min(topK, 节点数)', async () => {
  const res = await post('/v1/keywords', DOC);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.keywords.length, 5);
  for (let i = 1; i < body.keywords.length; i += 1) {
    assert.ok(body.keywords[i - 1].score >= body.keywords[i].score, '分数必须从高到低');
  }
  assert.equal(body.converged, true);
  assert.ok(body.iterations >= 1);
  assert.ok(body.nodeCount >= 5);
  // 猫/线/球 这类反复出现又相互共现的词应排在前列
  const words = body.keywords.map((k: { word: string }) => k.word);
  assert.ok(words.includes('猫'));
});

test('topK 大于实际入图词数时返回全部节点', async () => {
  const res = await post('/v1/keywords', {
    document: { sentences: [['a', 'b', 'c']] },
    topK: 100,
  });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.keywords.length, 3);
  assert.equal(body.nodeCount, 3);
});

test('非法参数被挡在校验层，返回带具体原因的错误 JSON', async () => {
  const res = await post('/v1/keywords', {
    document: { sentences: [['a', 'b']] },
    damping: 1,
  });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error.code, 'INVALID_DAMPING');
  assert.equal(body.error.field, 'damping');
  assert.match(body.error.message, /0, 1/);
});

test('空内容 -> EMPTY_CONTENT；全停用词 -> NO_TOKENS_AFTER_FILTER（错误码可区分）', async () => {
  const r1 = await post('/v1/keywords', { document: { sentences: [] } });
  assert.equal(r1.statusCode, 400);
  assert.equal(r1.json().error.code, 'EMPTY_CONTENT');

  const r2 = await post('/v1/keywords', {
    document: { sentences: [['的', '了']] },
    stopwords: ['的', '了'],
  });
  assert.equal(r2.statusCode, 422);
  assert.equal(r2.json().error.code, 'NO_TOKENS_AFTER_FILTER');
});

test('达到步数上限未收敛 -> NOT_CONVERGED 错误，不返回半成品', async () => {
  const res = await post('/v1/keywords', {
    document: DOC.document,
    maxIterations: 1,
    tolerance: 1e-18,
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'NOT_CONVERGED');
});

test('POST /v1/graph 只做分词与建图，返回节点和带权边，不包含分数', async () => {
  const res = await post('/v1/graph', {
    document: { sentences: [['a', 'b', 'a'], ['b', 'c']] },
    stopwords: ['x'],
    windowSize: 2,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body.graph.nodes, ['a', 'b', 'c']);
  const ab = body.graph.edges.find((e: { source: string; target: string }) => e.source === 'a' && e.target === 'b');
  assert.equal(ab.weight, 2, 'a-b 在句1共现2次（0-1、1-2）');
  const bc = body.graph.edges.find((e: { source: string; target: string }) => e.source === 'b' && e.target === 'c');
  assert.equal(bc.weight, 1);
  assert.ok(!('score' in body) && !('keywords' in body), '建图接口不跑迭代打分');
  // 分词结果中不允许停用词露脸
  for (const sentence of body.tokenizedSentences) {
    assert.ok(!sentence.includes('x'));
  }
});

test('POST /v1/keywords/batch：逐篇独立、互不影响、顺序对应', async () => {
  const res = await post('/v1/keywords/batch', {
    documents: [
      DOC,
      { document: { sentences: [['a', 'b']] }, damping: 1 }, // 校验错误，不影响其它篇
      { document: { sentences: [['的']] }, stopwords: ['的'] }, // NO_TOKENS
      { document: { sentences: [['苹果','香蕉','苹果','香蕉','橙子','苹果']] }, topK: 2 },
    ],
  });
  assert.equal(res.statusCode, 200);
  const { results } = res.json();
  assert.equal(results.length, 4);

  assert.equal(results[0].ok, true);
  assert.equal(results[0].result.keywords.length, 5);

  assert.equal(results[1].ok, false);
  assert.equal(results[1].error.code, 'INVALID_DAMPING');

  assert.equal(results[2].ok, false);
  assert.equal(results[2].error.code, 'NO_TOKENS_AFTER_FILTER');

  assert.equal(results[3].ok, true);
  assert.equal(results[3].result.keywords.length, 2);
  assert.equal(results[3].result.keywords[0].word, '苹果');
});

test('POST /v1/graph/batch 同样逐篇独立', async () => {
  const res = await post('/v1/graph/batch', {
    documents: [
      { document: { sentences: [['a', 'b']] } },
      { document: { sentences: [] } },
    ],
  });
  assert.equal(res.statusCode, 200);
  const { results } = res.json();
  assert.equal(results[0].ok, true);
  assert.equal(results[0].result.graph.nodes.length, 2);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error.code, 'EMPTY_CONTENT');
});

test('批量请求本身格式错误 -> 顶层错误', async () => {
  const r1 = await post('/v1/keywords/batch', { documents: [] });
  assert.equal(r1.statusCode, 400);
  assert.equal(r1.json().error.code, 'EMPTY_CONTENT');

  const r2 = await post('/v1/keywords/batch', {});
  assert.equal(r2.statusCode, 400);
  assert.equal(r2.json().error.code, 'INVALID_REQUEST');
});

test('服务无跨请求状态：同一请求重复发送结果完全一致', async () => {
  const r1 = await post('/v1/keywords', DOC);
  const r2 = await post('/v1/keywords', DOC);
  assert.deepEqual(r1.json(), r2.json());
});

test('原始文本输入走完整接口链路', async () => {
  const res = await post('/v1/keywords', {
    document: { text: '算法 数据 模型。算法 数据。数据 模型。' },
    topK: 3,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().keywords.length, 3);
});

// 复现请求：同一机构名两种切法，旧边键拼接会塌缩成一条边。
const SPLIT_ORG_BODY = {
  document: {
    sentences: [
      ['中国', '人民银行', '发布', '利率'],
      ['中国人民', '银行', '发布', '公告'],
    ],
  },
  windowSize: 2,
};

test('回归：机构名不同切法 —— 建图接口的每对共现词与边权和逐对手数一致', async () => {
  const res = await post('/v1/graph', SPLIT_ORG_BODY);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.nodeCount, 7);
  assert.equal(body.edgeCount, 6);
  // 窗口 2 下每句 3 条相邻共现、每对仅出现一次 => 6 条边权重全为 1。
  assert.deepEqual(
    body.graph.edges.map((e: { source: string; target: string; weight: number }) => [e.source, e.target, e.weight]),
    [
      ['中国', '人民银行', 1],
      ['中国人民', '银行', 1],
      ['人民银行', '发布', 1],
      ['公告', '发布', 1],
      ['利率', '发布', 1],
      ['发布', '银行', 1],
    ],
  );
});

test('回归：同一请求默认步数内收敛，所有分数有限，排序与同分字典序照旧', async () => {
  const res = await post('/v1/keywords', SPLIT_ORG_BODY);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.converged, true);
  assert.ok(body.iterations >= 1 && body.iterations <= 200);
  assert.equal(body.keywords.length, 7);
  for (const k of body.keywords) {
    assert.equal(typeof k.score, 'number', `词 ${k.word} 的分数必须是数字`);
    assert.ok(Number.isFinite(k.score), `词 ${k.word} 的分数必须有限`);
  }
  for (let i = 1; i < body.keywords.length; i += 1) {
    assert.ok(body.keywords[i - 1].score >= body.keywords[i].score, '分数必须从高到低');
  }
  assert.deepEqual(
    body.keywords.map((k: { word: string }) => k.word),
    ['发布', '人民银行', '银行', '中国', '中国人民', '公告', '利率'],
  );
});

test('预分词里带空格/连字符/斜杠的词按整体处理，共现关系照实入图', async () => {
  const res = await post('/v1/graph', {
    document: { sentences: [['new york', '/x-y/', 'new york']] },
    windowSize: 3,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body.graph.nodes, ['/x-y/', 'new york']);
  assert.deepEqual(
    body.graph.edges.map((e: { source: string; target: string; weight: number }) => [e.source, e.target, e.weight]),
    [['/x-y/', 'new york', 2]],
  );
  assert.deepEqual(body.tokenizedSentences, [['new york', '/x-y/', 'new york']]);
});

test('批量中混入该问题稿：它自己出正确结果，同批其它篇不受影响', async () => {
  const res = await post('/v1/keywords/batch', {
    documents: [
      SPLIT_ORG_BODY,
      { document: { sentences: [['苹果', '香蕉']] } },
    ],
  });
  assert.equal(res.statusCode, 200);
  const { results } = res.json();
  assert.equal(results.length, 2);

  assert.equal(results[0].ok, true);
  assert.equal(results[0].result.converged, true);
  assert.equal(results[0].result.nodeCount, 7);
  assert.equal(results[0].result.edgeCount, 6);
  for (const k of results[0].result.keywords) {
    assert.ok(Number.isFinite(k.score));
  }

  assert.equal(results[1].ok, true);
  assert.equal(results[1].result.nodeCount, 2);
  assert.deepEqual(
    results[1].result.keywords.map((k: { word: string }) => k.word),
    ['苹果', '香蕉'],
  );
});
