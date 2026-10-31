/**
 * AI 回复引擎。
 *
 * 一次「收到消息」的完整流程：
 *   record()  记录到上下文（所有消息都记，包括被管控/指令之外的人话）
 *   handle()  判定是否接话 → 组装提示词 → （可选）解析图片 → 调模型
 *             → 输出正文 / <pass/> → 发送 → 把自己的回复写回上下文
 *
 * 关键取舍：
 * - 决策与生成合并为一次模型调用，避免"兴趣判定答非所问、生成又挑另一条"；
 * - 只回应当前消息，引用与回答永远一致；
 * - 允许模型用 <pass/> 主动放弃，放弃也重置计数，避免每条消息都空转调用。
 */

import { AiState, GroupState, ChatRecord, FollowupState } from './state';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LearnBucket,
  LearnStore,
  buildSummaryPrompt,
  buildConsolidatePrompt,
  cleanSummary,
  isDuplicate,
  isAutoMemoryBlock,
  AUTO_MEMORY_LABEL,
} from './learn';
import { decideTrigger } from './trigger';
import { buildReplyPrompt, buildUserPrompt } from './prompt';
import { ChatProvider } from './provider';
import { pickImages, resolveImages } from './vision';
import { selectMemoryBlocks, splitMemoryBlocks, tokenizeForMatch } from './memory';
import { NameResolver, MemberIdentity } from '../core/names';
import { renderMessage, RenderedImage, truncate } from '../core/text';
import { AiHookRegistry, AiHookContext } from './hooks';
import {
  buildSearchQuery,
  fetchWebSearch,
  shouldWebSearch,
  WebSearchMode,
} from './websearch';

export interface AiHost {
  config: any;
  logger: any;
  getOneBotApi(session: any): any;
  toGroupId(session: any): number | null;
  extractImages(session: any): RenderedImage[];
  fetchQuotedImages?(session: any, quote: any): Promise<RenderedImage[]>;
  resolveImage(ref: string, session: any): Promise<string>;
  sendReply(session: any, text: string): Promise<void>;
  /** 发送系统提示（不引用、不进入 AI 上下文），用于冷却提示等 */
  sendNotice?(session: any, text: string): Promise<void>;
  /** 写入自动归纳记忆：add = 新条目；remove = 需要被压缩替换掉的旧条目 */
  commitAutoMemory?(scope: { kind: 'group' | 'private'; id: string } | null, payload: {
    add: string;
    remove?: string[];
    label?: string;
  }): Promise<void>;
  readMemoryFile(scope?: { kind: 'group' | 'private'; id: string } | null): Promise<string>;
}

export interface AiDeps {
  provider?: ChatProvider;
  state?: AiState;
  rng?: () => number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  /**
   * 钩子注册表。主插件会传入进程级共享实例；不传则每次新建，
   * 保证测试/多实例之间互不串钩子。
   */
  hooks?: AiHookRegistry;
}

const PASS_RE = /^\s*<(?:pass\s*\/?|不回复)>/i;

function cleanReply(text: string, selfName: string): string {
  let out = String(text || '')
    .replace(/^\s*```[a-zA-Z0-9_-]*\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '')
    // 防止模型输出被平台解析成图片/CQ 码（h.text 本身不解析，这里只是保持干净）
    .replace(/\[CQ:[^\]]+\]/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .trim();
  // 去掉模型自作主张的「自称：」前缀
  const prefix = new RegExp(`^\\s*${selfName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s*`, 'i');
  out = out.replace(prefix, '');
  // 整句被引号包住时脱掉
  if (/^[“"「].*[”"」]$/.test(out)) out = out.slice(1, -1).trim();
  return out.replace(/\s+/g, ' ').trim();
}

/** 把服务端 usage 压成一行日志，便于观察真实 token 消耗与缓存命中 */
function usageText(usage: any): string {
  if (!usage) return '';
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  const cacheHit = usage.prompt_cache_hit_tokens
    ?? usage.cached_tokens
    ?? usage.cache_read_input_tokens;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
    ?? usage.reasoning_tokens;
  const parts: string[] = [];
  if (input != null) parts.push(`in=${input}`);
  if (output != null) parts.push(`out=${output}`);
  if (cacheHit != null) parts.push(`cache=${cacheHit}`);
  if (reasoning != null) parts.push(`reasoning=${reasoning}`);
  return parts.join(',');
}

function clipReply(text: string, maxChars: number): string {  const max = Math.max(20, maxChars || 120);
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const boundary = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('，'),
    slice.lastIndexOf(';'),
    slice.lastIndexOf('；'),
  );
  if (boundary >= max * 0.5) return slice.slice(0, boundary + 1);
  return `${slice}…`;
}

export class AiEngine {
  readonly state: AiState;
  /** 外部插件扩展点：提示词风格段 + 输出过滤 */
  readonly hooks: AiHookRegistry;
  private provider: ChatProvider;
  private names: NameResolver;
  private rng: () => number;
  private now: () => number;
  private fetchImpl: typeof fetch;
  private host: AiHost;
  private config: any;
  private searchCache = new Map<string, { at: number; section: string }>();
  private searchRate = new Map<string, number[]>();
  private searchUnsupportedUntil = 0;
  /** 自动归纳：按作用域累计被挤出的消息 */
  private learnStore = new LearnStore();
  /** 自动归纳：每个作用域每天的次数，防刷额度 */
  private learnDaily = new Map<string, number>();
  /** 自动归纳：空闲兜底定时器 */
  private learnTimer: any = null;
  /** 状态持久化：退出/定时把上下文与待归纳桶写到 data/qqgm-ai-state.json */
  private persistEnabled = true;
  private persistTimer: any = null;

  constructor(host: AiHost, deps: AiDeps = {}) {
    this.host = host;
    this.config = host.config;
    this.state = deps.state ?? new AiState();
    // 默认独立注册表；主插件通过 deps.hooks 注入进程级单例，
    // 这样主插件重载后外部插件注册的钩子不会丢。
    this.hooks = deps.hooks ?? new AiHookRegistry(host.logger);
    this.provider = deps.provider ?? new ChatProvider(host.config, host.logger);
    this.names = new NameResolver({
      getOneBotApi: (session) => host.getOneBotApi(session),
      toGroupId: (session) => host.toGroupId(session),
      logger: host.logger,
    });
    this.rng = deps.rng ?? Math.random;
    this.now = deps.now ?? Date.now;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;

    // 只有配置明确为 true 才持久化。生产环境 Schema 默认就是 true；
    // 测试里用裸对象构造引擎时不会误写/误读仓库目录下的状态文件。
    this.persistEnabled = host.config?.persistAiState === true;
    this.restorePersistedState();

    // 空闲兜底：消息量迟迟不满阈值时，超时后归纳一次
    this.startLearnTimer();
  }

  // ---------------------------------------------------------------- 持久化

  /** 持久化文件路径（Koishi 数据目录下） */
  private stateFilePath(): string {
    const base = (this.host as any)?.ctx?.baseDir || process.cwd();
    return path.join(base, 'data', 'qqgm-ai-state.json');
  }

  /** 精简一条记录用于落盘：去掉图片（Data URL 太大），文本做上限 */
  private slimRecord(record: ChatRecord): any {
    return {
      id: String(record.id || ''),
      userId: String(record.userId || ''),
      name: String(record.name || ''),
      role: record.role || 'unknown',
      text: String(record.text || '').slice(0, 600),
      quote: record.quote
        ? {
          name: String((record.quote as any).name || ''),
          userId: String((record.quote as any).userId || ''),
          text: String((record.quote as any).text || '').slice(0, 200),
          id: String((record.quote as any).id || ''),
        }
        : undefined,
      forwardText: record.forwardText ? String(record.forwardText).slice(0, 1200) : undefined,
      mentions: Array.isArray(record.mentions) ? record.mentions.map(String).slice(0, 20) : [],
      atBot: !!record.atBot,
      self: !!record.self,
      at: Number(record.at) || 0,
      command: record.command ? true : undefined,
    };
  }

  private reviveRecord(raw: any): ChatRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text || '').trim();
    if (!text && !raw.command) return null;
    return {
      id: String(raw.id || `restored-${Math.random().toString(36).slice(2, 8)}`),
      userId: String(raw.userId || ''),
      name: String(raw.name || raw.userId || ''),
      role: raw.role || 'unknown',
      text,
      images: [],
      quote: raw.quote?.text
        ? {
          name: String(raw.quote.name || ''),
          userId: String(raw.quote.userId || ''),
          text: String(raw.quote.text || ''),
          id: String(raw.quote.id || ''),
          images: [],
        }
        : undefined,
      forwardText: raw.forwardText ? String(raw.forwardText) : undefined,
      mentions: Array.isArray(raw.mentions) ? raw.mentions.map(String) : [],
      atBot: !!raw.atBot,
      self: !!raw.self,
      at: Number(raw.at) || 0,
      command: !!raw.command,
    };
  }

  /**
   * 恢复上次退出时的状态。
   *
   * - 最近上下文：只恢复 6 小时以内的，避免重启后把很久以前的消息当成“最近”；
   * - 未归纳消息桶：全部恢复（它们还没变成记忆，丢了就真丢了）；
   * - 计数、模型调用冷却、伪随机加成、点名跟随：一并恢复。
   */
  private restorePersistedState(): void {
    if (!this.persistEnabled) return;
    const file = this.stateFilePath();
    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    if (!data || data.version !== 1) return;

    const now = this.now();
    const ttl = 6 * 60 * 60 * 1000;
    let groups = 0;
    let learns = 0;

    for (const [key, raw] of Object.entries(data.groups || {})) {
      const item: any = raw;
      if (!item || typeof item !== 'object') continue;
      const st = new GroupState();
      st.counter = Math.max(0, Number(item.counter) || 0);
      st.lastAttemptAt = Math.max(0, Number(item.lastAttemptAt) || 0);
      st.lastCooldownNoticeAt = Math.max(0, Number(item.lastCooldownNoticeAt) || 0);
      st.randomBoost = Math.min(1, Math.max(0, Number(item.randomBoost) || 0));
      const followup = item.followup;
      if (followup && Number(followup.expiresAt) > now && typeof followup.userId === 'string') {
        st.followup = followup as FollowupState;
      }
      st.records = (Array.isArray(item.records) ? item.records : [])
        .map((record: any) => this.reviveRecord(record))
        .filter((record: ChatRecord | null): record is ChatRecord => !!record)
        .filter((record: ChatRecord) => now - record.at <= ttl);
      if (st.records.length > this.contextWindow) {
        st.records = st.records.slice(-this.contextWindow);
      }
      if (!st.records.length) {
        st.counter = 0;
        st.followup = null;
        // 上下文过期就不恢复这个会话，避免凭空出现一个空状态
        continue;
      }
      this.state.set(key, st);
      groups += 1;
    }

    for (const [key, raw] of Object.entries(data.learn || {})) {
      const item: any = raw;
      const idx = key.indexOf(':');
      if (idx < 0 || !item || typeof item !== 'object') continue;
      const bucket = new LearnBucket();
      bucket.records = (Array.isArray(item.records) ? item.records : [])
        .map((record: any) => this.reviveRecord(record))
        .filter((record: ChatRecord | null): record is ChatRecord => !!record);
      bucket.lastActivityAt = Number(item.lastActivityAt) || 0;
      bucket.lastLearnedAt = Number(item.lastLearnedAt) || 0;
      if (!bucket.records.length) continue;
      this.learnStore.set(key.slice(0, idx), key.slice(idx + 1), bucket);
      learns += 1;
    }

    for (const pair of Array.isArray(data.learnDaily) ? data.learnDaily : []) {
      if (Array.isArray(pair) && pair.length === 2) {
        this.learnDaily.set(String(pair[0]), Math.max(0, Number(pair[1]) || 0));
      }
    }

    if (groups || learns) {
      this.host.logger?.info?.(`[ai-state] 已恢复 ${groups} 个会话、${learns} 个待归纳桶`);
    }
  }

  /** 落盘当前状态（同步、原子替换，dispose 时调用） */
  private flushPersistedState(): void {
    if (!this.persistEnabled) return;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      const file = this.stateFilePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.snapshotState()), 'utf8');
      fs.renameSync(tmp, file);
    } catch (error: any) {
      this.host.logger?.warn?.(`[ai-state] 保存失败: ${String(error)}`);
    }
  }

  private snapshotState(): any {
    const groups: Record<string, any> = {};
    for (const [key, st] of this.state.entries()) {
      if (!st.records.length && !st.counter && !st.randomBoost) continue;
      groups[key] = {
        counter: st.counter,
        lastAttemptAt: st.lastAttemptAt,
        lastCooldownNoticeAt: st.lastCooldownNoticeAt,
        randomBoost: st.randomBoost,
        followup: st.followup,
        records: st.records.map((record) => this.slimRecord(record)),
      };
    }

    const learn: Record<string, any> = {};
    for (const item of this.learnStore.entries()) {
      learn[`${item.kind}:${item.scopeId}`] = {
        lastActivityAt: item.bucket.lastActivityAt,
        lastLearnedAt: item.bucket.lastLearnedAt,
        records: item.bucket.records.map((record) => this.slimRecord(record as ChatRecord)),
      };
    }

    return {
      version: 1,
      savedAt: this.now(),
      groups,
      learn,
      learnDaily: [...this.learnDaily.entries()],
    };
  }

  /** 防抖落盘：状态变化频繁，最多 3 秒写一次 */
  private schedulePersist(): void {
    if (!this.persistEnabled || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistedState();
    }, 3000);
    if (this.persistTimer.unref) this.persistTimer.unref();
  }

  // ---------------------------------------------------------------- 配置

  private groupKey(session: any): string {
    if (!session?.guildId) return '';
    return `${session.platform ?? 'unknown'}:${session.guildId}`;
  }

  private ruleFor(session: any): any {
    const guildId = String(session?.guildId ?? '');
    const rules: any[] = Array.isArray(this.config.groupRules) ? this.config.groupRules : [];
    return rules.find((item) => String(item?.guildId ?? '').trim() === guildId);
  }

  /**
   * 读配置：该群 groupRules 里有同名非空值就用它，否则回落到全局。
   * 这样频率限制（阈值/概率/模型调用冷却）可以按群单独设置。
   */
  private setting(session: any, key: string): any {
    const rule = this.ruleFor(session);
    const value = rule ? rule[key] : undefined;
    if (value === undefined || value === null || value === '') return this.config[key];
    return value;
  }

  resolveEnabled(session: any): boolean {
    const rule = this.ruleFor(session);
    const requireRule = this.config.aiReplyRequireGroupRule !== false;
    if (requireRule && !rule) return false;
    if (rule && typeof rule.enableAiReply === 'boolean') return rule.enableAiReply;
    return !!this.config.enableAiReply;
  }

  private get contextWindow(): number {
    const value = Number(this.config.aiContextWindow ?? 24);
    return Math.max(6, Math.min(100, Number.isFinite(value) ? value : 24));
  }

  private get selfName(): string {
    const persona = this.activePersona();
    return String(persona?.selfName || this.config.aiAgentName || 'bot').trim() || 'bot';
  }

  private activePersona(): any {
    const id = String(this.config.aiActivePersona ?? '').trim();
    if (!id) return null;
    const list: any[] = Array.isArray(this.config.aiPersonas) ? this.config.aiPersonas : [];
    return list.find((item) => String(item?.id ?? '').trim() === id) ?? null;
  }

  private get personaPrompt(): string {
    const persona = this.activePersona();
    return String(persona?.prompt || this.config.aiSystemPrompt || '').trim();
  }

  private get maxReplyChars(): number {
    const value = Number(this.config.aiMaxReplyChars ?? 120);
    return Math.max(20, Math.min(500, Number.isFinite(value) ? value : 120));
  }

  private get debugPrompt(): boolean {
    return !!this.config.aiDebugPrompt;
  }

  /**
   * 历史上下文按字数裁剪（aiContextMaxChars，0=不限）。
   * 从最新往前累加，至少保留最近 4 条，避免一刀切掉当前对话。
   */
  private clampContext(records: ChatRecord[]): ChatRecord[] {
    const limit = Math.max(0, Number(this.config.aiContextMaxChars ?? 0));
    if (!limit || !records.length) return records;
    const out: ChatRecord[] = [];
    let total = 0;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const item = records[i];
      const size = String(item.text || '').length
        + String(item.forwardText || '').length
        + 32; // 昵称 / 时间 / 角色等渲染开销
      if (out.length >= 4 && total + size > limit) break;
      total += size;
      out.unshift(item);
    }
    return out;
  }

  /** 限制外部插件注入的风格段长度（aiStyleMaxChars，0=不限） */
  private clampStyle(sections: string[]): string[] {
    const limit = Math.max(0, Number(this.config.aiStyleMaxChars ?? 0));
    if (!limit || !sections.length) return sections;
    return sections.map((text) => {
      const value = String(text || '');
      if (value.length <= limit) return value;
      return `${value.slice(0, limit)}\n（以上风格说明过长已截断，保持已经给出的语气即可）`;
    });
  }

  // ---------------------------------------------------------------- 记录

  /** 是否像指令（这类消息不进上下文，避免污染） */
  private isCommandLike(text: string): boolean {
    const value = String(text || '').trim();
    if (!value) return false;
    if (/^[/.!！#＃]/.test(value)) return true;
    if (/^\[[^\]\s]+\]/.test(value)) return true;
    const prefixes = [this.config.command, this.config.menuCommand, 'help']
      .map((item: any) => String(item ?? '').trim())
      .filter(Boolean);
    return prefixes.some((prefix: string) => value === prefix || value.startsWith(`${prefix} `));
  }

  /** 记录一条群消息；返回落库后的记录（指令类返回 null） */
  async record(session: any): Promise<ChatRecord | null> {
    const key = this.groupKey(session);
    if (!key || !session?.userId) return null;
    if (String(session.userId) === String(session.bot?.selfId ?? '')) return null;

    const state = this.state.get(key);
    const messageId = String(session.messageId ?? '');
    if (messageId) {
      const existing = state.records.find((item) => item.id === messageId);
      if (existing) return existing;
    }

    const contextWindow = this.contextWindow;

    // 先排除指令，避免为指令解析 @ / 查群名片
    const rawText = String(session.content ?? '').trim();
    if (this.isCommandLike(rawText.replace(/^\s*(<at\b[^>]*\/?>|\[CQ:at,[^\]]+\])\s*/i, ''))) {
      return null;
    }

    const identity: MemberIdentity = await this.names.identify(session);

    const rendered = await renderMessage(session, this.names.resolverFor(session), {
      selfId: String(session.bot?.selfId ?? session.selfId ?? ''),
    });

    const record: ChatRecord = {
      id: messageId || `local-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: String(session.userId),
      name: identity.name || String(session.userId),
      role: identity.role,
      text: rendered.text,
      images: rendered.images,
      quote: rendered.quote,
      forwardText: await this.readForwards(session, rendered.forwards || []),
      mentions: rendered.mentions,
      atBot: rendered.atBot,
      self: false,
      at: Number(session.timestamp) || this.now(),
    };

    const evicted = state.push(record, contextWindow);
    this.emitEvicted(evicted, key, session);
    state.counter += 1;
    this.schedulePersist();
    return record;
  }

  /** 追加一条系统注记（复读等），不进计数、不触发 */
  note(text: string, groupKey?: string, session?: any): void {
    const key = groupKey || (session ? this.groupKey(session) : '');
    if (!key || !text?.trim()) return;
    const state = this.state.get(key);
    const evicted = state.push(
      {
        id: `note-${this.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: 'system',
        name: '系统',
        role: 'unknown',
        text: String(text).trim(),
        images: [],
        mentions: [],
        atBot: false,
        self: false,
        at: this.now(),
        command: true,
      },
      this.contextWindow,
    );
    this.emitEvicted(evicted, groupKey, session);
    this.schedulePersist();
  }

  /** 机器人自己发出的消息：写回上下文，解决"说完就忘" */
  recordSelf(session: any, text: string): void {
    const key = this.groupKey(session);
    if (!key || !text?.trim()) return;
    const state = this.state.get(key);
    const evicted = state.push(
      {
        id: `self-${this.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: String(session.bot?.selfId ?? ''),
        name: this.selfName,
        role: 'unknown',
        text: String(text).trim(),
        images: [],
        mentions: [],
        atBot: false,
        self: true,
        at: this.now(),
      },
      this.contextWindow,
    );
    this.emitEvicted(evicted, key, session);
    this.schedulePersist();
  }

  /**
   * 把本次被挤出上下文的消息交给外部插件（用于自动归纳沉淀）。
   * 失败不影响主流程。
   */
  /**
   * 上下文挤出后的两件事：
   *   1. 交给外部插件（registerContextEvicted，可选）
   *   2. 内建自动归纳：累计到阈值或空闲后总结成一条记忆写回
   * 任何一步失败都不影响正常聊天。
   */
  private emitEvicted(evicted: ChatRecord[], groupKey?: string, session?: any): void {
    if (!evicted || !evicted.length) return;

    const isDirect = session?.isDirect === true || !session?.guildId;
    const guildId = String(session?.guildId || "");
    const userId = String(session?.userId || "");
    const kind: "group" | "private" = isDirect ? "private" : "group";
    const scopeId = isDirect ? userId : guildId;
    if (!scopeId) return;

    const cfg: any = this.config || {};

    // ---------- 1) 分发给外部插件 ----------
    if (this.hooks && typeof (this.hooks as any).runContextEvicted === "function") {
      const payload = evicted.map((item) => ({
        id: item.id,
        userId: item.userId,
        name: item.name,
        role: item.role,
        text: item.text,
        self: item.self,
        at: item.at,
        command: item.command,
      }));
      void this.hooks
        .runContextEvicted({
          groupId: guildId,
          kind,
          scopeId,
          session,
          evicted: payload,
          window: this.contextWindow,
        })
        .catch((error: any) => {
          this.host.logger?.warn?.(`[ai-evicted] 分发失败: ${String(error)}`);
        });
    }

    // ---------- 2) 内建自动归纳 ----------
    if (!cfg.memoryAutoLearn) return;
    if (!cfg.enableMemory || cfg.memoryAutoLearn === false) return;
    if (!this.resolveEnabled(session)) return;
    const allow: string[] = Array.isArray(cfg.memoryAutoLearnGroups) ? cfg.memoryAutoLearnGroups.map(String) : [];
    if (allow.length && !allow.includes(guildId) && !allow.includes(userId)) return;

    const bucket = this.learnStore.get(kind, scopeId);
    const threshold = Math.max(1, Math.round(this.contextWindow * (Number(cfg.memoryLearnThresholdScale) || 1)));
    const fire = bucket.push(evicted, threshold, this.now());
    this.schedulePersist();
    if (fire) {
      void this.learnAndReport(kind, scopeId, bucket, "threshold", session);
    }
  }

  /** 归纳并（可选）回推到原会话 */
  /** 启动空闲兜底定时器；每 5 分钟检查一次 */
  private startLearnTimer(): void {
    if (this.learnTimer) return;
    const cfg: any = this.config || {};
    if (!cfg.memoryAutoLearn) return;
    const idleHours = Math.max(1, Number(cfg.memoryLearnIdleHours) || 8);
    const idleMs = idleHours * 60 * 60 * 1000;
    this.learnTimer = setInterval(() => {
      try {
        const pending = this.learnStore.idleList(this.now(), idleMs);
        for (const item of pending) {
          void this.learnAndReport(item.kind as any, item.scopeId, item.bucket, "idle");
        }
      } catch (error: any) {
        this.host.logger?.warn?.(`[memory-learn] 空闲检查失败: ${String(error)}`);
      }
    }, 5 * 60 * 1000);
    if (this.learnTimer.unref) this.learnTimer.unref();
  }

  /** 资源清理：落盘状态、停止定时器、清空缓存 */
  dispose(): void {
    this.flushPersistedState();
    if (this.learnTimer) {
      clearInterval(this.learnTimer);
      this.learnTimer = null;
    }
    this.learnStore.clear();
    this.learnDaily.clear();
    this.searchCache.clear();
    this.searchRate.clear();
  }

  private async learnAndReport(
    kind: "group" | "private",
    scopeId: string,
    bucket: LearnBucket,
    reason: string,
    session?: any,
  ): Promise<void> {
    const cfg: any = this.config || {};
    const records = bucket.drain();
    if (!records.length) return;
    this.schedulePersist();

    const scope = { kind, id: scopeId } as any;
    const saved = await this.summarizeRecords(records, kind, scope, reason);
    if (!saved || !saved.text) return;

    if (cfg.memoryLearnPushBack === false) return;

    const text = saved.consolidated ? `刚整理了记忆：${saved.text}` : `刚记住了：${saved.text}`;
    try {
      if (kind === "private") {
        const bot = (kind === "private" && session?.bot) || null;
        const targetBot = bot || this.findBot();
        if (targetBot) await targetBot.sendMessage(scopeId, text, { userId: scopeId });
      } else {
        const targetBot = session?.bot || this.findBot();
        if (targetBot) await targetBot.sendMessage(scopeId, text, { guildId: scopeId, channelId: scopeId });
      }
    } catch (error: any) {
      this.host.logger?.warn?.(`[memory-learn] 回推失败 ${kind}:${scopeId}: ${String(error)}`);
    }
  }

  /** 把一批消息归纳成一条记忆并写入对应作用域；返回写入结果或 null */
  private async summarizeRecords(
    records: any[],
    kind: "group" | "private",
    scope: any,
    reason: string,
  ): Promise<{ text: string; consolidated: boolean; removed: number } | null> {
    const cfg: any = this.config || {};

    // 每日上限
    const day = new Date();
    const dayStamp = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
    const dailyKey = `${kind}:${scope.id}:${dayStamp}`;
    const limit = Math.max(1, Number(cfg.memoryLearnDailyLimit) || 30);
    const used = this.learnDaily.get(dailyKey) || 0;
    if (used >= limit) {
      this.host.logger?.info?.(`[memory-learn] 已达每日上限 ${limit}（${kind}:${scope.id}）`);
      return null;
    }

    const prompt = buildSummaryPrompt(records, { kind, selfName: this.selfName });
    let raw = "";
    try {
      const result = await this.provider.chat({
        system: prompt.system,
        user: prompt.user,
        temperature: 0.3,
        maxTokens: 400,
        model: String(cfg.memoryLearnModel || "").trim() || undefined,
      });
      if (!result || !result.ok) {
        this.host.logger?.warn?.(`[memory-learn] 归纳调用失败: ${result && result.error}`);
        return null;
      }
      raw = String(result.text || "");
      if (usageText(result.usage)) {
        this.host.logger?.info?.(`[memory-learn] 归纳 token ${usageText(result.usage)}（${kind}:${scope.id}）`);
      }
    } catch (error: any) {
      this.host.logger?.warn?.(`[memory-learn] 归纳异常: ${String(error)}`);
      return null;
    }

    const maxChars = Math.max(40, Number(cfg.memoryLearnMaxChars) || 150);
    let text = cleanSummary(raw, maxChars);
    if (!text) return null;

    // 去重
    let existing: string[] = [];
    try {
      const content = await (this.host as any).readMemoryFile(scope);
      existing = String(content || "")
        .split(/\r?\n---\r?\n/)
        .map((b: string) => b.trim())
        .filter(Boolean)
        .map((b: string) => b.split("\n").slice(1).join("\n").trim() || b);
    } catch {
      existing = [];
    }
    const threshold = Number(cfg.memoryLearnDuplicateThreshold) || 0.55;
    if (isDuplicate(text, existing, threshold)) {
      this.host.logger?.info?.(`[memory-learn] 跳过重复记忆（${kind}:${scope.id}）`);
      return null;
    }

    let saved: { text: string; consolidated: boolean; removed: number };
    try {
      saved = await this.saveLearnedMemory(kind, scope, text);
      this.learnDaily.set(dailyKey, used + 1);
    } catch (error: any) {
      this.host.logger?.warn?.(`[memory-learn] 写入失败: ${String(error)}`);
      return null;
    }

    this.host.logger?.info?.(
      `[memory-learn] 已记入 ${kind}:${scope.id}（${reason}） ${saved.text.length}字`
      + (saved.consolidated ? `，压缩 ${saved.removed} 条旧记忆 → 1` : ""),
    );
    return saved;
  }

  /**
   * 自动归纳写入策略（1.4.7+）：
   *   - 每累计 N 条（默认 5）就把最早的 N-1 条 + 本次新记忆压缩成 1 条；
   *   - 自动记忆总数超过上限（默认 15）时同样触发压缩；
   *   - 压缩失败时退回普通追加，不丢数据，下次归纳会再试。
   */
  private async saveLearnedMemory(
    kind: "group" | "private",
    scope: any,
    text: string,
  ): Promise<{ text: string; consolidated: boolean; removed: number }> {
    const cfg: any = this.config || {};
    const host: any = this.host;
    const canConsolidate = cfg.memoryLearnConsolidate !== false
      && typeof host.commitAutoMemory === "function";

    if (!canConsolidate) {
      await host.saveMemoryToFile("", text, scope, AUTO_MEMORY_LABEL);
      return { text, consolidated: false, removed: 0 };
    }

    const every = Math.max(2, Number(cfg.memoryLearnConsolidateEvery) || 5);
    const maxEntries = Math.max(1, Number(cfg.memoryLearnMaxEntries) || 15);
    const maxChars = Math.max(40, Number(cfg.memoryLearnConsolidateMaxChars) || 90);

    let autoBlocks: string[] = [];
    try {
      const content = await host.readMemoryFile(scope);
      autoBlocks = splitMemoryBlocks(content)
        .map((item) => item.text)
        .filter((item) => isAutoMemoryBlock(item));
    } catch {
      autoBlocks = [];
    }

    const projected = autoBlocks.length + 1;
    const reachedBatch = projected >= every;
    const reachedCap = projected > maxEntries && autoBlocks.length > 0;
    if (!reachedBatch && !reachedCap) {
      await host.commitAutoMemory(scope, { add: text, label: AUTO_MEMORY_LABEL });
      return { text, consolidated: false, removed: 0 };
    }

    // 常规：拿最早的 every-1 条 + 本次，正好 every 条压成 1 条
    const take = Math.max(1, Math.min(every - 1, autoBlocks.length));
    const remove = autoBlocks.slice(0, take);

    let stored = text;
    let consolidated = false;
    try {
      const merged = await this.consolidateMemories(kind, remove, text, maxChars);
      if (merged) {
        stored = merged;
        consolidated = true;
      }
    } catch (error: any) {
      this.host.logger?.warn?.(`[memory-learn] 压缩异常: ${String(error)}`);
    }

    await host.commitAutoMemory(scope, {
      add: stored,
      remove: consolidated ? remove : [],
      label: AUTO_MEMORY_LABEL,
    });
    return { text: stored, consolidated, removed: consolidated ? remove.length : 0 };
  }

  /** 调模型把若干条自动记忆压成一条更短的 */
  private async consolidateMemories(
    kind: "group" | "private",
    blocks: string[],
    fresh: string,
    maxChars: number,
  ): Promise<string> {
    const cfg: any = this.config || {};
    const marker = `## · ${AUTO_MEMORY_LABEL}`;
    const prompt = buildConsolidatePrompt([...blocks, `${marker}\n${fresh}`], { maxChars, kind });
    const result = await this.provider.chat({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
      maxTokens: Math.max(200, Math.min(500, maxChars * 5)),
      model: String(cfg.memoryLearnModel || "").trim() || undefined,
    });
    if (!result || !result.ok) {
      this.host.logger?.warn?.(`[memory-learn] 压缩调用失败: ${result?.error || "unknown"}`);
      return "";
    }
    return cleanSummary(String(result.text || ""), maxChars);
  }

  private findBot(): any {
    const bots = (this.host as any)?.ctx?.bots || (this.host as any)?.bots || [];
    return (bots || []).find((item: any) => item.platform === "onebot") || null;
  }

  // ---------------------------------------------------------------- 点名 / 跟随

  private isMention(session: any, record: ChatRecord): boolean {
    // 渲染阶段已经确认 @ 了 bot，不依赖 session.content 的序列化格式
    if (record.atBot) return true;
    const selfId = String(session?.bot?.selfId ?? session?.selfId ?? '');
    if (selfId) {
      const content = String(session?.content ?? '');
      if (content.includes(`<at id="${selfId}"`)) return true;
      const escaped = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\[CQ:at,[^\\]]*(?:qq|id)=${escaped}(?:,|\\])`, 'i').test(content)) return true;
    }
    // 只叫名字（不带 @）是否算点名，交给 aiEnableDirectMentionTrigger 控制
    if (this.config.aiEnableDirectMentionTrigger === false) return false;
    const name = this.selfName.toLowerCase();
    if (!name) return false;
    return String(record.text || '').toLowerCase().includes(name);
  }

  private addressesOthers(record: ChatRecord, session: any): boolean {
    const selfId = String(session?.bot?.selfId ?? '');
    return record.mentions.length > 0 && !record.mentions.includes(selfId);
  }

  private shouldContinueFollowup(record: ChatRecord, followup: FollowupState): boolean {
    const text = String(record.text || '').trim();
    if (!text) return false;
    if (this.isCommandLike(text)) return false;
    if (/^[/.!！#＃]/.test(text)) return false;
    if (text.length <= 2) return false;
    if (/^[\u{1F300}-\u{1FAFF}\s~～!！.。]+$/u.test(text)) return false;
    if (/(换个话题|换个问题|另外|题外话|不聊这个|先不说这个|说点别的|再问个新的)/.test(text)) return false;

    const current = tokenizeForMatch(text);
    const overlap = [...current].filter((token) => followup.anchorTokens.includes(token)).length;
    const ratio = overlap / Math.max(1, Math.min(current.size || 1, followup.anchorTokens.length || 1));
    if (text.length >= 8 && overlap === 0 && !/[?？]/.test(text)) return false;
    if (text.length >= 8 && ratio <= 0.12 && /[?？]/.test(text)) return false;

    if (/[?？]/.test(text)) return true;
    if (/(继续|然后|那|所以|为什么|怎么|如何|帮我|还能|可以吗|行吗|对不对|是不是|展开|多说|细说|具体|举个例子|还有呢|后来呢|说说|讲讲)/.test(text)) return true;
    // 没有话题交集、也不是明确的追问 → 不追着说，避免用户换话题后机器人自说自话
    if (overlap > 0 && ratio >= 0.18) return true;
    return false;
  }

  private startFollowup(state: GroupState, record: ChatRecord): void {
    if (this.config.aiEnableFollowupAfterMention === false) return;
    const seconds = Math.max(1, Number(this.config.aiFollowupWindowSeconds ?? 120));
    state.followup = {
      userId: record.userId,
      expiresAt: this.now() + seconds * 1000,
      turns: 0,
      anchorTokens: [...tokenizeForMatch(record.text)],
      lastText: record.text,
    };
  }

  private bumpFollowup(state: GroupState, record: ChatRecord): void {
    const followup = state.followup;
    if (!followup) return;
    followup.turns += 1;
    followup.lastText = record.text;
    const seconds = Math.max(1, Number(this.config.aiFollowupWindowSeconds ?? 120));
    followup.expiresAt = this.now() + seconds * 1000;
    const maxTurns = Math.max(1, Number(this.config.aiFollowupMaxTurns ?? 3));
    if (followup.turns >= maxTurns) state.followup = null;
  }

  private getFollowup(state: GroupState, record: ChatRecord, session: any): FollowupState | null {
    const followup = state.followup;
    if (!followup) return null;
    if (this.now() > followup.expiresAt) {
      state.followup = null;
      return null;
    }
    if (followup.userId !== record.userId) return null;
    if (this.addressesOthers(record, session)) {
      state.followup = null;
      return null;
    }
    return followup;
  }

  // ---------------------------------------------------------------- 记忆

  private async loadMemories(record: ChatRecord, state: GroupState, session?: any): Promise<string[]> {
    if (!this.config.enableMemory || this.config.memoryInAi === false) return [];
    let content = '';
    try {
      // 按作用域读对应文件：群聊读该群，私聊读该用户
      const scope = typeof (this.host as any).memoryScopeOf === 'function'
        ? (this.host as any).memoryScopeOf(session)
        : null;
      content = await this.host.readMemoryFile(scope);
    } catch {
      return [];
    }
    const blocks = splitMemoryBlocks(content);
    if (!blocks.length) return [];
    const recent = state.records.slice(-3).map((item) => item.text);
    const selected = selectMemoryBlocks(blocks, [record.text, ...recent], {
      limit: 3,
      minScore: 0.12,
      maxChars: 160,
    });
    return selected.map((item) => item.text);
  }

  // ---------------------------------------------------------------- 主流程

  /**
   * 被 @ 但处于模型调用冷却时，在群里提示还剩多久。
   *
   * 只发本地短句，不调用模型；同一群按 aiCooldownNoticeIntervalSeconds 限流，
   * 避免有人连续 @ 时刷屏。
   */
  private async sendCooldownNotice(session: any, state: GroupState, remainingMs: number): Promise<void> {
    if (this.setting(session, 'aiCooldownNotice') === false) return;
    const gap = Math.max(0, Number(this.config.aiCooldownNoticeIntervalSeconds ?? 20)) * 1000;
    const now = this.now();
    if (gap > 0 && now - (state.lastCooldownNoticeAt || 0) < gap) return;

    const seconds = Math.max(1, Math.ceil(Math.max(0, remainingMs) / 1000));
    const template = String(this.config.aiCooldownNoticeText || '还在冷却，{seconds} 秒后再叫我。');
    const text = template
      .replace(/\{seconds\}/g, String(seconds))
      .replace(/\{minutes\}/g, String(Math.ceil(seconds / 60)));
    if (!text.trim()) return;

    state.lastCooldownNoticeAt = now;
    try {
      if (typeof (this.host as any).sendNotice === 'function') {
        await (this.host as any).sendNotice(session, text);
      } else {
        await this.host.sendReply(session, text);
      }
      this.log('ai-cooldown-notice', { seconds, remainingMs }, session);
    } catch (error: any) {
      this.host.logger?.warn?.(`[ai] 冷却提示发送失败: ${String(error)}`);
    }
  }

  async handle(session: any): Promise<void> {
    const key = this.groupKey(session);
    if (!key) return;
    if (!this.resolveEnabled(session)) return;
    if (String(session.userId) === String(session.bot?.selfId ?? '')) return;
    if (session.platform && !this.platformAllowed(session.platform)) return;

    const state = this.state.get(key);
    const messageId = String(session.messageId ?? '');
    if (messageId && state.isDuplicate(`${session.platform}:${session.guildId}:${session.userId}:${messageId}`, this.now())) {
      return;
    }

    let record = messageId ? state.records.find((item) => item.id === messageId) : undefined;
    if (!record) record = (await this.record(session)) ?? undefined;
    if (!record) return;

    const mention = this.isMention(session, record);
    const followupState = mention ? null : this.getFollowup(state, record, session);
    const followup = !!followupState && this.shouldContinueFollowup(record, followupState);
    // 用户换了话题/说的和上一轮无关时，丢掉待续话题，避免机器人追着自己上一句说
    if (followupState && !followup) state.followup = null;

    const threshold = Math.max(1, Number(this.setting(session, 'aiMessageThreshold') ?? 15));
    const decision = decideTrigger({
      mode: (this.setting(session, 'aiReplyMode') || 'hybrid') as any,
      counter: state.counter,
      threshold,
      probability: Number(this.setting(session, 'aiRandomReplyProbability') ?? 0.08),
      now: this.now(),
      lastAttemptAt: state.lastAttemptAt,
      minIntervalMs: Math.max(0, Number(this.setting(session, 'aiMinReplyIntervalSeconds') ?? 45)) * 1000,
      inFlight: state.inFlight,
      mention,
      followup,
      rng: this.rng,
      pseudoRandom: this.setting(session, 'aiPseudoRandom') !== false,
      randomBoost: state.randomBoost,
      pseudoRandomStep: Math.max(0, Number(this.setting(session, 'aiPseudoRandomStep') ?? 0.01)),
    });
    // 伪随机加成只由「随机掷骰」更新：冷却/阈值跳过时保持不变
    if (typeof decision.nextBoost === 'number') state.randomBoost = decision.nextBoost;

    this.log('ai-trigger', {
      fire: decision.fire,
      reason: decision.reason,
      counter: state.counter,
      threshold,
      mention,
      followup,
      prob: decision.effectiveProbability,
      boost: state.randomBoost,
      ctx: state.records.length,
    }, session);
    if (!decision.fire) {
      if (decision.reason === 'cooldown-mention') {
        await this.sendCooldownNotice(session, state, decision.remainingMs || 0);
      }
      return;
    }

    state.inFlight = true;
    state.lastAttemptAt = this.now();
    const startedAt = this.now();

    try {
      const allowPass = !mention && !followup;
      const memories = await this.loadMemories(record, state, session);
      const hookCtx: AiHookContext = {
        session,
        groupId: String(session.guildId),
        mode: 'reply',
      };
      const styleSections = this.clampStyle(await this.hooks.collectSections(hookCtx));
      const personaOverride = await this.hooks.collectPersonaOverride(hookCtx);
      const webSearch = await this.webSearch(record, session);
      const promptInput = {
        selfName: this.selfName,
        persona: personaOverride || this.personaPrompt,
        groupId: String(session.guildId),
        records: this.clampContext(state.records),
        current: record,
        mention,
        followup,
        allowPass,
        memories,
        maxReplyChars: this.maxReplyChars,
        styleSections,
        webSearch,
        webSearchEnabled: this.config.aiWebSearchEnabled !== false,
      };

      const prompt = buildReplyPrompt(promptInput);
      if (this.debugPrompt) {
        this.host.logger.info(`[ai-debug] system=${prompt.system}\n[ai-debug] user=${prompt.user}`);
      }

      const images = await this.collectImages(session, record, state);
      const result = await this.provider.chat({
        system: prompt.system,
        user: prompt.user,
        images,
        temperature: Number(this.config.aiTemperature ?? 0.8),
        maxTokens: Number(this.config.aiMaxOutputTokens ?? 400),
      });

      if (!result.ok) {
        this.log('ai-reply', {
          ok: false,
          error: result.error,
          trigger: decision.reason,
          latencyMs: this.now() - startedAt,
        }, session);
        return;
      }

      if (result.finishReason === 'length') {
        const cap = Number(this.config.aiMaxOutputTokens ?? 1500);
        this.host.logger?.warn?.(
          `[ai-budget] 输出触达 max_tokens=${cap}（思考 + 回答总上限），正文可能被截断；`
          + `可在配置页调大 aiMaxOutputTokens | guild=${session.guildId ?? '?'}`,
        );
      }

      const raw = String(result.text || '').trim();
      if (!raw || PASS_RE.test(raw)) {
        state.counter = 0;
        this.log('ai-pass', {
          by: 'model',
          trigger: decision.reason,
          latencyMs: this.now() - startedAt,
        }, session);
        return;
      }

      let finalRaw = raw;
      if (!webSearch && this.shouldReviseWithSearch(raw)) {
        const revisedSearch = await this.webSearch(record, session, true);
        if (revisedSearch) {
          const revisedInput = { ...promptInput, webSearch: revisedSearch };
          const revisedUser = `${buildUserPrompt(revisedInput)}\n\n你刚才的回答是：「${truncate(finalRaw, 120)}」。现在补上了联网搜索结果，请根据结果重写最终回复；不要提“刚才/搜索/系统”，直接给答案。`;
          const revised = await this.provider.chat({
            system: prompt.system,
            user: revisedUser,
            images,
            temperature: Number(this.config.aiTemperature ?? 0.8),
            maxTokens: Number(this.config.aiMaxOutputTokens ?? 400),
          });
          if (revised.ok && revised.text && !PASS_RE.test(revised.text.trim())) {
            finalRaw = revised.text.trim();
            this.log('web-search', { ok: true, revised: true, query: buildSearchQuery(record.text) }, session);
          }
        }
      }

      const cleaned = cleanReply(finalRaw, this.selfName);      if (!cleaned) {
        state.counter = 0;
        return;
      }

      const filtered = await this.hooks.applyFilters(cleaned, hookCtx);
      if (filtered == null) {
        state.counter = 0;
        this.log('ai-pass', {
          by: 'filter',
          trigger: decision.reason,
          latencyMs: this.now() - startedAt,
        }, session);
        return;
      }

      const finalText = clipReply(filtered, this.maxReplyChars);
      if (!finalText) {
        state.counter = 0;
        return;
      }

      await this.host.sendReply(session, finalText);
      state.counter = 0;
      this.recordSelf(session, finalText);

      if (mention) this.startFollowup(state, record);
      else if (followup && state.followup) this.bumpFollowup(state, record);

      this.log('ai-reply', {
        ok: true,
        trigger: decision.reason,
        latencyMs: this.now() - startedAt,
        images: images.length,
        degradedToText: !!result.degradedToText,
        chars: finalText.length,
        tokens: usageText(result.usage) || undefined,
        preview: finalText.slice(0, 60),
      }, session);

      await this.hooks.runAfterReply({ ...hookCtx, text: finalText });
    } catch (error: any) {
      this.log('ai-reply', {
        ok: false,
        error: String(error?.message || error),
        trigger: decision.reason,
      }, session);
    } finally {
      state.inFlight = false;
      this.schedulePersist();
    }
  }

  /** 供外部插件（如私聊插件）复用同一个模型 provider。 */
  chat(request: any) {
    return this.provider.chat(request);
  }

  /** 群内长时间没人说话时，生成一条主动话题。 */
  async idleTopic(groupId: string): Promise<string> {
    const session = { guildId: groupId, isDirect: false, platform: 'onebot' };
    let sections: string[] = [];
    let personaOverride: string | null = null;
    try {
      const hookCtx = { session, groupId, mode: 'reply' as const };
      sections = this.clampStyle(await this.hooks.collectSections(hookCtx));
      personaOverride = await this.hooks.collectPersonaOverride(hookCtx);
    } catch { /* ignore */ }
    const system = [
      `你是 QQ 群 ${groupId} 里的一个普通成员。`,
      personaOverride || this.personaPrompt,
      '群里已经很久没人说话了。主动抛一个轻松、具体、能接话的话题，一句话。',
      '不要问“在吗”，不要提“很久没人说话”，不要自我介绍。',
      ...sections,
    ].filter(Boolean).join('\n');
    const result = await this.provider.chat({
      system,
      user: '现在发一条主动话题。',
      temperature: Number(this.config.aiTemperature ?? 0.8),
      maxTokens: Math.min(300, Number(this.config.aiMaxOutputTokens ?? 400)),
    });
    if (!result.ok || !result.text) return '';
    const raw = String(result.text).trim();
    if (!raw || PASS_RE.test(raw)) return '';
    return clipReply(cleanReply(raw, this.selfName), this.maxReplyChars)
      .replace(/\[表情[:：][^\]]*\]/g, '')
      .trim();
  }

  /** 需要时调用 DeepSeek Search API；失败/不支持/没结果都返回空串，继续普通回复。 */
  private async webSearch(record: ChatRecord, session: any, force = false): Promise<string> {
    if (this.config.aiWebSearchEnabled === false) return '';
    const mode = (this.config.aiWebSearchMode || 'auto') as WebSearchMode;
    if (mode === 'off') return '';
    const text = String(record.text || '');
    if (!force && !shouldWebSearch(text, mode)) return '';
    const query = buildSearchQuery(text);
    if (!query) return '';

    const now = this.now();
    if (this.searchUnsupportedUntil > now) return '';
    const groupId = String(session?.guildId || '');

    // 先查缓存：命中缓存不消耗搜索配额
    const cacheMinutes = Math.max(0, Number(this.config.aiWebSearchCacheMinutes ?? 10));
    const cacheKey = `${String(this.config.aiBaseUrl || '')}|${query}`;
    if (cacheMinutes > 0) {
      const hit = this.searchCache.get(cacheKey);
      if (hit && now - hit.at < cacheMinutes * 60_000) return hit.section;
    }

    const maxPerHour = Math.max(0, Number(this.config.aiWebSearchMaxPerHour ?? 30));
    if (maxPerHour > 0) {
      const list = (this.searchRate.get(groupId) || []).filter((t) => now - t < 3600_000);
      if (list.length >= maxPerHour) {
        const resetIn = Math.max(1, Math.ceil((list[0] + 3600_000 - now) / 1000));
        this.log('web-search', {
          ok: false,
          reason: 'rate-limit',
          limit: maxPerHour,
          resetIn,
          groupId,
        }, session);
        return '';
      }
      list.push(now);
      this.searchRate.set(groupId, list);
    }

    const startedAt = this.now();
    const outcome = await fetchWebSearch({
      query,
      apiKey: String(this.config.aiApiKey || ''),
      baseUrl: String(this.config.aiBaseUrl || 'https://api.deepseek.com'),
      maxResults: Number(this.config.aiWebSearchMaxResults ?? 5),
      timeoutMs: Number(this.config.aiWebSearchTimeoutMs ?? 4000),
      maxChars: 1800,
    }, this.fetchImpl);

    if (!outcome.ok) {
      // 400/401/403/404 通常意味着这个 API 不支持 Search；10 分钟内不再重试
      if (/^http-(400|401|403|404)$/.test(outcome.reason || '')) {
        this.searchUnsupportedUntil = now + 10 * 60_000;
      }
      this.log('web-search', {
        ok: false,
        reason: outcome.reason,
        query,
        latencyMs: this.now() - startedAt,
      }, session);
      return '';
    }

    if (cacheMinutes > 0) {
      this.searchCache.set(cacheKey, { at: now, section: outcome.section || '' });
      if (this.searchCache.size > 100) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest) this.searchCache.delete(oldest);
      }
    }
    this.log('web-search', {
      ok: true,
      results: outcome.results?.length || 0,
      query,
      latencyMs: this.now() - startedAt,
    }, session);
    return outcome.section || '';
  }

  /** 模型自己都说不知道/搜不了时，补一次搜索再重写；只在不认识的问题上多一次调用。 */
  private shouldReviseWithSearch(raw: string): boolean {
    if (this.config.aiWebSearchEnabled === false) return false;
    if (String(this.config.aiWebSearchMode || 'auto') === 'off') return false;
    return /(不知道|记不清|记不准|记不牢|不敢乱说|说岔|没法上网|查不了|搜不了|没有联网|无法联网|不确定|不太清楚|分不清|瞎猜)/.test(raw);
  }

  /** 读取合并转发的子消息，压成一行行文本；读不到就返回空串。 */
  private async readForwards(session: any, forwards: any[]): Promise<string> {
    if (this.config.aiReadForwardMessage === false) return '';
    if (!Array.isArray(forwards) || !forwards.length) return '';
    const limit = Math.max(1, Math.min(50, Number(this.config.aiForwardMaxNodes ?? 20)));
    const onebot = this.host.getOneBotApi(session);
    if (!onebot?.getForwardMsg) return '';
    const blocks: string[] = [];
    for (const item of forwards.slice(0, 3)) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      try {
        const data = await onebot.getForwardMsg(id);
        const messages = Array.isArray(data?.messages) ? data.messages
          : (Array.isArray(data?.message) ? data.message : (Array.isArray(data) ? data : []));
        for (const node of messages.slice(0, limit)) {
          const sender = String(node?.sender?.card || node?.sender?.nickname || node?.nickname || node?.name || '').trim();
          const content = Array.isArray(node?.message)
            ? node.message.filter((seg: any) => seg?.type === 'text').map((seg: any) => String(seg?.data?.text ?? '')).join('')
            : String(node?.content ?? node?.raw_message ?? node?.message ?? '');
          const text = content.replace(/\[CQ:[^\]]+\]/g, '[图片]').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          blocks.push(`${sender ? `${sender}: ` : ''}${truncate(text, 160)}`);
        }
      } catch (error) {
        this.log('forward', { ok: false, error: String(error) }, session);
      }
    }
    if (!blocks.length) return '';
    this.log('forward', { ok: true, nodes: blocks.length }, session);
    return blocks.join('\n');
  }

  private recentImageRecords(state: GroupState, record: ChatRecord, maxAgeMs = 120000): RenderedImage[] {
    const cutoff = Number(record.at) - maxAgeMs;
    const candidates = state.records
      .filter((item) => (
        !item.self
        && item.id !== record.id
        && item.userId === record.userId
        && item.images.length > 0
        && Number(item.at) >= cutoff
      ))
      .slice(-4)
      .reverse();
    const out: RenderedImage[] = [];
    for (const item of candidates) {
      for (const image of item.images) out.push(image);
    }
    return out;
  }

  private async collectImages(session: any, record: ChatRecord, state: GroupState): Promise<string[]> {
    if (this.config.aiEnableImageRecognition === false) return [];
    const maxCount = Math.max(0, Number(this.config.aiImageMaxCount ?? 2));
    if (!maxCount) return [];

    const own = record.images.length ? record.images : this.host.extractImages(session);
    // 用户常见的“先发图，再单独 @ 一句”：当前消息没有图，回看同一用户最近 2 分钟内的图
    const fallback = own.length ? [] : this.recentImageRecords(state, record);
    let quoted: RenderedImage[] = record.quote
      ? (record.quote.images?.length ? record.quote.images : this.host.extractImages(session?.quote))
      : [];
    // 引用消息里没解析到图（常见于 quote 只带 messageId）：用 get_msg 回查一次
    if (!quoted.length && record.quote?.id && typeof this.host.fetchQuotedImages === 'function') {
      quoted = await this.host.fetchQuotedImages(session, record.quote);
    }
    const items = pickImages([...own, ...fallback], quoted, maxCount);
    if (!items.length) return [];

    return resolveImages(
      items,
      (ref) => this.host.resolveImage(ref, session),
      { maxCount, budgetMs: Number(this.config.aiImageBudgetMs ?? 6000) },
    );
  }

  /**
   * 供外部插件（qqgm-private）复用：把一条私聊消息里的图片解析成 data URL。
   * 不做上下文回看，只看当前消息本身。
   */
  async resolveSessionImages(session: any): Promise<string[]> {
    if (this.config.aiEnableImageRecognition === false) return [];
    const maxCount = Math.max(0, Number(this.config.aiImageMaxCount ?? 2));
    if (!maxCount) return [];
    let own: RenderedImage[] = [];
    try {
      own = this.host.extractImages(session) || [];
    } catch {
      own = [];
    }
    if (!own.length) return [];
    return resolveImages(
      own,
      (ref) => this.host.resolveImage(ref, session),
      { maxCount, budgetMs: Number(this.config.aiImageBudgetMs ?? 6000) },
    );
  }

  private platformAllowed(platform: string): boolean {
    const list = Array.isArray(this.config.platformFilter) ? this.config.platformFilter : ['onebot'];
    return list.includes(platform);
  }

  private log(event: string, data: Record<string, any>, session: any): void {
    const extra = Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : value}`)
      .join(' ');
    this.host.logger.info(
      `[${event}] ${extra} | platform=${session?.platform ?? '?'} user=${session?.userId ?? '?'} guild=${session?.guildId ?? '?'}`,
    );
  }

  /** 供指令/调试使用 */
  displayNameFor(session: any, qq: string): Promise<string> {
    return this.names.display(session, qq);
  }

  clear(): void {
    this.state.clear();
    this.names.clear();
    this.flushPersistedState();
  }
}
