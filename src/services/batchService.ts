/**
 * 批量调度：逐篇独立解析、独立建图、独立迭代。
 * 某一篇失败（校验错误或算法错误）只影响它自己的结果项，
 * 不影响同批其它篇正常出结果；返回顺序与提交顺序一一对应。
 */
import { AppError } from '../core/errors';
import type { GraphInspectionResult, KeywordExtractionResult } from './keywordService';
import { extractKeywords, inspectGraph } from './keywordService';
import { parseDocumentRequest } from './validation';

export interface BatchItemSuccess<T> {
  ok: true;
  result: T;
}

export interface BatchItemFailure {
  ok: false;
  error: { code: string; message: string; field?: string };
}

export type BatchItem<T> = BatchItemSuccess<T> | BatchItemFailure;

function runSafely<T>(body: unknown, handler: (req: ReturnType<typeof parseDocumentRequest>) => T): BatchItem<T> {
  try {
    const req = parseDocumentRequest(body);
    return { ok: true, result: handler(req) };
  } catch (err) {
    if (err instanceof AppError) {
      const error: { code: string; message: string; field?: string } = {
        code: err.code,
        message: err.message,
      };
      if (err.field !== undefined) {
        error.field = err.field;
      }
      return { ok: false, error };
    }
    throw err; // 非预期错误继续上抛，由全局错误处理器兜底
  }
}

/** 批量关键词抽取。 */
export function extractKeywordsBatch(bodies: readonly unknown[]): BatchItem<KeywordExtractionResult>[] {
  return bodies.map((body) => runSafely(body, extractKeywords));
}

/** 批量建图检查。 */
export function inspectGraphBatch(bodies: readonly unknown[]): BatchItem<GraphInspectionResult>[] {
  return bodies.map((body) => runSafely(body, inspectGraph));
}
