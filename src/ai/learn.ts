/**
 * 记忆自动归纳（纯函数 + 轻量状态）。
 *
 * 触发时机由 engine 在上下文挤出时调用：
 *   - 累计条数达到「上下文窗口 × 倍率」
 *   - 或距最后一条消息超过 idleHours 且期间有新消息（由 idle 定时器驱动）
 *
 * 归纳出来的内容是一次性的一长串，150 字以内，写入对应作用域的记忆文件。
 */

import { truncate } from '../core/text';

export const MAX_SUMMARY_CHARS = 150;

export interface EvictedLike {
  id?: string;
  userId?: string;
  name?: string;
  text?: string;
  self?: boolean;
  at?: number;
  command?: boolean;
}

/** 正在累计的一批消息 */
export class LearnBucket {
  records: EvictedLike[] = [];
  lastActivityAt = 0;
  lastLearnedAt = 0;

  push(records: EvictedLike[], threshold: number, now: number): boolean {
    if (!records || !records.length) return false;
    this.records.push(...records);
    this.lastActivityAt = now;
    return this.records.length >= Math.max(1, threshold);
  }

  /** 距最后一条消息超过 idleMs，且确实有内容 */
  isIdle(now: number, idleMs: number): boolean {
    if (!this.records.length) return false;
    if (!this.lastActivityAt) return false;
    return now - this.lastActivityAt >= idleMs;
  }

  drain(): EvictedLike[] {
    const out = this.records;
    this.records = [];
    return out;
  }

  get size(): number {
    return this.records.length;
  }
}

/** 按作用域保存累计桶 */
export class LearnStore {
  private map = new Map<string, LearnBucket>();

  private key(kind: string, scopeId: string): string {
    return `${kind}:${scopeId}`;
  }

  get(kind: string, scopeId: string): LearnBucket {
    const k = this.key(kind, scopeId);
    let bucket = this.map.get(k);
    if (!bucket) {
      bucket = new LearnBucket();
      this.map.set(k, bucket);
    }
    return bucket;
  }

  idleList(now: number, idleMs: number): Array<{ kind: string; scopeId: string; bucket: LearnBucket }> {
    const out: Array<{ kind: string; scopeId: string; bucket: LearnBucket }> = [];
    for (const [k, bucket] of this.map) {
      if (!bucket.size) continue;
      if (!bucket.isIdle(now, idleMs)) continue;
      const idx = k.indexOf(':');
      out.push({ kind: k.slice(0, idx), scopeId: k.slice(idx + 1), bucket });
    }
    return out;
  }

  clear(): void {
    this.map.clear();
  }
}

/** 把一批消息渲染成模型可读的文本 */
export function renderForSummary(records: EvictedLike[], selfName = 'bot'): string {
  const lines: string[] = [];
  for (const item of records) {
    if (!item || item.command) continue;
    const text = String(item.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const who = item.self ? selfName : String(item.name || item.userId || '某人');
    lines.push(`${who}: ${truncate(text, 160)}`);
  }
  return lines.join('\n');
}

/** 归纳提示词 */
export function buildSummaryPrompt(
  records: EvictedLike[],
  options: { kind?: string; selfName?: string } = {},
): { system: string; user: string } {
  const label = options.kind === 'private' ? '私聊' : '群聊';
  const body = renderForSummary(records, options.selfName || 'bot');
  const system = [
    `你在整理一段${label}记录，从中提炼值得长期记住的信息。`,
    '',
    '只保留这几类：',
    '1. 人物关系与称呼（谁是谁、怎么叫、什么身份）',
    '2. 稳定的偏好、立场、习惯（不是一时的情绪）',
    '3. 群内或两人之间约定俗成的说法、黑话',
    '4. 反复出现、以后还会聊到的话题',
    '',
    '必须丢掉：寒暄、打招呼、一次性的抱怨或玩笑、已经结束的接梗、纯表情。',
    '',
    '输出要求：',
    '- 只输出一条记忆，纯文本，不要标题、不要列表、不要编号、不要 Markdown；',
    `- 不超过 ${MAX_SUMMARY_CHARS} 字；`,
    '- 用陈述句写事实，不要写「他们聊到」「讨论了」这类过程描述；',
    '- 如果没有任何值得长期记住的内容，只输出一个词：NONE',
  ].join('\n');

  const user = ['【记录】', body || '（空）', '', '现在输出那一条记忆，或输出 NONE。'].join('\n');
  return { system, user };
}

/** 清洗模型输出 */
export function cleanSummary(raw: string, maxChars = MAX_SUMMARY_CHARS): string {
  let text = String(raw || '').trim();
  if (!text) return '';
  text = text
    .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '')
    .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '')
    .trim();

  text = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+·]|\d+[.)、])\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/^(?:none|无|没有|n\/a)$/i.test(text)) return '';

  const limit = Math.max(20, maxChars);
  if (text.length > limit) {
    const slice = text.slice(0, limit);
    let cut = -1;
    for (const ch of ['。', '！', '？', '；']) {
      cut = Math.max(cut, slice.lastIndexOf(ch));
    }
    text = cut >= Math.floor(limit * 0.5) ? slice.slice(0, cut + 1) : `${slice}…`;
  }
  return text.trim();
}

const CJK = /[\u4e00-\u9fa5]/;

function tokenize(text: string): Set<string> {
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
      for (let i = 0; i < chars.length - 1; i += 1) tokens.add(chars[i] + chars[i + 1]);
    } else if (chunk.length >= 2) {
      tokens.add(chunk);
    }
  }
  return tokens;
}

/** Jaccard 相似度，用于挡住重复记忆 */
export function similarityOf(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

/** 判断是否与已有记忆重复 */
export function isDuplicate(candidate: string, existing: string[], threshold = 0.55): boolean {
  const text = String(candidate || '').trim();
  if (!text) return false;
  for (const item of existing || []) {
    if (similarityOf(text, String(item || '')) >= threshold) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 记忆压缩

/** 自动归纳条目的标题标记（写进 Markdown 块首行） */
export const AUTO_MEMORY_LABEL = '自动归纳';

/** 自动归纳块首行形如 `## 2026/10/28 12:00:00 · 自动归纳` */
export function isAutoMemoryBlock(block: string): boolean {
  const first = String(block || '').split('\n', 1)[0] || '';
  return /·\s*自动归纳/.test(first);
}

/** 取记忆块正文（去掉 `## 时间 · 来源` 标题行） */
export function memoryBlockBody(block: string): string {
  const lines = String(block || '').split('\n');
  if (lines.length <= 1) return String(block || '').trim();
  return lines.slice(1).join('\n').trim();
}

/**
 * 记忆压缩提示词：把 N 条自动归纳合并成一条更短的。
 *
 * 目的不是“再总结一遍”，而是去掉重复与过时信息——群里连续几天聊同一件事时，
 * 自动归纳会反复产出高度相似的条目，压缩后只保留事实差异。
 */
export function buildConsolidatePrompt(
  blocks: string[],
  options: { maxChars?: number; kind?: string } = {},
): { system: string; user: string } {
  const maxChars = Math.max(40, Number(options.maxChars) || 90);
  const label = options.kind === 'private' ? '私聊' : '群聊';
  const bodies = (blocks || [])
    .map((block) => memoryBlockBody(block).replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const system = [
    `你在压缩一段${label}的长期记忆。`,
    `下面有 ${bodies.length} 条已经归纳过的记忆，请合并成一条。`,
    '',
    '要求：',
    '- 只保留互不重复的事实：人物与称呼、关系、稳定偏好、反复出现的话题；',
    '- 删掉重复表述、一次性情绪、已经过时的细节；',
    '- 不要编造，不要写“他们聊到”“讨论了”这类过程描述；',
    `- 只输出一条纯文本，不超过 ${maxChars} 字，不要标题、编号、列表、Markdown；`,
    '- 如果这些记忆里没有任何值得保留的内容，只输出一个词：NONE',
  ].join('\n');

  const user = [
    '【待压缩的记忆】',
    ...bodies.map((text, index) => `${index + 1}. ${text}`),
    '',
    '现在输出合并后的那一条记忆，或输出 NONE。',
  ].join('\n');

  return { system, user };
}
