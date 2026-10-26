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
