/**
 * AI 扩展钩子：让外部插件给提示词追加“风格段”，并在发送前过滤输出。
 *
 * 设计目标：
 * - 只暴露两个最小能力，不把引擎内部结构漏出去；
 * - 任何钩子抛错都不能影响正常回复（记录日志后继续）；
 * - 输出过滤器返回 null 表示“这条不要发”（按 pass 处理）；
 * - version 用于外部插件做兼容检查。
 */
export interface AiHookContext {
    session: any;
    groupId: string;
    mode: 'reply' | 'judge';
}
export type PromptSectionProvider = (ctx: AiHookContext) => string | Promise<string>;
export type OutputFilter = (text: string, ctx: AiHookContext) => string | null | Promise<string | null>;
export interface AiAfterReplyContext extends AiHookContext {
    /** 已经发送并写入上下文的最终文本 */
    text: string;
}
export type AfterReplyHandler = (ctx: AiAfterReplyContext) => void | Promise<void>;
export declare class AiHookRegistry {
    private logger?;
    /** 钩子接口版本；外部插件应检查 >= 1 */
    readonly version = 1;
    private sections;
    private filters;
    private afterReplyHandlers;
    constructor(logger?: any);
    registerPromptSection(provider: PromptSectionProvider): () => void;
    registerOutputFilter(filter: OutputFilter): () => void;
    /** 文字回复已发送后触发；用于追加表情包等后续动作。 */
    registerAfterReply(handler: AfterReplyHandler): () => void;
    /** 汇总所有风格段；单个 provider 失败只记日志，不影响其它。 */
    collectSections(ctx: AiHookContext): Promise<string[]>;
    /** 依次执行输出过滤器；返回 null 表示丢弃本条回复。 */
    applyFilters(text: string, ctx: AiHookContext): Promise<string | null>;
    /** 文字回复发送后执行；单个 handler 失败只记日志，不影响其它。 */
    runAfterReply(ctx: AiAfterReplyContext): Promise<void>;
}
