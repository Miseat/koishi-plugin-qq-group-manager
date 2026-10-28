/**
 * AI 回复引擎。
 *
 * 一次「收到消息」的完整流程：
 *   record()  记录到上下文（所有消息都记，包括被管控/指令之外的人话）
 *   handle()  判定是否接话 → 组装提示词 → （可选）解析图片 → 调模型
 *             → 输出正文 / <pass/> → 发送 → 把自己的回复写回上下文
 *
 * 关键取舍：
 * - 决策与生成合并为一次模型调用，避免"兴趣判定答非所问、生成又挑另一条"；
 * - 只回应当前消息，引用与回答永远一致；
 * - 允许模型用 <pass/> 主动放弃，放弃也重置计数，避免每条消息都空转调用。
 */
import { AiState, ChatRecord } from './state';
import { ChatProvider } from './provider';
import { RenderedImage } from '../core/text';
import { AiHookRegistry } from './hooks';
export interface AiHost {
    config: any;
    logger: any;
    getOneBotApi(session: any): any;
    toGroupId(session: any): number | null;
    extractImages(session: any): RenderedImage[];
    fetchQuotedImages?(session: any, quote: any): Promise<RenderedImage[]>;
    resolveImage(ref: string, session: any): Promise<string>;
    sendReply(session: any, text: string): Promise<void>;
    /** 发送系统提示（不引用、不进入 AI 上下文），用于冷却提示等 */
    sendNotice?(session: any, text: string): Promise<void>;
    /** 写入自动归纳记忆：add = 新条目；remove = 需要被压缩替换掉的旧条目 */
    commitAutoMemory?(scope: {
        kind: 'group' | 'private';
        id: string;
    } | null, payload: {
        add: string;
        remove?: string[];
        label?: string;
    }): Promise<void>;
    readMemoryFile(scope?: {
        kind: 'group' | 'private';
        id: string;
    } | null): Promise<string>;
}
export interface AiDeps {
    provider?: ChatProvider;
    state?: AiState;
    rng?: () => number;
    now?: () => number;
    fetchImpl?: typeof fetch;
    /**
     * 钩子注册表。主插件会传入进程级共享实例；不传则每次新建，
     * 保证测试/多实例之间互不串钩子。
     */
    hooks?: AiHookRegistry;
}
export declare class AiEngine {
    readonly state: AiState;
    /** 外部插件扩展点：提示词风格段 + 输出过滤 */
    readonly hooks: AiHookRegistry;
    private provider;
    private names;
    private rng;
    private now;
    private fetchImpl;
    private host;
    private config;
    private searchCache;
    private searchRate;
    private searchUnsupportedUntil;
    /** 自动归纳：按作用域累计被挤出的消息 */
    private learnStore;
    /** 自动归纳：每个作用域每天的次数，防刷额度 */
    private learnDaily;
    /** 自动归纳：空闲兜底定时器 */
    private learnTimer;
    constructor(host: AiHost, deps?: AiDeps);
    private groupKey;
    private ruleFor;
    /**
     * 读配置：该群 groupRules 里有同名非空值就用它，否则回落到全局。
     * 这样频率限制（阈值/概率/模型调用冷却）可以按群单独设置。
     */
    private setting;
    resolveEnabled(session: any): boolean;
    private get contextWindow();
    private get selfName();
    private activePersona;
    private get personaPrompt();
    private get maxReplyChars();
    private get debugPrompt();
    /**
     * 历史上下文按字数裁剪（aiContextMaxChars，0=不限）。
     * 从最新往前累加，至少保留最近 4 条，避免一刀切掉当前对话。
     */
    private clampContext;
    /** 限制外部插件注入的风格段长度（aiStyleMaxChars，0=不限） */
    private clampStyle;
    /** 是否像指令（这类消息不进上下文，避免污染） */
    private isCommandLike;
    /** 记录一条群消息；返回落库后的记录（指令类返回 null） */
    record(session: any): Promise<ChatRecord | null>;
    /** 追加一条系统注记（复读等），不进计数、不触发 */
    note(text: string, groupKey?: string, session?: any): void;
    /** 机器人自己发出的消息：写回上下文，解决"说完就忘" */
    recordSelf(session: any, text: string): void;
    /**
     * 把本次被挤出上下文的消息交给外部插件（用于自动归纳沉淀）。
     * 失败不影响主流程。
     */
    /**
     * 上下文挤出后的两件事：
     *   1. 交给外部插件（registerContextEvicted，可选）
     *   2. 内建自动归纳：累计到阈值或空闲后总结成一条记忆写回
     * 任何一步失败都不影响正常聊天。
     */
    private emitEvicted;
    /** 归纳并（可选）回推到原会话 */
    /** 启动空闲兜底定时器；每 5 分钟检查一次 */
    private startLearnTimer;
    /** 资源清理：停止定时器、清空缓存 */
    dispose(): void;
    private learnAndReport;
    /** 把一批消息归纳成一条记忆并写入对应作用域；返回写入结果或 null */
    private summarizeRecords;
    /**
     * 自动归纳写入策略（1.4.7+）：
     *   - 每累计 N 条（默认 5）就把最早的 N-1 条 + 本次新记忆压缩成 1 条；
     *   - 自动记忆总数超过上限（默认 15）时同样触发压缩；
     *   - 压缩失败时退回普通追加，不丢数据，下次归纳会再试。
     */
    private saveLearnedMemory;
    /** 调模型把若干条自动记忆压成一条更短的 */
    private consolidateMemories;
    private findBot;
    private isMention;
    private addressesOthers;
    private shouldContinueFollowup;
    private startFollowup;
    private bumpFollowup;
    private getFollowup;
    private loadMemories;
    /**
     * 被 @ 但处于模型调用冷却时，在群里提示还剩多久。
     *
     * 只发本地短句，不调用模型；同一群按 aiCooldownNoticeIntervalSeconds 限流，
     * 避免有人连续 @ 时刷屏。
     */
    private sendCooldownNotice;
    handle(session: any): Promise<void>;
    /** 供外部插件（如私聊插件）复用同一个模型 provider。 */
    chat(request: any): Promise<import("./provider").ChatResult>;
    /** 群内长时间没人说话时，生成一条主动话题。 */
    idleTopic(groupId: string): Promise<string>;
    /** 需要时调用 DeepSeek Search API；失败/不支持/没结果都返回空串，继续普通回复。 */
    private webSearch;
    /** 模型自己都说不知道/搜不了时，补一次搜索再重写；只在不认识的问题上多一次调用。 */
    private shouldReviseWithSearch;
    /** 读取合并转发的子消息，压成一行行文本；读不到就返回空串。 */
    private readForwards;
    private recentImageRecords;
    private collectImages;
    private platformAllowed;
    private log;
    /** 供指令/调试使用 */
    displayNameFor(session: any, qq: string): Promise<string>;
    clear(): void;
}
