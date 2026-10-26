/**
 * AI 扩展钩子：让外部插件给提示词追加“风格段”，并在发送前过滤输出。
 *
 * 设计目标：
 * - 只暴露最小能力，不把引擎内部结构漏出去；
 * - 任何钩子抛错都不能影响正常回复（记录日志后继续）；
 * - 输出过滤器返回 null 表示“这条不要发”（按 pass 处理）；
 * - version 用于外部插件做兼容检查。
 */

export interface AiHookContext {
  session: any;
  groupId: string;
  mode: 'reply' | 'judge';
}

export type PromptSectionProvider = (ctx: AiHookContext) => string | Promise<string>;
export type OutputFilter = (text: string, ctx: AiHookContext) => string | null | Promise<string | null>;

export interface AiAfterReplyContext extends AiHookContext {
  /** 已经发送并写入上下文的最终文本 */
  text: string;
}

export type AfterReplyHandler = (ctx: AiAfterReplyContext) => void | Promise<void>;

/** 一条被挤出上下文的消息。字段与 ChatRecord 对齐，但只挑外部需要的部分。 */
export interface EvictedRecord {
  id: string;
  userId: string;
  name: string;
  role?: string;
  text: string;
  self: boolean;
  at: number;
  command?: boolean;
}

/** 上下文挤出事件：一次可能挤掉多条。 */
export interface ContextEvictedContext {
  /** 群号；私聊时为空字符串 */
  groupId: string;
  /** 会话类型 */
  kind: 'group' | 'private';
  /** 作用域 ID：群聊=群号，私聊=对方 QQ 号 */
  scopeId: string;
  session?: any;
  /** 本次被挤出的消息，按时间先后排列 */
  evicted: EvictedRecord[];
  /** 当前上下文窗口大小 */
  window: number;
}

export type ContextEvictedHandler = (ctx: ContextEvictedContext) => void | Promise<void>;

export class AiHookRegistry {
  /** 钩子接口版本；外部插件应检查 >= 2 才能用 contextEvicted */
  readonly version = 2;

  private sections = new Set<PromptSectionProvider>();
  private filters = new Set<OutputFilter>();
  private afterReplyHandlers = new Set<AfterReplyHandler>();
  private evictedHandlers = new Set<ContextEvictedHandler>();

  constructor(private logger?: any) {}

  registerPromptSection(provider: PromptSectionProvider): () => void {
    this.sections.add(provider);
    return () => this.sections.delete(provider);
  }

  registerOutputFilter(filter: OutputFilter): () => void {
    this.filters.add(filter);
    return () => this.filters.delete(filter);
  }

  /** 文字回复已发送后触发；用于追加表情包等后续动作。 */
  registerAfterReply(handler: AfterReplyHandler): () => void {
    this.afterReplyHandlers.add(handler);
    return () => this.afterReplyHandlers.delete(handler);
  }

  /**
   * 上下文挤出消息时触发（2.0+）。
   * 用于把这些即将被丢弃的消息交给外部插件做归纳、归档等。
   */
  registerContextEvicted(handler: ContextEvictedHandler): () => void {
    this.evictedHandlers.add(handler);
    return () => this.evictedHandlers.delete(handler);
  }

  /** 汇总所有风格段；单个 provider 失败只记日志，不影响其它。 */
  async collectSections(ctx: AiHookContext): Promise<string[]> {
    const out: string[] = [];
    for (const provider of this.sections) {
      try {
        const text = await provider(ctx);
        if (text && String(text).trim()) out.push(String(text).trim());
      } catch (error) {
        this.logger?.warn?.(`[ai-hooks] prompt section failed: ${String(error)}`);
      }
    }
    return out;
  }

  /** 依次执行输出过滤器；返回 null 表示丢弃本条回复。 */
  async applyFilters(text: string, ctx: AiHookContext): Promise<string | null> {
    let current = String(text ?? '');
    for (const filter of this.filters) {
      try {
        const next = await filter(current, ctx);
        if (next == null) return null;
        current = String(next);
      } catch (error) {
        this.logger?.warn?.(`[ai-hooks] output filter failed: ${String(error)}`);
      }
    }
    return current;
  }

  /** 文字回复发送后执行；单个 handler 失败只记日志，不影响其它。 */
  async runAfterReply(ctx: AiAfterReplyContext): Promise<void> {
    for (const handler of this.afterReplyHandlers) {
      try {
        await handler(ctx);
      } catch (error) {
        this.logger?.warn?.(`[ai-hooks] after-reply failed: ${String(error)}`);
      }
    }
  }

  /** 上下文挤出后执行；单个 handler 失败只记日志，不影响其它。 */
  async runContextEvicted(ctx: ContextEvictedContext): Promise<void> {
    if (!this.evictedHandlers.size) return;
    for (const handler of this.evictedHandlers) {
      try {
        await handler(ctx);
      } catch (error) {
        this.logger?.warn?.(`[ai-hooks] context-evicted failed: ${String(error)}`);
      }
    }
  }
}
