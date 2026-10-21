/**
 * 记忆检索（纯函数）。
 *
 * 旧实现用「整句 includes」匹配，中文整句几乎永远匹配不到，于是每次 fallback
 * 注入最近 6 条记忆——不管群里在聊什么，模型都会被喂"星野爱"。
 *
 * 这里改成字级 n-gram 重叠打分：只有真正和当前消息/最近两三条消息有交集的
 * 记忆才会被注入；没有交集就一条都不给。
 */

const CJK = /[\u4e00-\u9fa5]/;

/** 中文按二元组切，英文/数字按词切 */
export function tokenizeForMatch(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return tokens;

  for (const chunk of normalized.split(/\s+/)) {
    if (!chunk) continue;
    if (CJK.test(chunk)) {
      const chars = [...chunk];
      if (chars.length === 1) {
        tokens.add(chunk);
        continue;
      }
      for (let i = 0; i < chars.length - 1; i += 1) {
        tokens.add(chars[i] + chars[i + 1]);
      }
    } else if (chunk.length >= 2) {
      tokens.add(chunk);
    }
  }
  return tokens;
}

export interface MemoryBlock {
  text: string;
  /** 原始下标，用于稳定排序 */
  index: number;
}

export function splitMemoryBlocks(content: string): MemoryBlock[] {
  return String(content || '')
    .split(/\r?\n---\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text, index) => ({ text, index }));
}

export interface SelectOptions {
  limit?: number;
  /** 命中率门槛：命中 token 数 / min(查询 token 数, 24) */
  minScore?: number;
  /** 单条注入的最大字符数 */
  maxChars?: number;
}

/**
 * 选出与当前话题相关的记忆。
 * @param blocks 记忆条目
 * @param queryTexts 当前消息 + 最近几条上下文（按重要性从高到低）
 */
export function selectMemoryBlocks(
  blocks: MemoryBlock[],
  queryTexts: string[],
  options: SelectOptions = {},
): MemoryBlock[] {
  const limit = Math.max(0, options.limit ?? 3);
  const minScore = options.minScore ?? 0.12;
  const maxChars = options.maxChars ?? 160;
  if (!limit || !blocks.length) return [];

  const queryTokens = new Set<string>();
  for (const text of queryTexts) {
    for (const token of tokenizeForMatch(text)) queryTokens.add(token);
  }
  if (!queryTokens.size) return [];

  const denominator = Math.max(1, Math.min(queryTokens.size, 24));

  const scored = blocks.map((block) => {
    const tokens = tokenizeForMatch(block.text);
    let hits = 0;
    for (const token of tokens) {
      if (queryTokens.has(token)) hits += 1;
    }
    // 至少命中 2 个二元组才算相关，避免"的""了"这类碎片误命中
    const score = hits >= 2 ? hits / denominator : 0;
    return { block, hits, score };
  });

  return scored
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.block.index - b.block.index)
    .slice(0, limit)
    .map((item) => ({
      ...item.block,
      text: item.block.text.length > maxChars ? `${item.block.text.slice(0, maxChars)}…` : item.block.text,
    }));
}
