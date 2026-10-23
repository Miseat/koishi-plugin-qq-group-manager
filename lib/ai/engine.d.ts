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
import { ChatProvider, ChatResult } from './provider';
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
    readMemoryFile(): Promise<string>;
}
export interface AiDeps {
    provider?: ChatProvider;
    state?: AiState;
    rng?: () => number;
    now?: () => number;
    fetchImpl?: typeof fetch;
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
    constructor(host: AiHost, deps?: AiDeps);
    private groupKey;
    private ruleFor;
    resolveEnabled(session: any): boolean;
    private get contextWindow();
    private get selfName();
    private activePersona;
    private get personaPrompt();
    private get maxReplyChars();
    private get debugPrompt();
    /** 是否像指令（这类消息不进上下文，避免污染） */
    private isCommandLike;
    /** 记录一条群消息；返回落库后的记录（指令类返回 null） */
    record(session: any): Promise<ChatRecord | null>;
    /** 追加一条系统注记（复读等），不进计数、不触发 */
    note(text: string, groupKey?: string, session?: any): void;
    /** 机器人自己发出的消息：写回上下文，解决"说完就忘" */
    recordSelf(session: any, text: string): void;
    private isMention;
    private addressesOthers;
    private shouldContinueFollowup;
    private startFollowup;
    private bumpFollowup;
    private getFollowup;
    private loadMemories;
    handle(session: any): Promise<void>;
    /** 供外部插件（如私聊插件）复用同一个模型 provider。 */
    chat(request: any): Promise<ChatResult>;
    /** 群内长时间没人说话时，生成一条主动话题。 */
    idleTopic(groupId: string): Promise<string>;
    /** 需要时调用 DeepSeek Search API；失败/不支持/没结果都返回空串，继续普通回复。 */
    private webSearch;
    private recentImageRecords;
    private collectImages;
    private judge;
    private platformAllowed;
    private log;
    /** 供指令/调试使用 */
    displayNameFor(session: any, qq: string): Promise<string>;
    clear(): void;
}
