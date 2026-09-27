/**
 * 共现图构建。
 *
 * 规则（钉死，不可走样）：
 *  - 在每条词序列上滑动固定宽度 windowSize 的窗口（句尾不足一个窗口时按实际剩余宽度截断）；
 *  - 同一窗口内任意两个【不同】的词之间连一条无向边（不连自环）；
 *  - 同一对词多次共现（不同窗口、不同句子）时边权累加；
 *  - 所有在分词阶段幸存的词都是图节点（包括没有任何共现边的孤立节点）；
 *  - 本模块不做任何停用词判断 —— 输入的词序列必须已经过 tokenize 模块的
 *    共享过滤器处理，保证两处过滤逻辑是同一份。
 *
 * 窗口宽度调大时，窗口集合是原窗口集合的“超集化”（每个起点覆盖范围只增不减），
 * 因此图中不同边的数量随窗口宽度单调不减。
 */
import type { CooccurrenceGraphData, GraphEdge, TokenSequence } from './types';

/** 规范化无向边键：端点按字典序排列，保证 (a,b) 与 (b,a) 是同一条边。 */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}${b}` : `${b}${a}`;
}

export class CooccurrenceGraph {
  /** 词 -> 节点下标 */
  private readonly nodeIndex = new Map<string, number>();
  /** 规范化边键 -> 边（权重累加） */
  private readonly edgeMap = new Map<string, { source: string; target: string; weight: number }>();
  /** 节点下标 -> 总出边权重（无向图：与该节点相连的所有边权之和） */
  private totalWeight: number[] = [];

  addNode(word: string): void {
    if (!this.nodeIndex.has(word)) {
      this.nodeIndex.set(word, this.nodeIndex.size);
      this.totalWeight.push(0);
    }
  }

  addEdge(a: string, b: string): void {
    if (a === b) {
      return; // 不连自环
    }
    this.addNode(a);
    this.addNode(b);
    const key = edgeKey(a, b);
    const existing = this.edgeMap.get(key);
    if (existing) {
      existing.weight += 1;
    } else {
      const source = a < b ? a : b;
      const target = a < b ? b : a;
      this.edgeMap.set(key, { source, target, weight: 1 });
    }
    this.totalWeight[this.nodeIndex.get(a)!] += 1;
    this.totalWeight[this.nodeIndex.get(b)!] += 1;
  }

  get nodeCount(): number {
    return this.nodeIndex.size;
  }

  get edgeCount(): number {
    return this.edgeMap.size;
  }

  /** 冻结为只读数据：节点按字典序、边按 (source, target) 字典序输出，保证确定性。 */
  toData(): CooccurrenceGraphData {
    const nodes = [...this.nodeIndex.keys()].sort();
    const edges: GraphEdge[] = [...this.edgeMap.values()]
      .map((e) => ({ source: e.source, target: e.target, weight: e.weight }))
      .sort((x, y) => (x.source < y.source ? -1 : x.source > y.source ? 1 : x.target < y.target ? -1 : x.target > y.target ? 1 : 0));
    return { nodes, edges };
  }

  /**
   * 导出迭代打分所需的邻接结构：
   *  - nodes[i]：第 i 个节点的词
   *  - neighbors[i]：第 i 个节点的邻居列表 [{ index, weight }]
   *  - totalOutWeight[i]：第 i 个节点的总出边权重
   */
  toAdjacency(): { nodes: string[]; neighbors: { index: number; weight: number }[][]; totalOutWeight: number[] } {
    const nodes: string[] = new Array(this.nodeIndex.size);
    for (const [word, idx] of this.nodeIndex) {
      nodes[idx] = word;
    }
    const neighbors: { index: number; weight: number }[][] = nodes.map(() => []);
    for (const edge of this.edgeMap.values()) {
      const i = this.nodeIndex.get(edge.source)!;
      const j = this.nodeIndex.get(edge.target)!;
      neighbors[i].push({ index: j, weight: edge.weight });
      neighbors[j].push({ index: i, weight: edge.weight });
    }
    return { nodes, neighbors, totalOutWeight: [...this.totalWeight] };
  }
}

/**
 * 在词序列集合上构建共现图。
 * @param sentences 已过滤停用词的词序列（tokenize 模块的输出）
 * @param windowSize 滑动窗口宽度（>= 2，校验层保证）
 */
export function buildCooccurrenceGraph(
  sentences: readonly TokenSequence[],
  windowSize: number,
): CooccurrenceGraph {
  const graph = new CooccurrenceGraph();

  for (const sentence of sentences) {
    // 所有幸存的词都是节点，即使它没有任何共现边。
    for (const token of sentence) {
      graph.addNode(token);
    }
    // 滑动窗口：起点 i 处窗口覆盖 [i, i + windowSize)，句尾截断。
    for (let i = 0; i < sentence.length; i += 1) {
      const end = Math.min(i + windowSize, sentence.length);
      for (let j = i + 1; j < end; j += 1) {
        graph.addEdge(sentence[i], sentence[j]);
      }
    }
  }

  return graph;
}
