"use strict";
/**
 * 触发放行判定（纯函数，便于单测）。
 *
 * 冷却的语义已经统一：**所有真正调用模型的行为**（含 @、点名后跟随）
 * 都受同一个冷却约束，按「上一次调用模型的时刻」计算，而不是按
 * 「上一次成功发出回复」——模型返回 <pass/>、被过滤器拦下、请求失败
 * 都算用过一次，避免一直失败却一直重试。
 *
 * 被 @ 但仍在冷却里时返回 remainingMs，由引擎决定是否在群里提示还剩多久。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideTrigger = decideTrigger;
function decideTrigger(input) {
    if (input.inFlight)
        return { fire: false, forced: false, reason: 'in-flight' };
    // ---------- 1) 模型调用冷却：@ 也不能绕过 ----------
    const cooldown = Math.max(0, Number(input.minIntervalMs) || 0);
    const lastAttempt = Number(input.lastAttemptAt) || 0;
    if (cooldown > 0 && lastAttempt > 0) {
        const elapsed = input.now - lastAttempt;
        if (elapsed < cooldown) {
            return {
                fire: false,
                forced: false,
                reason: input.mention ? 'cooldown-mention' : 'cooldown',
                remainingMs: Math.max(0, cooldown - elapsed),
            };
        }
    }
    // ---------- 2) 点名与点名后跟随：越过阈值/概率，但不越过冷却 ----------
    if (input.mention)
        return { fire: true, forced: true, reason: 'direct-mention' };
    if (input.followup)
        return { fire: true, forced: true, reason: 'followup' };
    // ---------- 3) 阈值 ----------
    const needThreshold = input.mode === 'threshold' || input.mode === 'hybrid';
    if (needThreshold && input.counter < Math.max(1, input.threshold)) {
        return {
            fire: false,
            forced: false,
            reason: `below-threshold(${input.counter}/${Math.max(1, input.threshold)})`,
        };
    }
    // ---------- 4) 概率 ----------
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
