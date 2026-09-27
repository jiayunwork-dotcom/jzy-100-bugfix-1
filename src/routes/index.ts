/**
 * Fastify 接口层：只做 HTTP 语义（状态码、JSON 序列化），业务全部委托给 services。
 *
 * 接口：
 *   GET  /health           健康检查
 *   POST /v1/keywords      单篇文档关键词抽取
 *   POST /v1/keywords/batch 批量关键词抽取（逐篇独立，互不影响）
 *   POST /v1/graph         只做分词 + 建图，返回共现图结构（不跑迭代打分）
 *   POST /v1/graph/batch   批量建图检查
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { AppError, toErrorBody } from '../core/errors';
import { extractKeywordsBatch, inspectGraphBatch } from '../services/batchService';
import { extractKeywords, inspectGraph } from '../services/keywordService';
import { parseBatchRequest, parseDocumentRequest } from '../services/validation';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
    // 请求体大小上限，防止超大文档打爆内存
    bodyLimit: 5 * 1024 * 1024,
  });

  // 统一错误处理：AppError -> 对应状态码 + 错误 JSON；其余 -> 500。
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send(toErrorBody(err));
      return;
    }
    // Fastify 自身的请求解析错误（如 JSON 语法错误、body 超限）
    const statusCode = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    reply.status(statusCode).send({
      error: {
        code: statusCode === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message: err.message,
      },
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/v1/keywords', async (request, reply) => {
    const req = parseDocumentRequest(request.body);
    const result = extractKeywords(req);
    reply.status(200).send(result);
  });

  app.post('/v1/keywords/batch', async (request, reply) => {
    const bodies = parseBatchRequest(request.body);
    const results = extractKeywordsBatch(bodies);
    reply.status(200).send({ results });
  });

  app.post('/v1/graph', async (request, reply) => {
    const req = parseDocumentRequest(request.body);
    const result = inspectGraph(req);
    reply.status(200).send(result);
  });

  app.post('/v1/graph/batch', async (request, reply) => {
    const bodies = parseBatchRequest(request.body);
    const results = inspectGraphBatch(bodies);
    reply.status(200).send({ results });
  });

  return app;
}
