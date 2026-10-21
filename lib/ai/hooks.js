"use strict";
/**
 * AI 扩展钩子：让外部插件给提示词追加“风格段”，并在发送前过滤输出。
 *
 * 设计目标：
 * - 只暴露两个最小能力，不把引擎内部结构漏出去；
 * - 任何钩子抛错都不能影响正常回复（记录日志后继续）；
 * - 输出过滤器返回 null 表示“这条不要发”（按 pass 处理）；
 * - version 用于外部插件做兼容检查。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiHookRegistry = void 0;
class AiHookRegistry {
    logger;
    /** 钩子接口版本；外部插件应检查 >= 1 */
    version = 1;
    sections = new Set();
    filters = new Set();
    afterReplyHandlers = new Set();
    constructor(logger) {
        this.logger = logger;
    }
    registerPromptSection(provider) {
        this.sections.add(provider);
        return () => this.sections.delete(provider);
    }
    registerOutputFilter(filter) {
        this.filters.add(filter);
        return () => this.filters.delete(filter);
    }
    /** 文字回复已发送后触发；用于追加表情包等后续动作。 */
    registerAfterReply(handler) {
        this.afterReplyHandlers.add(handler);
        return () => this.afterReplyHandlers.delete(handler);
    }
    /** 汇总所有风格段；单个 provider 失败只记日志，不影响其它。 */
    async collectSections(ctx) {
        const out = [];
        for (const provider of this.sections) {
            try {
                const text = await provider(ctx);
                if (text && String(text).trim())
                    out.push(String(text).trim());
            }
            catch (error) {
                this.logger?.warn?.(`[ai-hooks] prompt section failed: ${String(error)}`);
            }
        }
        return out;
    }
    /** 依次执行输出过滤器；返回 null 表示丢弃本条回复。 */
    async applyFilters(text, ctx) {
        let current = String(text ?? '');
        for (const filter of this.filters) {
            try {
                const next = await filter(current, ctx);
                if (next == null)
                    return null;
                current = String(next);
            }
            catch (error) {
                this.logger?.warn?.(`[ai-hooks] output filter failed: ${String(error)}`);
            }
        }
        return current;
    }
    /** 文字回复发送后执行；单个 handler 失败只记日志，不影响其它。 */
    async runAfterReply(ctx) {
        for (const handler of this.afterReplyHandlers) {
            try {
                await handler(ctx);
            }
            catch (error) {
                this.logger?.warn?.(`[ai-hooks] after-reply failed: ${String(error)}`);
            }
        }
    }
}
exports.AiHookRegistry = AiHookRegistry;
