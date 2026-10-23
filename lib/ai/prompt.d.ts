/**
 * 提示词组装（纯函数）。
 *
 * 设计要点（对应旧版的四个病灶）：
 * - 上下文严格按时间顺序，不按关键词重排，不出现"不要回复最后一条"；
 * - 明确「只回应当前消息」，引用与回答永远指向同一条；
 * - 机器人自己的历史发言以「你」出现，前后文能接上；
 * - 记忆只在检索命中时注入，并且明确允许忽略；
 * - 非点名场景允许模型输出 <pass/> 放弃接话（决策与生成合一，不再两次调用）。
 */
import type { ChatRecord } from './state';
export interface PromptInput {
    selfName: string;
    persona: string;
    groupId: string;
    records: ChatRecord[];
    current: ChatRecord;
    mention: boolean;
    followup: boolean;
    allowPass: boolean;
    memories: string[];
    maxReplyChars: number;
    /** 外部插件追加的“说话风格”段（只影响表达方式） */
    styleSections?: string[];
    /** 主插件联网搜索注入的事实段 */
    webSearch?: string;
}
export declare const PASS_TOKEN = "<pass/>";
export declare function renderRecordLine(record: ChatRecord, selfName: string): string;
export declare function buildSystemPrompt(input: PromptInput): string;
export declare function buildUserPrompt(input: PromptInput): string;
export declare function buildReplyPrompt(input: PromptInput): {
    system: string;
    user: string;
};
/** 两段式模式下的判定提示词（只有显式配置 aiReplyDecision=two-stage 才会用） */
export declare function buildJudgePrompt(input: PromptInput): {
    system: string;
    user: string;
};
