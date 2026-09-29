/**
 * 迭代打分（TextRank 式，算法钉死不可走样）：
 *
 *   每个词 i 的分数按如下规则迭代更新（同步更新，即所有新分数都基于上一轮分数计算）：
 *
 *     S_new(i) = (1 - d) + d * Σ_{j ∈ N(i)} [ w(j,i) / W(j) ] * S_old(j)
 *
 *   其中：
 *     d       阻尼系数（开区间 (0,1)）
 *     N(i)    词 i 的邻居集合
 *     w(j,i)  边 (j,i) 的权重
 *     W(j)    邻居 j 的总出边权重（其所有相连边权之和）
 *
 *   即：邻居 j 把自己的分数按“边 (j,i) 权重占 j 总出边权重的比例”分配给 i。
 *
 *   初始分数全部为 1。每轮取所有词新旧分数差的最大绝对值，
 *   当该值 < 收敛阈值时判定收敛；达到步数上限仍未收敛则抛 NOT_CONVERGED，
 *   绝不把未稳定的半成品分数当正常结果返回。
 *
 *   数值安全（钉死）：任何一个词的分数一旦变成 NaN 或 ±Infinity，
 *   绝不能再标成收敛返回。注意 Math.abs(NaN) 与任何有限阈值比较都为 false，
 *   若不显式拦截，发散后的 NaN 会让 maxDelta 恒为 0、从而被误判为“已收敛”，
 *   再经 JSON 序列化成 null 流向下游。这里在迭代过程中与产出结果前各做一次
 *   Number.isFinite 守卫，命中即按未收敛处理并拒绝返回分数。
 */
import { AppError, ErrorCodes } from './errors';
import type { CooccurrenceGraph } from './graph';
import type { RankResult } from './types';

export function rankNodes(
  graph: CooccurrenceGraph,
  damping: number,
  tolerance: number,
  maxIterations: number,
): RankResult {
  const { nodes, neighbors, totalOutWeight } = graph.toAdjacency();
  const n = nodes.length;

  // 空图（没有任何有效节点）属于退化输入，由服务层在建图后拦截；
  // 这里防御性处理，直接返回空结果。
  if (n === 0) {
    return { scores: new Map(), converged: true, iterations: 0 };
  }

  let scores = new Array<number>(n).fill(1);
  let iterations = 0;
  let converged = false;

  for (let iter = 1; iter <= maxIterations; iter += 1) {
    iterations = iter;
    const next = new Array<number>(n).fill(0);
    let maxDelta = 0;

    for (let i = 0; i < n; i += 1) {
      let inbound = 0;
      for (const { index: j, weight } of neighbors[i]) {
        // totalOutWeight[j] > 0 恒成立：j 是 i 的邻居，说明 j 至少有一条边。
        inbound += (weight / totalOutWeight[j]) * scores[j];
      }
      next[i] = 1 - damping + damping * inbound;

      // 数值守卫：NaN/±Infinity 绝不允许继续迭代，更不允许被判成收敛。
      // NaN 会让后面的 delta 比较全部为 false（maxDelta 恒为 0），
      // 从而伪装成收敛，必须在这里就拦下。
      if (!Number.isFinite(next[i])) {
        throw new AppError(
          ErrorCodes.NOT_CONVERGED,
          `迭代到第 ${iter} 步时出现非有限分数（${String(next[i])}），拒绝返回被污染的分数`,
        );
      }

      const delta = Math.abs(next[i] - scores[i]);
      if (delta > maxDelta) {
        maxDelta = delta;
      }
    }

    scores = next;

    // 双保险：显式校验本轮最大分差本身是有限数（NaN 与任何阈值比较都为 false）。
    if (!Number.isFinite(maxDelta)) {
      throw new AppError(
        ErrorCodes.NOT_CONVERGED,
        `迭代到第 ${iter} 步时分差出现非有限值（${String(maxDelta)}），拒绝返回被污染的分数`,
      );
    }

    if (maxDelta < tolerance) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    throw new AppError(
      ErrorCodes.NOT_CONVERGED,
      `迭代 ${maxIterations} 步后仍未收敛（收敛阈值 ${tolerance}），拒绝返回未稳定的分数`,
    );
  }

  const scoreMap = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    // 产出前最后一道防线：任何 NaN/±Infinity 都不得以“已收敛”的正常结果返回。
    if (!Number.isFinite(scores[i])) {
      throw new AppError(
        ErrorCodes.NOT_CONVERGED,
        `收敛后词「${nodes[i]}」的分数为非有限值（${String(scores[i])}），拒绝返回被污染的分数`,
      );
    }
    scoreMap.set(nodes[i], scores[i]);
  }
  return { scores: scoreMap, converged, iterations };
}
