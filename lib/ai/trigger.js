"use strict";
/**
 * 触发放行判定（纯函数，便于单测）。
 *
 * 三道闸门保留，但语义收紧：
 *   1) 冷却：同一群两次"真正调用模型"之间至少间隔 aiMinReplyIntervalSeconds；
 *   2) 阈值：hybrid/threshold 下需累计够 aiMessageThreshold 条消息；
 *   3) 概率：random/hybrid 下每条消息掷一次骰。
 * 点名与"点名后跟随"直接放行（不占冷却）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideTrigger = decideTrigger;
function decideTrigger(input) {
    if (input.inFlight)
        return { fire: false, forced: false, reason: 'in-flight' };
    if (input.mention)
        return { fire: true, forced: true, reason: 'direct-mention' };
    if (input.followup)
        return { fire: true, forced: true, reason: 'followup' };
    if (input.minIntervalMs > 0 && input.now - input.lastAttemptAt < input.minIntervalMs) {
        return { fire: false, forced: false, reason: 'cooldown' };
    }
    const needThreshold = input.mode === 'threshold' || input.mode === 'hybrid';
    if (needThreshold && input.counter < Math.max(1, input.threshold)) {
        return {
            fire: false,
            forced: false,
            reason: `below-threshold(${input.counter}/${Math.max(1, input.threshold)})`,
        };
    }
    const needRandom = input.mode === 'random' || input.mode === 'hybrid';
    if (needRandom) {
        const probability = Math.max(0, Math.min(1, Number(input.probability) || 0));
        if (probability <= 0)
            return { fire: false, forced: false, reason: 'random-disabled' };
        if (input.rng() >= probability) {
            return { fire: false, forced: false, reason: `random-miss(${probability})` };
        }
    }
    return { fire: true, forced: false, reason: `trigger(${input.mode})` };
}
