/**
 * 统一错误类型与错误码。
 *
 * 错误码约定：
 *  - INVALID_REQUEST          请求体不是合法 JSON 对象 / 字段类型不对（格式问题）
 *  - EMPTY_CONTENT            提交的文档内容为空（内容问题：没有可处理的输入）
 *  - NO_TOKENS_AFTER_FILTER   分词 + 停用词过滤后一个词都不剩（内容问题：退化输入）
 *  - INVALID_WINDOW_SIZE      窗口宽度不是 >= 2 的整数
 *  - INVALID_DAMPING          阻尼系数不在开区间 (0, 1)
 *  - INVALID_TOP_K            返回词数上限不是 >= 1 的整数
 *  - INVALID_TOLERANCE        收敛阈值不是 > 0 的数
 *  - INVALID_MAX_ITERATIONS   迭代步数上限不是 >= 1 的整数
 *  - NOT_CONVERGED            达到迭代步数上限仍未收敛（不允许返回半成品分数）
 */
export const ErrorCodes = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  EMPTY_CONTENT: 'EMPTY_CONTENT',
  NO_TOKENS_AFTER_FILTER: 'NO_TOKENS_AFTER_FILTER',
  INVALID_WINDOW_SIZE: 'INVALID_WINDOW_SIZE',
  INVALID_DAMPING: 'INVALID_DAMPING',
  INVALID_TOP_K: 'INVALID_TOP_K',
  INVALID_TOLERANCE: 'INVALID_TOLERANCE',
  INVALID_MAX_ITERATIONS: 'INVALID_MAX_ITERATIONS',
  NOT_CONVERGED: 'NOT_CONVERGED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** 各错误码对应的 HTTP 状态码。 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  EMPTY_CONTENT: 400,
  NO_TOKENS_AFTER_FILTER: 422,
  INVALID_WINDOW_SIZE: 400,
  INVALID_DAMPING: 400,
  INVALID_TOP_K: 400,
  INVALID_TOLERANCE: 400,
  INVALID_MAX_ITERATIONS: 400,
  NOT_CONVERGED: 422,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** 出问题的字段名（若有），便于调用方定位。 */
  readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.field = field;
  }
}

/** 序列化为错误 JSON 响应体。 */
export function toErrorBody(err: AppError): { error: { code: ErrorCode; message: string; field?: string } } {
  const error: { code: ErrorCode; message: string; field?: string } = {
    code: err.code,
    message: err.message,
  };
  if (err.field !== undefined) {
    error.field = err.field;
  }
  return { error };
}
