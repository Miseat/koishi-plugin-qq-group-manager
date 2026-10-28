/**
 * 模型调用层：OpenAI 兼容接口 与 Gemini 原生接口。
 *
 * 与旧实现的区别：
 * - 统一一次请求接口，支持 system/user 分开；
 * - 带图片时如果服务端返回 4xx（多数是模型不支持图片），自动降级为纯文本重试一次；
 * - 输出统一清洗（去代码块 / 去前后空白），不在这里做长度截断。
 */
export interface ChatRequest {
    system: string;
    user: string;
    images?: string[];
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    /** 覆盖默认 aiModel（例如自动归纳用更便宜的模型） */
    model?: string;
}
export interface ChatResult {
    ok: boolean;
    text?: string;
    error?: string;
    status?: number;
    /** 是否因为图片被拒而发生了降级重试 */
    degradedToText?: boolean;
    /** 服务端 token 用量（OpenAI: usage；Gemini: usageMetadata） */
    usage?: any;
    /** 停止原因：length 表示被 max_tokens / 上下文上限截断 */
    finishReason?: string;
}
export interface ProviderConfig {
    aiProvider?: string;
    aiApiKey?: string;
    aiBaseUrl?: string;
    aiModel?: string;
    aiTemperature?: number;
    aiMaxOutputTokens?: number;
    aiRequestTimeoutSeconds?: number;
}
export declare class ChatProvider {
    private config;
    private logger?;
    /** 一旦确认当前模型不支持图片，后续直接跳过图片，避免每次都白跑一次 400 */
    private visionUnsupported;
    /** 推理模型如果在小预算下被截断，记住一个更大的下限，后续不再重复踩坑 */
    private minMaxTokens;
    constructor(config: ProviderConfig, logger?: any);
    private get apiKey();
    private get model();
    private get timeoutMs();
    chat(request: ChatRequest): Promise<ChatResult>;
    private callOpenAi;
    private callGemini;
}
