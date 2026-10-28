"use strict";
/**
 * 模型调用层：OpenAI 兼容接口 与 Gemini 原生接口。
 *
 * 与旧实现的区别：
 * - 统一一次请求接口，支持 system/user 分开；
 * - 带图片时如果服务端返回 4xx（多数是模型不支持图片），自动降级为纯文本重试一次；
 * - 输出统一清洗（去代码块 / 去前后空白），不在这里做长度截断。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatProvider = void 0;
function stripFence(text) {
    return String(text || '')
        .replace(/^\s*```[a-zA-Z0-9_-]*\s*\n?/, '')
        .replace(/\n?\s*```\s*$/, '')
        .trim();
}
class ChatProvider {
    config;
    logger;
    /** 一旦确认当前模型不支持图片，后续直接跳过图片，避免每次都白跑一次 400 */
    visionUnsupported = false;
    /** 推理模型如果在小预算下被截断，记住一个更大的下限，后续不再重复踩坑 */
    minMaxTokens = 0;
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }
    get apiKey() {
        return String(this.config.aiApiKey ?? '').trim();
    }
    get model() {
        return String(this.config.aiModel ?? '').trim();
    }
    get timeoutMs() {
        const seconds = Number(this.config.aiRequestTimeoutSeconds ?? 20);
        return Math.max(5, Math.min(120, Number.isFinite(seconds) ? seconds : 20)) * 1000;
    }
    async chat(request) {
        if (!this.apiKey)
            return { ok: false, error: 'AI 未配置 apiKey' };
        if (!this.model && !String(request.model || '').trim())
            return { ok: false, error: 'AI 未配置 model' };
        const provider = String(this.config.aiProvider ?? 'openai-compatible');
        const requested = (request.images ?? []).filter((item) => /^data:image\//i.test(item) || /^https?:\/\//i.test(item));
        const images = this.visionUnsupported ? [] : requested;
        const result = provider === 'gemini'
            ? await this.callGemini(request, images)
            : await this.callOpenAi(request, images);
        if (result.ok)
            return { ...result, text: stripFence(result.text || '') };
        if (images.length) {
            const errorText = String(result.error || '');
            const rejected = result.status === 400
                || result.status === 422
                || /image|vision|multimodal/i.test(errorText);
            if (rejected) {
                // 「格式不对」和「模型不支持视觉」是两件事，必须分开处理。
                // 前者只跳过这一次，后者才记进 visionUnsupported。
                const formatProblem = /unsupported image|invalid image|image format|must be|one of the following formats|too large|dimension/i.test(errorText);
                if (!formatProblem) {
                    this.visionUnsupported = true;
                    this.logger?.warn?.(`[ai] 模型不支持图片(${result.status ?? '?'})，后续自动跳过图片: ${errorText}`);
                }
                else {
                    this.logger?.warn?.(`[ai] 本次图片格式不被接受(${result.status ?? '?'})，仅跳过本次，不影响后续: ${errorText}`);
                }
                const fallback = provider === 'gemini'
                    ? await this.callGemini(request, [])
                    : await this.callOpenAi(request, []);
                if (fallback.ok)
                    return { ...fallback, text: stripFence(fallback.text || ''), degradedToText: true };
                return fallback;
            }
        }
        return result;
    }
    async callOpenAi(request, images, options = {}) {
        const base = String(this.config.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = String(request.model || this.model).trim();
        const content = [{ type: 'text', text: request.user }];
        for (const url of images)
            content.push({ type: 'image_url', image_url: { url } });
        const userContent = images.length ? content : request.user;
        const maxTokens = Math.max(options.maxTokens ?? request.maxTokens ?? this.config.aiMaxOutputTokens ?? 400, this.minMaxTokens);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
        try {
            const response = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    temperature: request.temperature ?? this.config.aiTemperature ?? 0.8,
                    max_tokens: maxTokens,
                    messages: [
                        { role: 'system', content: request.system },
                        { role: 'user', content: userContent },
                    ],
                }),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                return {
                    ok: false,
                    status: response.status,
                    error: payload?.error?.message || response.statusText || `HTTP ${response.status}`,
                };
            }
            const raw = payload?.choices?.[0]?.message?.content;
            let text = '';
            if (typeof raw === 'string') {
                text = raw;
            }
            else if (Array.isArray(raw)) {
                text = raw.map((item) => item?.text || '').join('');
            }
            if (!text.trim()) {
                const finish = payload?.choices?.[0]?.finish_reason;
                // 推理模型会把 token 先花在 reasoning 上：预算太小会正文为空、finish=length。
                // 这里自动放大预算重试一次，避免"该回的不回"。
                if (finish === 'length' && !options.retried) {
                    const bigger = Math.max(1600, maxTokens * 3);
                    this.logger?.warn?.(`[ai] 输出被截断(finish=length, max_tokens=${maxTokens})，用 ${bigger} 重试一次`);
                    const retried = await this.callOpenAi(request, images, { maxTokens: bigger, retried: true });
                    if (retried.ok)
                        this.minMaxTokens = Math.max(this.minMaxTokens, bigger);
                    return retried;
                }
                // 兼容：把 reasoning_content 里的 JSON 捞出来（主要给 two-stage 判定用）
                const reasoning = String(payload?.choices?.[0]?.message?.reasoning_content || '');
                const jsonLike = reasoning.match(/\{[\s\S]*\}/);
                if (jsonLike)
                    text = jsonLike[0];
            }
            if (!text.trim()) {
                return {
                    ok: false,
                    status: response.status,
                    error: `模型返回空内容(finish=${payload?.choices?.[0]?.finish_reason || 'unknown'})`,
                };
            }
            return {
                ok: true,
                text,
                status: response.status,
                usage: payload?.usage,
                finishReason: payload?.choices?.[0]?.finish_reason,
            };
        }
        catch (error) {
            const aborted = error?.name === 'AbortError';
            return { ok: false, error: aborted ? '请求超时' : `请求失败: ${String(error?.message || error)}` };
        }
        finally {
            clearTimeout(timer);
        }
    }
    async callGemini(request, images) {
        const rawBase = String(this.config.aiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
        const base = /\/v\d/i.test(rawBase) ? rawBase : `${rawBase}/v1beta`;
        const model = String(request.model || this.model).trim();
        const endpoint = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
        const parts = [{ text: request.user }];
        for (const url of images) {
            const match = /^data:(image\/[^;]+);base64,(.*)$/i.exec(url);
            if (match)
                parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: request.system }] },
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        temperature: request.temperature ?? this.config.aiTemperature ?? 0.8,
                        maxOutputTokens: request.maxTokens ?? this.config.aiMaxOutputTokens ?? 400,
                    },
                }),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                return {
                    ok: false,
                    status: response.status,
                    error: payload?.error?.message || response.statusText || `HTTP ${response.status}`,
                };
            }
            const text = (payload?.candidates?.[0]?.content?.parts ?? [])
                .map((item) => item?.text || '')
                .join('')
                .trim();
            if (!text)
                return { ok: false, status: response.status, error: 'Gemini 返回空内容' };
            return {
                ok: true,
                text,
                status: response.status,
                usage: payload?.usageMetadata,
                finishReason: payload?.candidates?.[0]?.finishReason,
            };
        }
        catch (error) {
            const aborted = error?.name === 'AbortError';
            return { ok: false, error: aborted ? '请求超时' : `请求失败: ${String(error?.message || error)}` };
        }
        finally {
            clearTimeout(timer);
        }
    }
}
exports.ChatProvider = ChatProvider;
