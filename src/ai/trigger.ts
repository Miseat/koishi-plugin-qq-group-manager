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
  /** 伪随机：随机未命中时把下一次概率往上抬，直到必定触发 */
  pseudoRandom?: boolean;
  /** 当前已累计的概率加成（0~1） */
  randomBoost?: number;
  /** 每次未命中增加多少（默认 0.01） */
  pseudoRandomStep?: number;
}

export interface TriggerDecision {
  fire: boolean;
  forced: boolean;
  reason: string;
  /** 冷却中时距离可以再次调用模型的剩余毫秒数 */
  remainingMs?: number;
  /** 本次判定后应保存的伪随机加成；未发生随机掷骰时为 undefined（保持不变） */
  nextBoost?: number;
  /** 本次实际使用的概率（基础值 + 加成），用于日志排查 */
  effectiveProbability?: number;
}

export function decideTrigger(input: TriggerInput): TriggerDecision {
  if (input.inFlight) return { fire: false, forced: false, reason: 'in-flight' };

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
  if (input.mention) return { fire: true, forced: true, reason: 'direct-mention' };
  if (input.followup) return { fire: true, forced: true, reason: 'followup' };

  // ---------- 3) 阈值 ----------
  const needThreshold = input.mode === 'threshold' || input.mode === 'hybrid';
  if (needThreshold && input.counter < Math.max(1, input.threshold)) {
    return {
      fire: false,
      forced: false,
      reason: `below-threshold(${input.counter}/${Math.max(1, input.threshold)})`,
    };
  }

  // ---------- 4) 概率（支持伪随机：连续未命中会逐步抬高概率） ----------
  const needRandom = input.mode === 'random' || input.mode === 'hybrid';
  if (needRandom) {
    const base = Math.max(0, Math.min(1, Number(input.probability) || 0));
    const boost = Math.max(0, Number(input.randomBoost) || 0);
    const effective = Math.min(1, base + boost);
    const round4 = (value: number) => Math.round(value * 10000) / 10000;

    if (effective <= 0) {
      return {
        fire: false,
        forced: false,
        reason: 'random-disabled',
        nextBoost: round4(boost),
        effectiveProbability: 0,
      };
    }

    // 加成到 1 时必定触发，不再消耗随机数
    if (effective >= 1 || input.rng() < effective) {
      return {
        fire: true,
        forced: false,
        reason: `trigger(${input.mode})`,
        nextBoost: 0,
        effectiveProbability: round4(effective),
      };
    }

    const step = Math.max(0, Number(input.pseudoRandomStep) || 0);
    const nextBoost = input.pseudoRandom ? Math.min(1, round4(boost + step)) : round4(boost);
    return {
      fire: false,
      forced: false,
      reason: `random-miss(${effective.toFixed(2)})`,
      nextBoost,
      effectiveProbability: round4(effective),
    };
  }

  return { fire: true, forced: false, reason: `trigger(${input.mode})` };
}
