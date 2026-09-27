/**
 * 结果截断与排序：
 *  - 按分数从高到低排列；
 *  - 分数相同（含浮点完全相等）时按词的原始字典序稳定排列；
 *  - 返回数量为 min(topK, 实际入图词数)。
 */
import type { KeywordScore, RankResult } from './types';

export function selectTopKeywords(rank: RankResult, topK: number): KeywordScore[] {
  const entries = [...rank.scores.entries()].map(([word, score]) => ({ word, score }));

  entries.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score; // 分数降序
    }
    // 同分按原始字典序（UTF-16 码元序）升序，保证确定性
    if (a.word < b.word) return -1;
    if (a.word > b.word) return 1;
    return 0;
  });

  return entries.slice(0, Math.min(topK, entries.length));
}
