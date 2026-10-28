"use strict";
/**
 * AI 会话状态：按群维护环形上下文、计数器、冷却与点名跟随。
 *
 * 与旧版的区别：
 * - 机器人自己的发言也会进入上下文（self 记录），不会"说完就忘"；
 * - 每条记录带时间、群名片、角色、引用；
 * - 计数器独立于"是否入上下文"，便于触发策略单独演进。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiState = exports.GroupState = void 0;
class GroupState {
    records = [];
    /** 自上次"完整考虑"（真正调用了模型）以来累计的消息数 */
    counter = 0;
    lastReplyAt = 0;
    lastAttemptAt = 0;
    /** 上次发「冷却中」提示的时间，用于避免 @ 刷屏时反复提示 */
    lastCooldownNoticeAt = 0;
    inFlight = false;
    followup = null;
    seen = new Map();
    /** 挤压上下文，返回被挤出的消息（按时间先后）。 */
    trim(window) {
        const max = Math.max(6, window || 24);
        if (this.records.length <= max)
            return [];
        return this.records.splice(0, this.records.length - max);
    }
    /** @returns 本次被挤出的消息，供外部做归纳 */
    push(record, window) {
        this.records.push(record);
        return this.trim(window);
    }
    /** 事件去重：同一 messageId 15 秒内只处理一次 */
    isDuplicate(key, now) {
        const previous = this.seen.get(key) ?? 0;
        this.seen.set(key, now);
        if (this.seen.size > 512) {
            const expireBefore = now - 120_000;
            for (const [id, ts] of this.seen) {
                if (ts < expireBefore)
                    this.seen.delete(id);
            }
        }
        return previous > 0 && now - previous < 15_000;
    }
}
exports.GroupState = GroupState;
class AiState {
    groups = new Map();
    get(key) {
        let state = this.groups.get(key);
        if (!state) {
            state = new GroupState();
            this.groups.set(key, state);
        }
        return state;
    }
    peek(key) {
        return this.groups.get(key);
    }
    clear() {
        this.groups.clear();
    }
}
exports.AiState = AiState;
