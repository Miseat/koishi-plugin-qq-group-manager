/**
 * AI 会话状态：按群维护环形上下文、计数器、冷却与点名跟随。
 *
 * 与旧版的区别：
 * - 机器人自己的发言也会进入上下文（self 记录），不会"说完就忘"；
 * - 每条记录带时间、群名片、角色、引用；
 * - 计数器独立于"是否入上下文"，便于触发策略单独演进。
 */

import type { RenderedImage, RenderedQuote } from '../core/text';

export interface ChatRecord {
  id: string;
  userId: string;
  name: string;
  role?: string;
  text: string;
  images: RenderedImage[];
  quote?: RenderedQuote;
  /** 合并转发子消息的渲染文本（读不到时为空） */
  forwardText?: string;
  /** 本条消息 @ 到的 QQ 号（不含 bot 自己） */
  mentions: string[];
  /** 本条消息是否 @ 了 bot */
  atBot: boolean;
  self: boolean;
  at: number;
  /** 指令类消息：进入上下文但不参与触发/计数 */
  command?: boolean;
}

export interface FollowupState {
  userId: string;
  expiresAt: number;
  turns: number;
  anchorTokens: string[];
  lastText: string;
}

export class GroupState {
  records: ChatRecord[] = [];
  /** 自上次"完整考虑"（真正调用了模型）以来累计的消息数 */
  counter = 0;
  lastAttemptAt = 0;
  /** 上次发「冷却中」提示的时间，用于避免 @ 刷屏时反复提示 */
  lastCooldownNoticeAt = 0;
  /** 伪随机加成：随机未命中时累加，命中后归零 */
  randomBoost = 0;
  inFlight = false;
  followup: FollowupState | null = null;
  seen = new Map<string, number>();

  /** 挤压上下文，返回被挤出的消息（按时间先后）。 */
  trim(window: number): ChatRecord[] {
    const max = Math.max(6, window || 24);
    if (this.records.length <= max) return [];
    return this.records.splice(0, this.records.length - max);
  }

  /** @returns 本次被挤出的消息，供外部做归纳 */
  push(record: ChatRecord, window: number): ChatRecord[] {
    this.records.push(record);
    return this.trim(window);
  }

  /** 事件去重：同一 messageId 15 秒内只处理一次 */
  isDuplicate(key: string, now: number): boolean {
    const previous = this.seen.get(key) ?? 0;
    this.seen.set(key, now);
    if (this.seen.size > 512) {
      const expireBefore = now - 120_000;
      for (const [id, ts] of this.seen) {
        if (ts < expireBefore) this.seen.delete(id);
      }
    }
    return previous > 0 && now - previous < 15_000;
  }
}

export class AiState {
  private groups = new Map<string, GroupState>();

  get(key: string): GroupState {
    let state = this.groups.get(key);
    if (!state) {
      state = new GroupState();
      this.groups.set(key, state);
    }
    return state;
  }

  peek(key: string): GroupState | undefined {
    return this.groups.get(key);
  }

  clear(): void {
    this.groups.clear();
  }
}
