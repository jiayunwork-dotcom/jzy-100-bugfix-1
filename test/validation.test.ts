/**
 * 输入校验层测试：所有非法参数在校验层被拦截并带具体原因，
 * 区分 EMPTY_CONTENT（内容/格式问题）与 NO_TOKENS_AFTER_FILTER（过滤后为空）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/core/errors';
import { extractKeywords, inspectGraph } from '../src/services/keywordService';
import { DEFAULTS, parseDocumentRequest, parseOptions } from '../src/services/validation';

function expectAppError(fn: () => unknown, code: string, field?: string) {
  assert.throws(fn, (err: unknown) => {
    // 注意：这里是 assert.throws 的判定回调，只能返回布尔值，
    // 内部再抛 assert 会被报告成“缺少异常”。
    if (!(err instanceof AppError)) return false;
    if (err.code !== code) return false;
    if (field !== undefined && err.field !== field) return false;
    return err.message.length > 0; // 错误原因必须非空
  });
}

test('缺省参数采用默认值', () => {
  const req = parseDocumentRequest({ document: { sentences: [['a', 'b']] } });
  assert.deepEqual(req.options, DEFAULTS);
});

test('windowSize 必须是 >= 2 的整数', () => {
  for (const v of [1, 0, -2, 1.5, '2', null, true]) {
    expectAppError(() => parseOptions({ windowSize: v }), 'INVALID_WINDOW_SIZE', 'windowSize');
  }
});

test('damping 必须落在开区间 (0,1)：0 和 1 都不合法', () => {
  for (const v of [0, 1, -0.1, 1.0001, NaN, '0.5']) {
    expectAppError(() => parseOptions({ damping: v }), 'INVALID_DAMPING', 'damping');
  }
});

test('topK 必须是 >= 1 的整数', () => {
  for (const v of [0, -1, 1.2, '3']) {
    expectAppError(() => parseOptions({ topK: v }), 'INVALID_TOP_K', 'topK');
  }
});

test('tolerance / maxIterations 的边界校验', () => {
  for (const v of [0, -1e-9, NaN]) {
    expectAppError(() => parseOptions({ tolerance: v }), 'INVALID_TOLERANCE', 'tolerance');
  }
  for (const v of [0, -5, 1.5]) {
    expectAppError(() => parseOptions({ maxIterations: v }), 'INVALID_MAX_ITERATIONS', 'maxIterations');
  }
});

test('合法边界值可以通过校验', () => {
  assert.equal(parseOptions({ windowSize: 2, damping: 0.0001, topK: 1, tolerance: 1e-15, maxIterations: 1 }).windowSize, 2);
  assert.equal(parseOptions({ damping: 0.999999 }).damping, 0.999999);
});

test('空内容（缺字段 / 空数组 / 空白文本）报 EMPTY_CONTENT', () => {
  expectAppError(() => parseDocumentRequest({}), 'EMPTY_CONTENT', 'document');
  expectAppError(() => parseDocumentRequest({ document: {} }), 'EMPTY_CONTENT', 'document');
  expectAppError(() => parseDocumentRequest({ document: { sentences: [] } }), 'EMPTY_CONTENT', 'document.sentences');
  expectAppError(() => parseDocumentRequest({ document: { sentences: [[]] } }), 'EMPTY_CONTENT', 'document.sentences');
  expectAppError(() => parseDocumentRequest({ document: { sentences: [['  ']] } }), 'EMPTY_CONTENT', 'document.sentences');
  expectAppError(() => parseDocumentRequest({ document: { text: '   ' } }), 'EMPTY_CONTENT', 'document.text');
});

test('格式错误（字段类型不对）报 INVALID_REQUEST', () => {
  expectAppError(() => parseDocumentRequest('nope'), 'INVALID_REQUEST');
  expectAppError(() => parseDocumentRequest({ document: 'nope' }), 'INVALID_REQUEST', 'document');
  expectAppError(() => parseDocumentRequest({ document: { sentences: 'nope' } }), 'INVALID_REQUEST');
  expectAppError(() => parseDocumentRequest({ document: { sentences: ['nope'] } }), 'INVALID_REQUEST');
  expectAppError(() => parseDocumentRequest({ document: { sentences: [[1, 2]] } }), 'INVALID_REQUEST');
  expectAppError(() => parseDocumentRequest({ document: { text: 1 } }), 'INVALID_REQUEST');
  expectAppError(
    () => parseDocumentRequest({ document: { sentences: [['a']] }, stopwords: ['x', 3] }),
    'INVALID_REQUEST',
  );
});

test('非空但全是停用词 -> NO_TOKENS_AFTER_FILTER（与 EMPTY_CONTENT 区分开）', () => {
  expectAppError(
    () =>
      extractKeywords(
        parseDocumentRequest({ document: { sentences: [['的', '了']] }, stopwords: ['的', '了'] }),
      ),
    'NO_TOKENS_AFTER_FILTER',
  );
  expectAppError(
    () =>
      inspectGraph(
        parseDocumentRequest({ document: { text: '的 了 吗' }, stopwords: ['的', '了', '吗'] }),
      ),
    'NO_TOKENS_AFTER_FILTER',
  );
});
