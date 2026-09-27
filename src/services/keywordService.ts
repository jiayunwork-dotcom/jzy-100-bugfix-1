/**
 * 关键词抽取主流程：分词过滤 -> 建图 -> 迭代打分 -> 截断排序。
 * 纯函数式编排，不落库、不维护跨请求状态。
 */
import { AppError, ErrorCodes } from '../core/errors';
import { buildCooccurrenceGraph } from '../core/graph';
import { rankNodes } from '../core/rank';
import { selectTopKeywords } from '../core/select';
import { StopwordFilter, tokenizeDocument } from '../core/tokenize';
import type { CooccurrenceGraphData, KeywordScore, TokenSequence } from '../core/types';
import type { ParsedDocumentRequest } from './validation';

export interface KeywordExtractionResult {
  keywords: KeywordScore[];
  nodeCount: number;
  edgeCount: number;
  converged: boolean;
  iterations: number;
}

export interface GraphInspectionResult {
  graph: CooccurrenceGraphData;
  tokenizedSentences: TokenSequence[];
  nodeCount: number;
  edgeCount: number;
}

/**
 * 分词 + 停用词过滤 + 建图（两个接口共用的一半流水线）。
 * 过滤后一个词都不剩时抛 NO_TOKENS_AFTER_FILTER。
 */
function buildGraphFromRequest(req: ParsedDocumentRequest) {
  const filter = new StopwordFilter(req.stopwords);
  const sentences = tokenizeDocument(req.document, filter);

  const totalTokens = sentences.reduce((sum, s) => sum + s.length, 0);
  if (totalTokens === 0) {
    throw new AppError(
      ErrorCodes.NO_TOKENS_AFTER_FILTER,
      '文档分词并过滤停用词后没有任何有效词，无法构建共现图',
      'document',
    );
  }

  const graph = buildCooccurrenceGraph(sentences, req.options.windowSize);
  return { sentences, graph };
}

/** 完整抽取流程：返回排好序、截断后的关键词及分数。 */
export function extractKeywords(req: ParsedDocumentRequest): KeywordExtractionResult {
  const { graph } = buildGraphFromRequest(req);
  const { topK, damping, tolerance, maxIterations } = req.options;

  const rank = rankNodes(graph, damping, tolerance, maxIterations);
  const keywords = selectTopKeywords(rank, topK);

  return {
    keywords,
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    converged: rank.converged,
    iterations: rank.iterations,
  };
}

/** 只做分词与建图，把共现图结构吐给调用方检查，不跑迭代打分。 */
export function inspectGraph(req: ParsedDocumentRequest): GraphInspectionResult {
  const { sentences, graph } = buildGraphFromRequest(req);
  const data = graph.toData();
  return {
    graph: data,
    tokenizedSentences: sentences,
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
  };
}
