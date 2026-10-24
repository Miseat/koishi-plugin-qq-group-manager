/**
 * AI 会话状态：按群维护环形上下文、计数器、冷却与点名跟随。
 *
 * 与旧版的区别：
 * - 机器人自己的发言也会进入上下文（self 记录），不会"说完就忘"；
 * - 每条记录带时间、群名片、角色、引用；
 * - 计数器独立于"是否入上下文"，便于触发策略单独演进。
 */
import type { RenderedImage, RenderedQuote } from '../core/text';
export interface ChatRecord {
    id: string;
    userId: string;
    name: string;
    role?: string;
    text: string;
    images: RenderedImage[];
    quote?: RenderedQuote;
    /** 合并转发子消息的渲染文本（读不到时为空） */
    forwardText?: string;
    /** 本条消息 @ 到的 QQ 号（不含 bot 自己） */
    mentions: string[];
    /** 本条消息是否 @ 了 bot */
    atBot: boolean;
    self: boolean;
    at: number;
    /** 指令类消息：进入上下文但不参与触发/计数 */
    command?: boolean;
}
export interface FollowupState {
    userId: string;
    expiresAt: number;
    turns: number;
    anchorTokens: string[];
    lastText: string;
}
export declare class GroupState {
    records: ChatRecord[];
    /** 自上次"完整考虑"（真正调用了模型）以来累计的消息数 */
    counter: number;
    lastReplyAt: number;
    lastAttemptAt: number;
    inFlight: boolean;
    followup: FollowupState | null;
    seen: Map<string, number>;
    trim(window: number): void;
    push(record: ChatRecord, window: number): void;
    /** 事件去重：同一 messageId 15 秒内只处理一次 */
    isDuplicate(key: string, now: number): boolean;
}
export declare class AiState {
    private groups;
    get(key: string): GroupState;
    peek(key: string): GroupState | undefined;
    clear(): void;
}
