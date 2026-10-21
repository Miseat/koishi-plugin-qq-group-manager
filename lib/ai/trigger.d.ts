/**
 * 触发放行判定（纯函数，便于单测）。
 *
 * 三道闸门保留，但语义收紧：
 *   1) 冷却：同一群两次"真正调用模型"之间至少间隔 aiMinReplyIntervalSeconds；
 *   2) 阈值：hybrid/threshold 下需累计够 aiMessageThreshold 条消息；
 *   3) 概率：random/hybrid 下每条消息掷一次骰。
 * 点名与"点名后跟随"直接放行（不占冷却）。
 */
export interface TriggerInput {
    mode: 'threshold' | 'random' | 'hybrid';
    counter: number;
    threshold: number;
    probability: number;
    now: number;
    lastAttemptAt: number;
    minIntervalMs: number;
    inFlight: boolean;
    mention: boolean;
    followup: boolean;
    rng: () => number;
}
export interface TriggerDecision {
    fire: boolean;
    forced: boolean;
    reason: string;
}
export declare function decideTrigger(input: TriggerInput): TriggerDecision;
