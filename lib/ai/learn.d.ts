/**
 * 记忆自动归纳（纯函数 + 轻量状态）。
 *
 * 触发时机由 engine 在上下文挤出时调用：
 *   - 累计条数达到「上下文窗口 × 倍率」
 *   - 或距最后一条消息超过 idleHours 且期间有新消息（由 idle 定时器驱动）
 *
 * 归纳出来的内容是一次性的一长串，150 字以内，写入对应作用域的记忆文件。
 */
export declare const MAX_SUMMARY_CHARS = 150;
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
export declare class LearnBucket {
    records: EvictedLike[];
    lastActivityAt: number;
    lastLearnedAt: number;
    push(records: EvictedLike[], threshold: number, now: number): boolean;
    /** 距最后一条消息超过 idleMs，且确实有内容 */
    isIdle(now: number, idleMs: number): boolean;
    drain(): EvictedLike[];
    get size(): number;
}
/** 按作用域保存累计桶 */
export declare class LearnStore {
    private map;
    private key;
    get(kind: string, scopeId: string): LearnBucket;
    idleList(now: number, idleMs: number): Array<{
        kind: string;
        scopeId: string;
        bucket: LearnBucket;
    }>;
    /** 持久化用：遍历所有待归纳桶 */
    entries(): Array<{
        kind: string;
        scopeId: string;
        bucket: LearnBucket;
    }>;
    /** 持久化用：恢复一个待归纳桶 */
    set(kind: string, scopeId: string, bucket: LearnBucket): void;
    clear(): void;
}
/** 把一批消息渲染成模型可读的文本 */
export declare function renderForSummary(records: EvictedLike[], selfName?: string): string;
/** 归纳提示词 */
export declare function buildSummaryPrompt(records: EvictedLike[], options?: {
    kind?: string;
    selfName?: string;
}): {
    system: string;
    user: string;
};
/** 清洗模型输出 */
export declare function cleanSummary(raw: string, maxChars?: number): string;
/** Jaccard 相似度，用于挡住重复记忆 */
export declare function similarityOf(a: string, b: string): number;
/** 判断是否与已有记忆重复 */
export declare function isDuplicate(candidate: string, existing: string[], threshold?: number): boolean;
/** 自动归纳条目的标题标记（写进 Markdown 块首行） */
export declare const AUTO_MEMORY_LABEL = "\u81EA\u52A8\u5F52\u7EB3";
/** 自动归纳块首行形如 `## 2026/10/28 12:00:00 · 自动归纳` */
export declare function isAutoMemoryBlock(block: string): boolean;
/** 取记忆块正文（去掉 `## 时间 · 来源` 标题行） */
export declare function memoryBlockBody(block: string): string;
/**
 * 记忆压缩提示词：把 N 条自动归纳合并成一条更短的。
 *
 * 目的不是“再总结一遍”，而是去掉重复与过时信息——群里连续几天聊同一件事时，
 * 自动归纳会反复产出高度相似的条目，压缩后只保留事实差异。
 */
export declare function buildConsolidatePrompt(blocks: string[], options?: {
    maxChars?: number;
    kind?: string;
}): {
    system: string;
    user: string;
};
