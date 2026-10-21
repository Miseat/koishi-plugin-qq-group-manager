/**
 * 记忆检索（纯函数）。
 *
 * 旧实现用「整句 includes」匹配，中文整句几乎永远匹配不到，于是每次 fallback
 * 注入最近 6 条记忆——不管群里在聊什么，模型都会被喂"星野爱"。
 *
 * 这里改成字级 n-gram 重叠打分：只有真正和当前消息/最近两三条消息有交集的
 * 记忆才会被注入；没有交集就一条都不给。
 */
/** 中文按二元组切，英文/数字按词切 */
export declare function tokenizeForMatch(text: string): Set<string>;
export interface MemoryBlock {
    text: string;
    /** 原始下标，用于稳定排序 */
    index: number;
}
export declare function splitMemoryBlocks(content: string): MemoryBlock[];
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
export declare function selectMemoryBlocks(blocks: MemoryBlock[], queryTexts: string[], options?: SelectOptions): MemoryBlock[];
