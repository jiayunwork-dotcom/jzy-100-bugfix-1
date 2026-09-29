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
import { buildCooccurrenceGraph } from '../src/core/graph';
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

// ---------------------------------------------------------------------------
// 回归：上游分词粒度不稳导致“一个词是另一个词前缀”时，旧版边键（无分隔符
// 拼接词字符串）会把两条不同的边塌缩成一条，进而使迭代发散 / 假收敛。
// ---------------------------------------------------------------------------

/**
 * 无歧义的“无序词对”键：JSON 序列化两个端点，端点按字典序排列。
 * 用 JSON 而非字符串拼接，是因为本批回归夹具的词元本身可能包含任意字符
 * （空格、连字符、斜杠……），拼接键会重蹈“前缀塌缩”的覆辙；JSON 对引号、
 * 反斜杠与控制字符都有转义，保证不同词对不可能映射到同一个键。
 */
function pairKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}

/** 逐对手数 windowSize=2 的共现：句内相邻位置两两成对，每出现一次权重 +1。 */
function expectedBigrams(sentences: readonly string[][]): Map<string, number> {
  const expected = new Map<string, number>();
  for (const sentence of sentences) {
    for (let i = 0; i + 1 < sentence.length; i += 1) {
      const [a, b] = [sentence[i], sentence[i + 1]];
      if (a === b) continue; // 图不连自环
      const key = pairKey(a, b);
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
  }
  return expected;
}

/** 把图导出的边收集成 “无歧义词对键 -> 权重”。 */
function edgeWeightMap(graph: ReturnType<typeof build>): Map<string, number> {
  return new Map(graph.toData().edges.map((e) => [pairKey(e.source, e.target), e.weight]));
}

test('回归（线上复现稿）：前缀词元不再塌缩边，图与逐对手数完全一致', () => {
  const sentences: string[][] = [
    ['中国', '人民银行', '发布', '利率'],
    ['中国人民', '银行', '发布', '公告'],
  ];
  const graph = build(sentences, 2);

  // 7 个词元互不为同一节点；逐对手数的相邻共现对恰好 6 对。
  assert.equal(graph.nodeCount, 7);
  assert.equal(graph.edgeCount, 6, '旧实现会把 (中国,人民银行) 与 (中国人民,银行) 塌成一条，只剩 5 条');

  const byPair = edgeWeightMap(graph);
  const expected = expectedBigrams(sentences);
  assert.equal(byPair.size, expected.size);
  for (const [key, weight] of expected) {
    assert.equal(byPair.get(key), weight, `边 ${key} 的权重与逐对手数不一致`);
  }

  // 默认步数（200）内收敛，所有分数都是有限数值。
  const result = rankNodes(graph, 0.85, 1e-6, 200);
  assert.equal(result.converged, true);
  assert.ok(result.iterations <= 200);
  assert.equal(result.scores.size, 7);
  for (const [word, score] of result.scores) {
    assert.ok(Number.isFinite(score), `词「${word}」的分数必须有限，实际为 ${String(score)}`);
  }

  // 排序：分数降序，同分按字典序。
  // 图关于 (人民银行↔银行)、(中国↔中国人民)、(利率↔公告) 对称，分数应两两相等。
  const ranked = selectTopKeywords(result, 10);
  assert.equal(ranked.length, 7);
  for (let i = 1; i < ranked.length; i += 1) {
    const prev = ranked[i - 1];
    const cur = ranked[i];
    assert.ok(
      prev.score > cur.score || (prev.score === cur.score && prev.word < cur.word),
      `排序规则被破坏：${prev.word}(${prev.score}) 不应排在 ${cur.word}(${cur.score}) 前`,
    );
  }
});

test('回归（ASCII 同构夹具）：词元互为前缀时边不塌缩', () => {
  // 与中文复现稿同构的碰撞模式：("ab","cde") 与 ("abc","de") 的旧拼接键同为 "abcde"。
  const sentences: string[][] = [
    ['ab', 'cde', 'f', 'g'],
    ['abc', 'de', 'f', 'h'],
  ];
  const graph = build(sentences, 2);
  assert.equal(graph.nodeCount, 7);
  assert.equal(graph.edgeCount, 6);

  const byPair = edgeWeightMap(graph);
  for (const [key, weight] of expectedBigrams(sentences)) {
    assert.equal(byPair.get(key), weight, `边 ${key} 权重不符`);
  }

  const result = rankNodes(graph, 0.85, 1e-6, 200);
  assert.equal(result.converged, true);
  for (const score of result.scores.values()) {
    assert.ok(Number.isFinite(score));
  }
});

test('边键健壮性：词元含空格 / 连字符 / 斜杠等任意字符，图照实反映共现', () => {
  const sentences: string[][] = [
    ['new york', '沪深300', 'a/b'],
    ['new york', '沪深300', 'x-y z'],
  ];
  const graph = build(sentences, 3);

  // 整串「new york」是一个节点，不被空白拆开。
  assert.deepEqual(graph.toData().nodes, ['a/b', 'new york', 'x-y z', '沪深300']);

  const byPair = edgeWeightMap(graph);
  // windowSize=3：
  // 句1: (a/b,new york)、(a/b,沪深300)、(new york,沪深300)
  // 句2: (new york,x-y z)、(new york,沪深300)、(x-y z,沪深300)
  assert.equal(graph.edgeCount, 5);
  assert.equal(byPair.get(pairKey('a/b', 'new york')), 1);
  assert.equal(byPair.get(pairKey('a/b', '沪深300')), 1);
  assert.equal(byPair.get(pairKey('new york', '沪深300')), 2, '跨两句共现，权重累加为 2');
  assert.equal(byPair.get(pairKey('new york', 'x-y z')), 1);
  assert.equal(byPair.get(pairKey('x-y z', '沪深300')), 1);

  const result = rankNodes(graph, 0.85, 1e-6, 200);
  assert.equal(result.converged, true);
  assert.ok(result.scores.has('new york'));
  for (const score of result.scores.values()) {
    assert.ok(Number.isFinite(score));
  }
});

test('数值底线：迭代中出现 NaN/Infinity 必须报 NON_FINITE_SCORE，绝不假收敛', () => {
  // 复刻修复前建图实现（无分隔符词串拼接边键）在复现稿上产出的坏图：
  // 两条不同边塌缩后，totalOutWeight 与边权记账不一致，转移比例列和失衡，
  // 分数发散成 Infinity；旧打分逻辑在 Infinity-Infinity=NaN 时 delta 比较
  // 恒为 false，反而把 maxDelta 卡小、误判收敛，Infinity 经 JSON 变成 null。
  class LegacyBuggyGraph {
    private readonly nodeIndex = new Map<string, number>();
    private readonly edgeMap = new Map<string, { source: string; target: string; weight: number }>();
    private readonly totalWeight: number[] = [];
    addNode(word: string): void {
      if (!this.nodeIndex.has(word)) {
        this.nodeIndex.set(word, this.nodeIndex.size);
        this.totalWeight.push(0);
      }
    }
    addEdge(a: string, b: string): void {
      if (a === b) return;
      this.addNode(a);
      this.addNode(b);
      const key = a < b ? `${a}${b}` : `${b}${a}`; // 旧的无分隔符拼接（缺陷点）
      const existing = this.edgeMap.get(key);
      if (existing) {
        existing.weight += 1;
      } else {
        this.edgeMap.set(key, { source: a < b ? a : b, target: a < b ? b : a, weight: 1 });
      }
      this.totalWeight[this.nodeIndex.get(a)!] += 1;
      this.totalWeight[this.nodeIndex.get(b)!] += 1;
    }
    toAdjacency() {
      const nodes: string[] = new Array(this.nodeIndex.size);
      for (const [word, idx] of this.nodeIndex) nodes[idx] = word;
      const neighbors = nodes.map(() => [] as { index: number; weight: number }[]);
      for (const edge of this.edgeMap.values()) {
        const i = this.nodeIndex.get(edge.source)!;
        const j = this.nodeIndex.get(edge.target)!;
        neighbors[i].push({ index: j, weight: edge.weight });
        neighbors[j].push({ index: i, weight: edge.weight });
      }
      return { nodes, neighbors, totalOutWeight: [...this.totalWeight] };
    }
  }
  const legacy: any = new LegacyBuggyGraph();
  for (const t of ['中国', '人民银行', '发布', '利率']) legacy.addNode(t);
  for (const [a, b] of [['中国', '人民银行'], ['人民银行', '发布'], ['发布', '利率']]) legacy.addEdge(a, b);
  for (const t of ['中国人民', '银行', '公告']) legacy.addNode(t);
  for (const [a, b] of [['中国人民', '银行'], ['银行', '发布'], ['发布', '公告']]) legacy.addEdge(a, b);

  // 步数给得很宽裕：旧逻辑恰好在这种设置下“假收敛 + null 分数”；
  // 新逻辑必须在数值溢出的那一轮直接报错，任何时候都不返回坏分数。
  assert.throws(
    () => rankNodes(legacy, 0.85, 1e-6, 5000),
    (err: unknown) => err instanceof AppError && err.code === ErrorCodes.NON_FINITE_SCORE,
  );

  // 人为构造“总出权为 NaN 且节点真有邻居”的坏邻接：weight/NaN = NaN，
  // 新分数立刻变成 NaN，必须当轮报错，而不是靠 delta 比较蒙混过关。
  const poisoned: any = {
    toAdjacency: () => ({
      nodes: ['p', 'q'],
      neighbors: [
        [{ index: 1, weight: 1 }],
        [{ index: 0, weight: 1 }],
      ],
      totalOutWeight: [NaN, NaN],
    }),
  };
  assert.throws(
    () => rankNodes(poisoned, 0.85, 1e-6, 10),
    (err: unknown) => err instanceof AppError && err.code === ErrorCodes.NON_FINITE_SCORE,
  );
});
