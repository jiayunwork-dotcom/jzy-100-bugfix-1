/**
 * 输入校验层。
 *
 * 所有参数校验都在进入图构建之前完成；任何一项不合法都抛出带具体原因的
 * AppError，由路由层序列化为错误 JSON 返回，非法参数不可能混进图构建阶段。
 */
import { AppError, ErrorCodes } from '../core/errors';
import type { ExtractionOptions } from '../core/types';

/** 默认参数值。 */
export const DEFAULTS: ExtractionOptions = {
  windowSize: 2,
  damping: 0.85,
  topK: 10,
  tolerance: 1e-6,
  maxIterations: 200,
};

/** 单篇文档的输入：已分好词的句子数组，或原始文本。 */
export interface DocumentInput {
  sentences?: string[][];
  text?: string;
}

export interface ParsedDocumentRequest {
  document: { sentences: string[][] } | { text: string };
  stopwords: string[];
  options: ExtractionOptions;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failInvalid(field: string, code: keyof typeof ErrorCodes, reason: string): never {
  throw new AppError(ErrorCodes[code], `${field}: ${reason}`, field);
}

/** 校验并解析停用词表（可选，默认空表）。 */
export function parseStopwords(body: Record<string, unknown>): string[] {
  const raw = body.stopwords;
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    failInvalid('stopwords', 'INVALID_REQUEST', '必须是字符串数组');
  }
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      failInvalid('stopwords', 'INVALID_REQUEST', '数组元素必须都是字符串');
    }
    const word = item.trim();
    if (word.length > 0) {
      result.push(word);
    }
  }
  return result;
}

/** 校验并解析可调参数，缺省项使用默认值。 */
export function parseOptions(body: Record<string, unknown>): ExtractionOptions {
  const opts: ExtractionOptions = { ...DEFAULTS };

  if (body.windowSize !== undefined) {
    const v = body.windowSize;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 2) {
      failInvalid('windowSize', 'INVALID_WINDOW_SIZE', `必须是 >= 2 的整数，收到 ${JSON.stringify(v)}`);
    }
    opts.windowSize = v;
  }

  if (body.damping !== undefined) {
    const v = body.damping;
    if (typeof v !== 'number' || Number.isNaN(v) || v <= 0 || v >= 1) {
      failInvalid('damping', 'INVALID_DAMPING', `必须落在开区间 (0, 1)，收到 ${JSON.stringify(v)}`);
    }
    opts.damping = v;
  }

  if (body.topK !== undefined) {
    const v = body.topK;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      failInvalid('topK', 'INVALID_TOP_K', `必须是 >= 1 的整数，收到 ${JSON.stringify(v)}`);
    }
    opts.topK = v;
  }

  if (body.tolerance !== undefined) {
    const v = body.tolerance;
    if (typeof v !== 'number' || Number.isNaN(v) || !(v > 0)) {
      failInvalid('tolerance', 'INVALID_TOLERANCE', `必须是 > 0 的数，收到 ${JSON.stringify(v)}`);
    }
    opts.tolerance = v;
  }

  if (body.maxIterations !== undefined) {
    const v = body.maxIterations;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      failInvalid('maxIterations', 'INVALID_MAX_ITERATIONS', `必须是 >= 1 的整数，收到 ${JSON.stringify(v)}`);
    }
    opts.maxIterations = v;
  }

  return opts;
}

/**
 * 校验并解析文档内容。
 * 接受两种形态（二选一，同时提供时优先 sentences）：
 *  - document.sentences: string[][]  已分好词的句子（每个词是数组元素）
 *  - document.text: string           原始文本（服务内部切句、切词）
 *
 * 内容为空（EMPTY_CONTENT）与“过滤后一个词都不剩”（NO_TOKENS_AFTER_FILTER）
 * 是两种不同的错误，后者在服务层建图前判定。
 */
export function parseDocument(body: Record<string, unknown>): { sentences: string[][] } | { text: string } {
  const doc = body.document;
  // 缺字段 / null：提交的内容本身是空的 -> EMPTY_CONTENT
  if (doc === undefined || doc === null) {
    throw new AppError(
      ErrorCodes.EMPTY_CONTENT,
      'document: 提交的文档内容为空（缺少 sentences 或 text 字段）',
      'document',
    );
  }
  // 字段存在但类型不对：这是格式问题 -> INVALID_REQUEST
  if (!isPlainObject(doc)) {
    failInvalid('document', 'INVALID_REQUEST', '必须是对象，包含 sentences 或 text 字段');
  }

  const hasSentences = doc.sentences !== undefined && doc.sentences !== null;
  const hasText = doc.text !== undefined && doc.text !== null;

  if (!hasSentences && !hasText) {
    throw new AppError(
      ErrorCodes.EMPTY_CONTENT,
      'document: 提交的文档内容为空（缺少 sentences 或 text 字段）',
      'document',
    );
  }

  if (hasSentences) {
    const raw = doc.sentences;
    if (!Array.isArray(raw)) {
      failInvalid('document.sentences', 'INVALID_REQUEST', '必须是字符串数组的数组');
    }
    if (raw.length === 0) {
      throw new AppError(ErrorCodes.EMPTY_CONTENT, 'document.sentences: 提交的文档内容为空（空数组）', 'document.sentences');
    }
    const sentences: string[][] = [];
    let nonEmptyTokens = 0;
    for (const sentence of raw) {
      if (!Array.isArray(sentence)) {
        failInvalid('document.sentences', 'INVALID_REQUEST', '每个句子必须是字符串数组');
      }
      const tokens: string[] = [];
      for (const token of sentence) {
        if (typeof token !== 'string') {
          failInvalid('document.sentences', 'INVALID_REQUEST', '句子中的词必须都是字符串');
        }
        tokens.push(token);
        if (token.trim().length > 0) {
          nonEmptyTokens += 1;
        }
      }
      sentences.push(tokens);
    }
    if (nonEmptyTokens === 0) {
      throw new AppError(
        ErrorCodes.EMPTY_CONTENT,
        'document.sentences: 提交的文档内容为空（所有句子都没有有效词）',
        'document.sentences',
      );
    }
    return { sentences };
  }

  const raw = doc.text;
  if (typeof raw !== 'string') {
    failInvalid('document.text', 'INVALID_REQUEST', '必须是字符串');
  }
  if (raw.trim().length === 0) {
    throw new AppError(ErrorCodes.EMPTY_CONTENT, 'document.text: 提交的文档内容为空（空白文本）', 'document.text');
  }
  return { text: raw };
}

/** 校验单篇文档的完整请求体。 */
export function parseDocumentRequest(body: unknown): ParsedDocumentRequest {
  if (!isPlainObject(body)) {
    throw new AppError(ErrorCodes.INVALID_REQUEST, '请求体必须是 JSON 对象');
  }
  const document = parseDocument(body);
  const stopwords = parseStopwords(body);
  const options = parseOptions(body);
  return { document, stopwords, options };
}

/** 校验批量请求体，返回逐篇独立的请求对象列表。 */
export function parseBatchRequest(body: unknown): Record<string, unknown>[] {
  if (!isPlainObject(body)) {
    throw new AppError(ErrorCodes.INVALID_REQUEST, '请求体必须是 JSON 对象');
  }
  const docs = body.documents;
  if (!Array.isArray(docs)) {
    failInvalid('documents', 'INVALID_REQUEST', '必须是数组，每个元素是一篇文档请求');
  }
  if (docs.length === 0) {
    throw new AppError(ErrorCodes.EMPTY_CONTENT, 'documents: 提交的批量内容为空（空数组）', 'documents');
  }
  for (const item of docs) {
    if (!isPlainObject(item)) {
      failInvalid('documents', 'INVALID_REQUEST', '数组元素必须是 JSON 对象');
    }
  }
  return docs as Record<string, unknown>[];
}
