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

  /** 主插件重载后把新实例的 logger 接到同一个注册表上。 */
  setLogger(logger?: any): void {
    if (logger) this.logger = logger;
  }

  /** 诊断用：当前已注册的钩子数量。 */
  stats(): { sections: number; filters: number; afterReply: number; evicted: number } {
    return {
      sections: this.sections.size,
      filters: this.filters.size,
      afterReply: this.afterReplyHandlers.size,
      evicted: this.evictedHandlers.size,
    };
  }

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

/**
 * 进程级共享的钩子注册表。
 *
 * 背景：meme / chat-style / private 等外部插件只在启动时解析一次
 * `qqgmAiHooks`，之后一直持有这个对象。如果主插件每次重载都 `new` 一个
 * 新注册表，新引擎看到的是空注册表，而外部插件还挂在旧对象上——表现就是
 * 主插件单独重启后表情包不发、聊天风格段消失、私聊用旧配置。
 *
 * 用 globalThis + Symbol.for 做单例：即使插件模块被重新 require、甚至从
 * 不同路径加载了两份，拿到的也是同一个注册表，重载前后对象身份不变。
 */
const SHARED_HOOKS = Symbol.for('qqgm.ai-hooks-registry');

export function getSharedAiHooks(logger?: any): AiHookRegistry {
  const store = globalThis as any;
  let registry: AiHookRegistry = store[SHARED_HOOKS];
  if (!registry) {
    registry = new AiHookRegistry(logger);
    store[SHARED_HOOKS] = registry;
    logger?.info?.(`[ai-hooks] v${registry.version} 注册表已创建（进程级单例）`);
  } else if (logger) {
    registry.setLogger(logger);
    const stats = registry.stats();
    logger.info?.(
      `[ai-hooks] 复用进程级注册表：风格段 ${stats.sections} / 过滤器 ${stats.filters} / 后处理 ${stats.afterReply}`,
    );
  }
  return registry;
}
