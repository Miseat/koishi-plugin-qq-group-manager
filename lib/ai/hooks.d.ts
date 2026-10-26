/**
 * AI 扩展钩子：让外部插件给提示词追加“风格段”，并在发送前过滤输出。
 *
 * 设计目标：
 * - 只暴露最小能力，不把引擎内部结构漏出去；
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
/** 一条被挤出上下文的消息。字段与 ChatRecord 对齐，但只挑外部需要的部分。 */
export interface EvictedRecord {
    id: string;
    userId: string;
    name: string;
    role?: string;
    text: string;
    self: boolean;
    at: number;
    command?: boolean;
}
/** 上下文挤出事件：一次可能挤掉多条。 */
export interface ContextEvictedContext {
    /** 群号；私聊时为空字符串 */
    groupId: string;
    /** 会话类型 */
    kind: 'group' | 'private';
    /** 作用域 ID：群聊=群号，私聊=对方 QQ 号 */
    scopeId: string;
    session?: any;
    /** 本次被挤出的消息，按时间先后排列 */
    evicted: EvictedRecord[];
    /** 当前上下文窗口大小 */
    window: number;
}
export type ContextEvictedHandler = (ctx: ContextEvictedContext) => void | Promise<void>;
export declare class AiHookRegistry {
    private logger?;
    /** 钩子接口版本；外部插件应检查 >= 2 才能用 contextEvicted */
    readonly version = 2;
    private sections;
    private filters;
    private afterReplyHandlers;
    private evictedHandlers;
    constructor(logger?: any);
    registerPromptSection(provider: PromptSectionProvider): () => void;
    registerOutputFilter(filter: OutputFilter): () => void;
    /** 文字回复已发送后触发；用于追加表情包等后续动作。 */
    registerAfterReply(handler: AfterReplyHandler): () => void;
    /**
     * 上下文挤出消息时触发（2.0+）。
     * 用于把这些即将被丢弃的消息交给外部插件做归纳、归档等。
     */
    registerContextEvicted(handler: ContextEvictedHandler): () => void;
    /** 汇总所有风格段；单个 provider 失败只记日志，不影响其它。 */
    collectSections(ctx: AiHookContext): Promise<string[]>;
    /** 依次执行输出过滤器；返回 null 表示丢弃本条回复。 */
    applyFilters(text: string, ctx: AiHookContext): Promise<string | null>;
    /** 文字回复发送后执行；单个 handler 失败只记日志，不影响其它。 */
    runAfterReply(ctx: AiAfterReplyContext): Promise<void>;
    /** 上下文挤出后执行；单个 handler 失败只记日志，不影响其它。 */
    runContextEvicted(ctx: ContextEvictedContext): Promise<void>;
}
