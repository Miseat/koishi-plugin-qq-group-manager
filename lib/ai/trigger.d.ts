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
export interface TriggerInput {
    mode: 'threshold' | 'random' | 'hybrid';
    counter: number;
    threshold: number;
    probability: number;
    now: number;
    lastAttemptAt: number;
    minIntervalMs: number;
    /** 兼容字段：旧版按“上次回复”计算的 @ 冷却，已合并进 minIntervalMs */
    lastReplyAt?: number;
    mentionCooldownMs?: number;
    inFlight: boolean;
    mention: boolean;
    followup: boolean;
    rng: () => number;
}
export interface TriggerDecision {
    fire: boolean;
    forced: boolean;
    reason: string;
    /** 冷却中时距离可以再次调用模型的剩余毫秒数 */
    remainingMs?: number;
}
export declare function decideTrigger(input: TriggerInput): TriggerDecision;
