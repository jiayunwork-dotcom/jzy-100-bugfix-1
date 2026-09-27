/**
 * 分词与停用词过滤。
 *
 * 关键约束：停用词的判断逻辑全服务只有这一份（StopwordFilter），
 * 分词结果过滤与共现图构建共用同一个过滤器实例 —— 图构建只接收
 * 本模块输出的词序列，不自行做第二套停用词判断，因此不存在
 * “分词结果里滤掉了、图里又漏进去”的不一致。
 */
import type { TokenSequence } from './types';

/** 停用词过滤器：唯一的停用词判断入口。 */
export class StopwordFilter {
  private readonly words: ReadonlySet<string>;

  constructor(stopwords: readonly string[]) {
    this.words = new Set(stopwords);
  }

  /** 判断一个词是否为停用词。分词与建图阶段共用此判断。 */
  isStopword(word: string): boolean {
    return this.words.has(word);
  }

  get size(): number {
    return this.words.size;
  }
}

/** 空白字符（JS 的 \s 已覆盖 \u00A0、\u3000、\uFEFF 等全部 Unicode 空白）。 */
const WHITESPACE_RE = /\s+/u;

/** 句子边界：中英文句读、换行、分号、冒号、引号、括号、项目符号等。 */
const SENTENCE_BOUNDARY_RE = /[。！？!?；;：:\r\n…—–\-·•「」『』“”‘’"'\(\)（）\[\]【】{}<>《》〈〉,，、|/\\~@#$%^&*_+=`]+/u;

/**
 * 规范化单个词：去掉首尾空白。返回空串表示该词应被丢弃。
 */
export function normalizeToken(raw: string): string {
  return raw.trim();
}

/**
 * 把原始文本切成句子，再把句子切成词序列。
 * 规则：按句读类标点切句，句内按空白切词。
 */
export function splitRawText(text: string): TokenSequence[] {
  const sentences = text
    .split(SENTENCE_BOUNDARY_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences.map((sentence) =>
    sentence
      .split(WHITESPACE_RE)
      .map(normalizeToken)
      .filter((token) => token.length > 0),
  );
}

/**
 * 对“已分好词”的句子做规范化（去空白、丢空词），不做停用词过滤。
 */
export function normalizeSentences(sentences: readonly (readonly string[])[]): TokenSequence[] {
  return sentences
    .map((sentence) =>
      sentence
        .map(normalizeToken)
        .filter((token) => token.length > 0),
    )
    .filter((sentence) => sentence.length > 0);
}

/**
 * 停用词过滤：对每条词序列应用共享的过滤器。
 * 过滤后为空（一个词都不剩）的句子会被整条移除。
 */
export function filterStopwords(
  sentences: readonly TokenSequence[],
  filter: StopwordFilter,
): TokenSequence[] {
  return sentences
    .map((sentence) => sentence.filter((token) => !filter.isStopword(token)))
    .filter((sentence) => sentence.length > 0);
}

/**
 * 完整的分词流水线入口：
 *   输入（原始文本 或 已分词句子） -> 规范化 -> 停用词过滤 -> 词序列集合
 * 共现图构建只消费本函数的输出。
 */
export function tokenizeDocument(
  input: { text: string } | { sentences: readonly (readonly string[])[] },
  filter: StopwordFilter,
): TokenSequence[] {
  const sentences =
    'text' in input ? splitRawText(input.text) : normalizeSentences(input.sentences);
  return filterStopwords(sentences, filter);
}
