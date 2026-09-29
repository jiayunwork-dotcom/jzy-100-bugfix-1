/**
 * 核心算法单元测试。
 *
 * 重点覆盖需求点名的三条关系：
 *   1) 反复插入某词的更多出现次数，其最终分数不降；
 *   2) 整篇文档全部来自停用词表 -> 退化情形报错（图里无有效节点）；
 *   3) 阻尼系数趋零时，所有入图词分数趋于一致。
 * 另外覆盖：边数随窗口单调不减、返回数量/排序、未收敛报错等。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError, ErrorCodes } from '../src/core/errors';
import { buildCooccurrenceGraph, type CooccurrenceGraph } from '../src/core/graph';
import { rankNodes } from '../src/core/rank';
import { selectTopKeywords } from '../src/core/select';
import { inspectGraph } from '../src/services/keywordService';
import { parseDocumentRequest } from '../src/services/validation';
import { StopwordFilter, tokenizeDocument } from '../src/core/tokenize';

const NO_STOP = new StopwordFilter([]);

function build(sentences: string[][], windowSize = 2, stopwords: readonly string[] = []) {
  const filter = new StopwordFilter(stopwords);
  const tokenized = tokenizeDocument({ sentences }, filter);
  return buildCooccurrenceGraph(tokenized, windowSize);
}

test('关系一：人为反复插入某词的更多次出现，其最终分数不降（多种阻尼与窗口）', () => {
  // 目标词 T=核心 与多个邻居相连；插入更多 T 不改变其它词的相对位置。
  const base: string[][] = [
    ['核心','算法','数据','核心','模型','代码','数据','算法','模型','核心','系统','架构','数据','模型','算法','系统','代码','核心','架构','数据'],
    ['模型','系统','核心','代码','数据','架构','算法','核心','系统','模型','数据','代码','架构','核心','算法','系统','模型','数据','核心','代码'],
  ];
  const augmented: string[][] = [
    ['核心','算法','数据','核心','模型','核心','代码','数据','算法','模型','核心','系统','核心','架构','数据','模型','算法','核心','系统','代码','核心','架构','数据','核心'],
    ['模型','核心','系统','核心','代码','数据','架构','算法','核心','系统','模型','核心','数据','代码','架构','核心','算法','系统','核心','模型','数据','核心','代码','核心'],
  ];

  for (const damping of [0.7, 0.85, 0.9]) {
    for (const windowSize of [2, 3, 5]) {
      const s1 = rankNodes(build(base, windowSize), damping, 1e-13, 500).scores.get('核心')!;
      const s2 = rankNodes(build(augmented, windowSize), damping, 1e-13, 500).scores.get('核心')!;
      assert.ok(
        s2 + 1e-9 >= s1,
        `damping=${damping} window=${windowSize}: 插入后分数 ${s2} 低于原分数 ${s1}`,
      );
      // 该夹具下还应当严格变高（起核心支撑作用的词权重被加强）
      assert.ok(s2 > s1, `damping=${damping} window=${windowSize}: 期望严格上升`);
    }
  }
});

test('关系一（叶子词夹具）：低分词被插入更多次后同样严格上升', () => {
  const base: string[][] = [
    ['叶子','枢纽','甲','枢纽','乙','枢纽','丙','枢纽','甲','枢纽','乙','枢纽','丙','枢纽'],
  ];
  const augmented: string[][] = [
    ['叶子','枢纽','甲','枢纽','叶子','乙','枢纽','丙','枢纽','甲','枢纽','乙','枢纽','叶子','丙','枢纽'],
  ];
  for (const damping of [0.7, 0.85, 0.9]) {
    const s1 = rankNodes(build(base, 2), damping, 1e-13, 500).scores.get('叶子')!;
    const s2 = rankNodes(build(augmented, 2), damping, 1e-13, 500).scores.get('叶子')!;
    assert.ok(s2 > s1, `damping=${damping}: ${s2} 应严格大于 ${s1}`);
  }
});

test('关系二：文档词全部来自停用词表 -> 分词后为空，图里没有任何有效节点', () => {
  const stopwords = ['的', '了', '是', '在'];
  const filter = new StopwordFilter(stopwords);
  const tokenized = tokenizeDocument(
    { sentences: [['的', '了'], ['是', '在', '的']] },
    filter,
  );
  const total = tokenized.reduce((n, s) => n + s.length, 0);
  assert.equal(total, 0, '分词结果里不允许停用词露脸');

  const graph = buildCooccurrenceGraph(tokenized, 2);
  assert.equal(graph.nodeCount, 0);
  assert.equal(graph.edgeCount, 0);
  assert.deepEqual(graph.toData(), { nodes: [], edges: [] });

  // 服务层应当识别这种退化情形并报 NO_TOKENS_AFTER_FILTER，而不是返回零分词
  assert.throws(
    () =>
      inspectGraph(
        parseDocumentRequest({
          document: { sentences: [['的', '了'], ['是', '在', '的']] },
          stopwords,
        }),
      ),
    (err: unknown) => err instanceof AppError && err.code === ErrorCodes.NO_TOKENS_AFTER_FILTER,
  );
});

test('关系三：阻尼系数趋零时，所有入图词分数趋于一致（差异仅来自浮点误差）', () => {
  const sentences: string[][] = [
    ['猫','坐','在','的','垫子','上','猫','追','线','球','线','球','滚','到','了','沙发','下','猫','趴','下','休息'],
    ['垫子','很','软','线','球','很','轻','猫','喜欢','线','球','沙发','很','大','猫','在','沙发','上','睡觉'],
  ];
  const graph = build(sentences, 3, ['的', '了']);
  assert.ok(graph.nodeCount > 2);

  const result = rankNodes(graph, 1e-8, 1e-13, 500);
  const scores = [...result.scores.values()];
  const spread = Math.max(...scores) - Math.min(...scores);
  // 理论上分数趋于 1，剩余差异量级约等于阻尼系数本身（含浮点误差）
  assert.ok(
    spread < 1e-6,
    `damping 趋零时分数应趋于一致，实际 spread=${spread}`,
  );
  for (const s of scores) {
    assert.ok(Math.abs(s - 1) < 1e-6);
  }
  assert.equal(result.converged, true);
});

test('关系四：窗口只调大调小回来 —— 同一文档窗口宽度增大，边数只能持平或增多', () => {
  const sentences: string[][] = [
    ['a','b','c','d','e','f','g','h','a','c','e','g','b','d','f','h'],
    ['c','b','a','f','e','d','h','g','a','d','g','b','e','h','c','f'],
  ];
  let prev = 0;
  for (const windowSize of [2, 3, 4, 5, 8, 16, 100]) {
    const count = build(sentences, windowSize).edgeCount;
    assert.ok(count >= prev, `窗口 ${windowSize}: 边数 ${count} 小于窗口更小时的 ${prev}`);
    prev = count;
  }
});

test('共现：同一对词多次共现累加边权；跨句子也累加', () => {
  const sentences: string[][] = [['a', 'b', 'a', 'b'], ['b', 'a']];
  const graph = build(sentences, 2);
  assert.deepEqual(graph.nodeCount ? graph.toData().nodes : [], ['a', 'b']);
  const edge = graph.toData().edges.find((e) => e.source === 'a' && e.target === 'b');
  // 句1 内 (a,b)@0-1、(b,a)@1-2、(a,b)@2-3 共 3 次；句2 内 1 次 => 4
  assert.equal(edge?.weight, 4);
});

test('窗口 3：窗口内任意两词都连边（含非相邻位置）', () => {
  const graph = build([['a', 'b', 'c']], 3);
  const keys = graph.toData().edges.map((e) => `${e.source}-${e.target}`).sort();
  assert.deepEqual(keys, ['a-b', 'a-c', 'b-c']);
});

test('没有共现伙伴的词仍是孤立节点；damping 趋零时孤立词也得一致分数', () => {
  const graph = build([['孤独'], ['猫', '鱼']], 2);
  assert.deepEqual(graph.toData().nodes, ['孤独', '猫', '鱼']);
  const result = rankNodes(graph, 1e-9, 1e-13, 100);
  assert.ok(Math.abs(result.scores.get('孤独')! - 1) < 1e-7);
});

test('打分公式：邻居按边权占比分配分数（手工可验证的两词图）', () => {
  // 仅 a-b 相连，权重 4。总出边权重双方都为 4，占比 1。
  // S(a)=1-d+d*S(b), S(b)=1-d+d*S(a) => S(a)=S(b)=1
  const graph = build([['a', 'b', 'a', 'b']], 2);
  const result = rankNodes(graph, 0.5, 1e-13, 200);
  assert.ok(Math.abs(result.scores.get('a')! - 1) < 1e-9);
  assert.ok(Math.abs(result.scores.get('b')! - 1) < 1e-9);
});

test('打分公式：链式三词 a-b-c（window=2），端点低于中点', () => {
  const graph = build([['a', 'b', 'c']], 2);
  const result = rankNodes(graph, 0.85, 1e-13, 500);
  const { a, b, c } = { a: result.scores.get('a')!, b: result.scores.get('b')!, c: result.scores.get('c')! };
  assert.ok(b > a, '中间词 b 应高于端点 a');
  assert.ok(Math.abs(a - c) < 1e-9, '对称图两端分数相等');
});

test('结果截断：数量等于 min(topK, 入图词数)，分数降序、同分按字典序', () => {
  const graph = build([['a', 'b', 'c', 'd', 'e']], 2);
  const result = rankNodes(graph, 0.85, 1e-13, 500);

  const top2 = selectTopKeywords(result, 2);
  assert.equal(top2.length, 2);
  for (let i = 1; i < top2.length; i += 1) {
    assert.ok(top2[i - 1].score >= top2[i].score);
  }

  // topK 大于节点数时返回全部
  const all = selectTopKeywords(result, 100);
  assert.equal(all.length, 5);

  // 同分按字典序：全部是孤立节点（入度贡献均为 0）时，
  // 分数都精确等于 1-damping，逐位相等。
  const isolated = build([['a'], ['c'], ['e'], ['b'], ['d']], 2);
  const tieResult = rankNodes(isolated, 0.85, 1e-13, 10);
  assert.equal(tieResult.converged, true);
  for (const s of tieResult.scores.values()) {
    assert.ok(Math.abs(s - 0.15) < 1e-12);
  }
  const words = selectTopKeywords(tieResult, 50).map((k) => k.word);
  assert.deepEqual(words, ['a', 'b', 'c', 'd', 'e']);
});

test('达到步数上限仍未收敛必须直接报 NOT_CONVERGED，不返回半成品', () => {
  const graph = build([['a', 'b', 'c', 'd', 'e']], 2);
  assert.throws(
    () => rankNodes(graph, 0.85, 1e-15, 1),
    (err: unknown) => err instanceof AppError && err.code === ErrorCodes.NOT_CONVERGED,
  );
});

test('停用词与分词共用同一过滤逻辑：停词既不出现在分词结果，也不进入图', () => {
  const filter = new StopwordFilter(['的']);
  const tokenized = tokenizeDocument(
    { sentences: [['猫', '的', '鱼']] },
    filter,
  );
  assert.deepEqual(tokenized, [['猫', '鱼']]);
  const graph = buildCooccurrenceGraph(tokenized, 2);
  const data = graph.toData();
  assert.deepEqual(data.nodes, ['猫', '鱼']);
  // '的' 被滤掉后，猫-鱼 成为窗口/句子内的相邻幸存词，共现边连在二者之间
  assert.equal(data.edges.length, 1);
  assert.equal(data.edges[0].source, '猫');
  assert.equal(data.edges[0].target, '鱼');
});

test('原始文本输入：按句读切句、空白切词，过滤逻辑与预分词输入一致', () => {
  const filter = new StopwordFilter(['的']);
  const tokenized = tokenizeDocument({ text: '猫 的 鱼\n狗 的 骨头' }, filter);
  assert.deepEqual(tokenized, [['猫', '鱼'], ['狗', '骨头']]);
});

// 复现夹具：上游分词粒度不稳，同一机构名在两句里被切成不同词面量。
// 旧实现的边键直接拼接词面量（无分隔符），("中国","人民银行") 与
// ("中国人民","银行") 塌缩成同一条边，导致少边、权重错乱、迭代发散。
const SPLIT_ORG: string[][] = [
  ['中国', '人民银行', '发布', '利率'],
  ['中国人民', '银行', '发布', '公告'],
];

test('回归（边键拼接碰撞）：机构名不同切法不得塌缩边，逐对手数的 6 条边齐全且权重各为 1', () => {
  const graph = build(SPLIT_ORG, 2);
  assert.equal(graph.nodeCount, 7);
  assert.equal(graph.edgeCount, 6);

  const data = graph.toData();
  assert.deepEqual(
    data.nodes,
    ['中国', '中国人民', '人民银行', '公告', '利率', '发布', '银行'],
  );
  // 窗口 2、每句 4 个词：每句各 3 条相邻共现边，两句共 6 条，无跨句重复对。
  const expected = [
    ['中国', '人民银行'],
    ['中国人民', '银行'],
    ['人民银行', '发布'],
    ['公告', '发布'],
    ['利率', '发布'],
    ['发布', '银行'],
  ];
  assert.deepEqual(
    data.edges.map((e) => [e.source, e.target]),
    expected,
  );
  for (const edge of data.edges) {
    assert.equal(edge.weight, 1, `边 ${edge.source}-${edge.target} 权重应为 1`);
  }
});

test('回归：同一份夹具在默认步数内收敛，所有分数都是有限数值，同分按字典序', () => {
  const graph = build(SPLIT_ORG, 2);
  // 默认参数：damping 0.85、tolerance 1e-6、maxIterations 200
  const result = rankNodes(graph, 0.85, 1e-6, 200);
  assert.equal(result.converged, true);
  assert.ok(result.iterations >= 1 && result.iterations <= 200);
  assert.equal(result.scores.size, 7);
  for (const [word, score] of result.scores) {
    assert.ok(Number.isFinite(score), `词「${word}」的分数必须有限，实际 ${String(score)}`);
  }

  const top = selectTopKeywords(result, 50).map((k) => k.word);
  // 发布 是跨两句的枢纽，分数最高；同分对按字典序：
  // 人民银行<银行、中国<中国人民、公告<利率。
  assert.deepEqual(top, ['发布', '人民银行', '银行', '中国', '中国人民', '公告', '利率']);
});

test('边键碰撞在多种“可拼接混淆”词面上都不再发生（含带空格的英文专名）', () => {
  // 旧拼接键（排序后直接相连）下每一组的两对词都会塌缩；下标键与词面量无关，必须分开。
  const cases: string[][][] = [
    [['中国', '人民银行'], ['中国人民', '银行']],
    [['a b', 'c'], ['a', 'b c']],
    [['x-', 'yz/w'], ['x-y', 'z/w']],
  ];
  for (const sentences of cases) {
    const graph = build(sentences, 2);
    assert.equal(graph.nodeCount, 4);
    assert.equal(graph.edgeCount, 2, `夹具 ${JSON.stringify(sentences)} 应有两条互不相同的边`);
    const data = graph.toData();
    for (const edge of data.edges) {
      assert.equal(edge.weight, 1);
    }
    // 图结构正确 -> 两条互不相连的边构成对称图，全部稳态分数为 1 且正常收敛。
    const result = rankNodes(graph, 0.85, 1e-6, 200);
    assert.equal(result.converged, true);
    for (const score of result.scores.values()) {
      assert.ok(Number.isFinite(score));
      assert.ok(Math.abs(score - 1) < 1e-9);
    }
  }
});

test('预分词中的词可含空格/连字符/斜杠等任意字符：原文共现关系照实入图', () => {
  // 「new york」整体算一个词；与 '/x-y/' 在窗口 3 内共现两次（位置 0-1、1-2）。
  const graph = build([['new york', '/x-y/', 'new york']], 3);
  const data = graph.toData();
  assert.deepEqual(data.nodes, ['/x-y/', 'new york']);
  assert.deepEqual(
    data.edges.map((e) => [e.source, e.target, e.weight]),
    [['/x-y/', 'new york', 2]],
  );
});

test('数值守卫：迭代出现 Infinity 时不得标记为收敛，直接抛 NOT_CONVERGED', () => {
  // 构造一个真实建图 API 无法产生的病态邻接结构：节点自环权重 2、
  // 但总出边权重只记 1，转移放大约 1.85 倍/步，分数必在约 1200 步内冲到 Infinity。
  // 守卫必须在发散时拦下，而不是让 maxDelta 因 NaN 比较恒假而误判收敛。
  const divergent = {
    toAdjacency() {
      return {
        nodes: ['x'],
        neighbors: [[{ index: 0, weight: 2 }]],
        totalOutWeight: [1],
      };
    },
  } as unknown as CooccurrenceGraph;
  assert.throws(
    () => rankNodes(divergent, 0.85, 1e-6, 5000),
    (err: unknown) => err instanceof AppError && err.code === ErrorCodes.NOT_CONVERGED,
  );
});

test('数值守卫：分数出现 NaN 时第一步即拒绝，绝不返回被污染的结果', () => {
  // Infinity/Infinity = NaN，下一跳分数立刻变成 NaN。
  const nanGraph = {
    toAdjacency() {
      return {
        nodes: ['x', 'y'],
        neighbors: [
          [{ index: 1, weight: Infinity }],
          [{ index: 0, weight: Infinity }],
        ],
        totalOutWeight: [Infinity, Infinity],
      };
    },
  } as unknown as CooccurrenceGraph;
  assert.throws(
    () => rankNodes(nanGraph, 0.85, 1e-6, 5000),
    (err: unknown) => err instanceof AppError && err.code === ErrorCodes.NOT_CONVERGED,
  );
});
