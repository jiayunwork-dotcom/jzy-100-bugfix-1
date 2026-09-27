/**
 * 共享类型定义：贯穿 分词 -> 建图 -> 迭代打分 -> 截断排序 整条流水线。
 */

/** 单条已分词、已过滤停用词的句子（词序列）。 */
export type TokenSequence = string[];

/** 共现图中的一条带权无向边。source/target 按字典序规范化存储。 */
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

/** 词共现图：节点为去重后的有效词，边为窗口内共现关系（权重可累加）。 */
export interface CooccurrenceGraphData {
  nodes: string[];
  edges: GraphEdge[];
}

/** 迭代打分的最终结果。 */
export interface RankResult {
  /** 节点 -> 收敛后的分数 */
  scores: Map<string, number>;
  /** 是否收敛（达到收敛阈值）；false 表示达到步数上限仍未收敛 */
  converged: boolean;
  /** 实际执行的迭代步数 */
  iterations: number;
}

/** 一个关键词及其分数。 */
export interface KeywordScore {
  word: string;
  score: number;
}

/** 可调参数（全部经过校验层校验后才会进入流水线）。 */
export interface ExtractionOptions {
  /** 滑动窗口宽度，整数，>= 2 */
  windowSize: number;
  /** 阻尼系数，开区间 (0, 1) */
  damping: number;
  /** 返回关键词数量上限，整数，>= 1 */
  topK: number;
  /** 迭代收敛阈值，> 0 */
  tolerance: number;
  /** 迭代步数上限，整数，>= 1 */
  maxIterations: number;
}
