"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiEngine = void 0;
const state_1 = require("./state");
const learn_1 = require("./learn");
const trigger_1 = require("./trigger");
const prompt_1 = require("./prompt");
const provider_1 = require("./provider");
const vision_1 = require("./vision");
const memory_1 = require("./memory");
const names_1 = require("../core/names");
const text_1 = require("../core/text");
const hooks_1 = require("./hooks");
const websearch_1 = require("./websearch");
const PASS_RE = /^\s*<(?:pass\s*\/?|不回复)>/i;
function cleanReply(text, selfName) {
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
    if (/^[“"「].*[”"」]$/.test(out))
        out = out.slice(1, -1).trim();
    return out.replace(/\s+/g, ' ').trim();
}
function clipReply(text, maxChars) {
    const max = Math.max(20, maxChars || 120);
    if (text.length <= max)
        return text;
    const slice = text.slice(0, max);
    const boundary = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'), slice.lastIndexOf('，'), slice.lastIndexOf(';'), slice.lastIndexOf('；'));
    if (boundary >= max * 0.5)
        return slice.slice(0, boundary + 1);
    return `${slice}…`;
}
class AiEngine {
    state;
    /** 外部插件扩展点：提示词风格段 + 输出过滤 */
    hooks;
    provider;
    names;
    rng;
    now;
    fetchImpl;
    host;
    config;
    searchCache = new Map();
    searchRate = new Map();
    searchUnsupportedUntil = 0;
    /** 自动归纳：按作用域累计被挤出的消息 */
    learnStore = new learn_1.LearnStore();
    /** 自动归纳：每个作用域每天的次数，防刷额度 */
    learnDaily = new Map();
    /** 自动归纳：空闲兜底定时器 */
    learnTimer = null;
    constructor(host, deps = {}) {
        this.host = host;
        this.config = host.config;
        this.state = deps.state ?? new state_1.AiState();
        this.hooks = new hooks_1.AiHookRegistry(host.logger);
        this.provider = deps.provider ?? new provider_1.ChatProvider(host.config, host.logger);
        this.names = new names_1.NameResolver({
            getOneBotApi: (session) => host.getOneBotApi(session),
            toGroupId: (session) => host.toGroupId(session),
            logger: host.logger,
        });
        this.rng = deps.rng ?? Math.random;
        this.now = deps.now ?? Date.now;
        this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
        // 空闲兜底：消息量迟迟不满阈值时，超时后归纳一次
        this.startLearnTimer();
    }
    // ---------------------------------------------------------------- 配置
    groupKey(session) {
        if (!session?.guildId)
            return '';
        return `${session.platform ?? 'unknown'}:${session.guildId}`;
    }
    ruleFor(session) {
        const guildId = String(session?.guildId ?? '');
        const rules = Array.isArray(this.config.groupRules) ? this.config.groupRules : [];
        return rules.find((item) => String(item?.guildId ?? '').trim() === guildId);
    }
    resolveEnabled(session) {
        const rule = this.ruleFor(session);
        const requireRule = this.config.aiReplyRequireGroupRule !== false;
        if (requireRule && !rule)
            return false;
        if (rule && typeof rule.enableAiReply === 'boolean')
            return rule.enableAiReply;
        return !!this.config.enableAiReply;
    }
    get contextWindow() {
        const value = Number(this.config.aiContextWindow ?? 24);
        return Math.max(6, Math.min(100, Number.isFinite(value) ? value : 24));
    }
    get selfName() {
        const persona = this.activePersona();
        return String(persona?.selfName || this.config.aiAgentName || 'bot').trim() || 'bot';
    }
    activePersona() {
        const id = String(this.config.aiActivePersona ?? '').trim();
        if (!id)
            return null;
        const list = Array.isArray(this.config.aiPersonas) ? this.config.aiPersonas : [];
        return list.find((item) => String(item?.id ?? '').trim() === id) ?? null;
    }
    get personaPrompt() {
        const persona = this.activePersona();
        return String(persona?.prompt || this.config.aiSystemPrompt || '').trim();
    }
    get maxReplyChars() {
        const value = Number(this.config.aiMaxReplyChars ?? 120);
        return Math.max(20, Math.min(500, Number.isFinite(value) ? value : 120));
    }
    get debugPrompt() {
        return !!this.config.aiDebugPrompt;
    }
    // ---------------------------------------------------------------- 记录
    /** 是否像指令（这类消息不进上下文，避免污染） */
    isCommandLike(text) {
        const value = String(text || '').trim();
        if (!value)
            return false;
        if (/^[/.!！#＃]/.test(value))
            return true;
        if (/^\[[^\]\s]+\]/.test(value))
            return true;
        const prefixes = [this.config.command, this.config.menuCommand, 'help']
            .map((item) => String(item ?? '').trim())
            .filter(Boolean);
        return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix} `));
    }
    /** 记录一条群消息；返回落库后的记录（指令类返回 null） */
    async record(session) {
        const key = this.groupKey(session);
        if (!key || !session?.userId)
            return null;
        if (String(session.userId) === String(session.bot?.selfId ?? ''))
            return null;
        const state = this.state.get(key);
        const messageId = String(session.messageId ?? '');
        if (messageId) {
            const existing = state.records.find((item) => item.id === messageId);
            if (existing)
                return existing;
        }
        const contextWindow = this.contextWindow;
        // 先排除指令，避免为指令解析 @ / 查群名片
        const rawText = String(session.content ?? '').trim();
        if (this.isCommandLike(rawText.replace(/^\s*(<at\b[^>]*\/?>|\[CQ:at,[^\]]+\])\s*/i, ''))) {
            return null;
        }
        const identity = await this.names.identify(session);
        const rendered = await (0, text_1.renderMessage)(session, this.names.resolverFor(session), {
            selfId: String(session.bot?.selfId ?? session.selfId ?? ''),
        });
        const record = {
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
        return record;
    }
    /** 追加一条系统注记（复读等），不进计数、不触发 */
    note(text, groupKey, session) {
        const key = groupKey || (session ? this.groupKey(session) : '');
        if (!key || !text?.trim())
            return;
        const state = this.state.get(key);
        const evicted = state.push({
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
        }, this.contextWindow);
        this.emitEvicted(evicted, groupKey, session);
    }
    /** 机器人自己发出的消息：写回上下文，解决"说完就忘" */
    recordSelf(session, text) {
        const key = this.groupKey(session);
        if (!key || !text?.trim())
            return;
        const state = this.state.get(key);
        const evicted = state.push({
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
        }, this.contextWindow);
        this.emitEvicted(evicted, key, session);
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
    emitEvicted(evicted, groupKey, session) {
        if (!evicted || !evicted.length)
            return;
        const isDirect = session?.isDirect === true || !session?.guildId;
        const guildId = String(session?.guildId || "");
        const userId = String(session?.userId || "");
        const kind = isDirect ? "private" : "group";
        const scopeId = isDirect ? userId : guildId;
        if (!scopeId)
            return;
        const cfg = this.config || {};
        // ---------- 1) 分发给外部插件 ----------
        if (this.hooks && typeof this.hooks.runContextEvicted === "function") {
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
                .catch((error) => {
                this.host.logger?.warn?.(`[ai-evicted] 分发失败: ${String(error)}`);
            });
        }
        // ---------- 2) 内建自动归纳 ----------
        if (!cfg.memoryAutoLearn)
            return;
        if (!cfg.enableMemory || cfg.memoryAutoLearn === false)
            return;
        if (!this.resolveEnabled(session))
            return;
        const allow = Array.isArray(cfg.memoryAutoLearnGroups) ? cfg.memoryAutoLearnGroups.map(String) : [];
        if (allow.length && !allow.includes(guildId) && !allow.includes(userId))
            return;
        const bucket = this.learnStore.get(kind, scopeId);
        const threshold = Math.max(1, Math.round(this.contextWindow * (Number(cfg.memoryLearnThresholdScale) || 1)));
        const fire = bucket.push(evicted, threshold, this.now());
        if (fire) {
            void this.learnAndReport(kind, scopeId, bucket, "threshold", session);
        }
    }
    /** 归纳并（可选）回推到原会话 */
    /** 启动空闲兜底定时器；每 5 分钟检查一次 */
    startLearnTimer() {
        if (this.learnTimer)
            return;
        const cfg = this.config || {};
        if (!cfg.memoryAutoLearn)
            return;
        const idleHours = Math.max(1, Number(cfg.memoryLearnIdleHours) || 8);
        const idleMs = idleHours * 60 * 60 * 1000;
        this.learnTimer = setInterval(() => {
            try {
                const pending = this.learnStore.idleList(this.now(), idleMs);
                for (const item of pending) {
                    void this.learnAndReport(item.kind, item.scopeId, item.bucket, "idle");
                }
            }
            catch (error) {
                this.host.logger?.warn?.(`[memory-learn] 空闲检查失败: ${String(error)}`);
            }
        }, 5 * 60 * 1000);
        if (this.learnTimer.unref)
            this.learnTimer.unref();
    }
    /** 资源清理：停止定时器、清空缓存 */
    dispose() {
        if (this.learnTimer) {
            clearInterval(this.learnTimer);
            this.learnTimer = null;
        }
        this.learnStore.clear();
        this.learnDaily.clear();
        this.searchCache.clear();
        this.searchRate.clear();
    }
    async learnAndReport(kind, scopeId, bucket, reason, session) {
        const cfg = this.config || {};
        const records = bucket.drain();
        if (!records.length)
            return;
        const scope = { kind, id: scopeId };
        const summary = await this.summarizeRecords(records, kind, scope, reason);
        if (!summary)
            return;
        if (cfg.memoryLearnPushBack === false)
            return;
        const text = `刚记住了：${summary}`;
        try {
            if (kind === "private") {
                const bot = (kind === "private" && session?.bot) || null;
                const targetBot = bot || this.findBot();
                if (targetBot)
                    await targetBot.sendMessage(scopeId, text, { userId: scopeId });
            }
            else {
                const targetBot = session?.bot || this.findBot();
                if (targetBot)
                    await targetBot.sendMessage(scopeId, text, { guildId: scopeId, channelId: scopeId });
            }
        }
        catch (error) {
            this.host.logger?.warn?.(`[memory-learn] 回推失败 ${kind}:${scopeId}: ${String(error)}`);
        }
    }
    /** 把一批消息归纳成一条记忆并写入对应作用域；返回归纳文本或空 */
    async summarizeRecords(records, kind, scope, reason) {
        const cfg = this.config || {};
        // 每日上限
        const day = new Date();
        const dayStamp = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
        const dailyKey = `${kind}:${scope.id}:${dayStamp}`;
        const limit = Math.max(1, Number(cfg.memoryLearnDailyLimit) || 30);
        const used = this.learnDaily.get(dailyKey) || 0;
        if (used >= limit) {
            this.host.logger?.info?.(`[memory-learn] 已达每日上限 ${limit}（${kind}:${scope.id}）`);
            return "";
        }
        const prompt = (0, learn_1.buildSummaryPrompt)(records, { kind, selfName: this.selfName });
        let raw = "";
        try {
            const result = await this.provider.chat({
                system: prompt.system,
                user: prompt.user,
                temperature: 0.3,
                maxTokens: 400,
            });
            if (!result || !result.ok) {
                this.host.logger?.warn?.(`[memory-learn] 归纳调用失败: ${result && result.error}`);
                return "";
            }
            raw = String(result.text || "");
        }
        catch (error) {
            this.host.logger?.warn?.(`[memory-learn] 归纳异常: ${String(error)}`);
            return "";
        }
        const maxChars = Math.max(40, Number(cfg.memoryLearnMaxChars) || 150);
        let text = (0, learn_1.cleanSummary)(raw, maxChars);
        if (!text)
            return "";
        // 去重
        let existing = [];
        try {
            const content = await this.host.readMemoryFile(scope);
            existing = String(content || "")
                .split(/\r?\n---\r?\n/)
                .map((b) => b.trim())
                .filter(Boolean)
                .map((b) => b.split("\n").slice(1).join("\n").trim() || b);
        }
        catch {
            existing = [];
        }
        const threshold = Number(cfg.memoryLearnDuplicateThreshold) || 0.55;
        if ((0, learn_1.isDuplicate)(text, existing, threshold)) {
            this.host.logger?.info?.(`[memory-learn] 跳过重复记忆（${kind}:${scope.id}）`);
            return "";
        }
        try {
            await this.host.saveMemoryToFile("", text, scope, "自动归纳");
            this.learnDaily.set(dailyKey, used + 1);
        }
        catch (error) {
            this.host.logger?.warn?.(`[memory-learn] 写入失败: ${String(error)}`);
            return "";
        }
        this.host.logger?.info?.(`[memory-learn] 已记入 ${kind}:${scope.id}（${reason}） ${text.length}字`);
        return text;
    }
    findBot() {
        const bots = this.host?.ctx?.bots || this.host?.bots || [];
        return (bots || []).find((item) => item.platform === "onebot") || null;
    }
    // ---------------------------------------------------------------- 点名 / 跟随
    isMention(session, record) {
        // 渲染阶段已经确认 @ 了 bot，不依赖 session.content 的序列化格式
        if (record.atBot)
            return true;
        const selfId = String(session?.bot?.selfId ?? session?.selfId ?? '');
        if (selfId) {
            const content = String(session?.content ?? '');
            if (content.includes(`<at id="${selfId}"`))
                return true;
            const escaped = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`\\[CQ:at,[^\\]]*(?:qq|id)=${escaped}(?:,|\\])`, 'i').test(content))
                return true;
        }
        // 只叫名字（不带 @）是否算点名，交给 aiEnableDirectMentionTrigger 控制
        if (this.config.aiEnableDirectMentionTrigger === false)
            return false;
        const name = this.selfName.toLowerCase();
        if (!name)
            return false;
        return String(record.text || '').toLowerCase().includes(name);
    }
    addressesOthers(record, session) {
        const selfId = String(session?.bot?.selfId ?? '');
        return record.mentions.length > 0 && !record.mentions.includes(selfId);
    }
    shouldContinueFollowup(record, followup) {
        const text = String(record.text || '').trim();
        if (!text)
            return false;
        if (this.isCommandLike(text))
            return false;
        if (/^[/.!！#＃]/.test(text))
            return false;
        if (text.length <= 2)
            return false;
        if (/^[\u{1F300}-\u{1FAFF}\s~～!！.。]+$/u.test(text))
            return false;
        if (/(换个话题|换个问题|另外|题外话|不聊这个|先不说这个|说点别的|再问个新的)/.test(text))
            return false;
        const current = (0, memory_1.tokenizeForMatch)(text);
        const overlap = [...current].filter((token) => followup.anchorTokens.includes(token)).length;
        const ratio = overlap / Math.max(1, Math.min(current.size || 1, followup.anchorTokens.length || 1));
        if (text.length >= 8 && overlap === 0 && !/[?？]/.test(text))
            return false;
        if (text.length >= 8 && ratio <= 0.12 && /[?？]/.test(text))
            return false;
        if (/[?？]/.test(text))
            return true;
        if (/(继续|然后|那|所以|为什么|怎么|如何|帮我|还能|可以吗|行吗|对不对|是不是|展开|多说|细说|具体|举个例子|还有呢|后来呢|说说|讲讲)/.test(text))
            return true;
        // 没有话题交集、也不是明确的追问 → 不追着说，避免用户换话题后机器人自说自话
        if (overlap > 0 && ratio >= 0.18)
            return true;
        return false;
    }
    startFollowup(state, record) {
        if (this.config.aiEnableFollowupAfterMention === false)
            return;
        const seconds = Math.max(1, Number(this.config.aiFollowupWindowSeconds ?? 120));
        state.followup = {
            userId: record.userId,
            expiresAt: this.now() + seconds * 1000,
            turns: 0,
            anchorTokens: [...(0, memory_1.tokenizeForMatch)(record.text)],
            lastText: record.text,
        };
    }
    bumpFollowup(state, record) {
        const followup = state.followup;
        if (!followup)
            return;
        followup.turns += 1;
        followup.lastText = record.text;
        const seconds = Math.max(1, Number(this.config.aiFollowupWindowSeconds ?? 120));
        followup.expiresAt = this.now() + seconds * 1000;
        const maxTurns = Math.max(1, Number(this.config.aiFollowupMaxTurns ?? 3));
        if (followup.turns >= maxTurns)
            state.followup = null;
    }
    getFollowup(state, record, session) {
        const followup = state.followup;
        if (!followup)
            return null;
        if (this.now() > followup.expiresAt) {
            state.followup = null;
            return null;
        }
        if (followup.userId !== record.userId)
            return null;
        if (this.addressesOthers(record, session)) {
            state.followup = null;
            return null;
        }
        return followup;
    }
    // ---------------------------------------------------------------- 记忆
    async loadMemories(record, state, session) {
        if (!this.config.enableMemory || this.config.memoryInAi === false)
            return [];
        let content = '';
        try {
            // 按作用域读对应文件：群聊读该群，私聊读该用户
            const scope = typeof this.host.memoryScopeOf === 'function'
                ? this.host.memoryScopeOf(session)
                : null;
            content = await this.host.readMemoryFile(scope);
        }
        catch {
            return [];
        }
        const blocks = (0, memory_1.splitMemoryBlocks)(content);
        if (!blocks.length)
            return [];
        const recent = state.records.slice(-3).map((item) => item.text);
        const selected = (0, memory_1.selectMemoryBlocks)(blocks, [record.text, ...recent], {
            limit: 3,
            minScore: 0.12,
            maxChars: 160,
        });
        return selected.map((item) => item.text);
    }
    // ---------------------------------------------------------------- 主流程
    async handle(session) {
        const key = this.groupKey(session);
        if (!key)
            return;
        if (!this.resolveEnabled(session))
            return;
        if (String(session.userId) === String(session.bot?.selfId ?? ''))
            return;
        if (session.platform && !this.platformAllowed(session.platform))
            return;
        const state = this.state.get(key);
        const messageId = String(session.messageId ?? '');
        if (messageId && state.isDuplicate(`${session.platform}:${session.guildId}:${session.userId}:${messageId}`, this.now())) {
            return;
        }
        let record = messageId ? state.records.find((item) => item.id === messageId) : undefined;
        if (!record)
            record = (await this.record(session)) ?? undefined;
        if (!record)
            return;
        const mention = this.isMention(session, record);
        const followupState = mention ? null : this.getFollowup(state, record, session);
        const followup = !!followupState && this.shouldContinueFollowup(record, followupState);
        // 用户换了话题/说的和上一轮无关时，丢掉待续话题，避免机器人追着自己上一句说
        if (followupState && !followup)
            state.followup = null;
        const threshold = Math.max(1, Number(this.config.aiMessageThreshold ?? 15));
        const decision = (0, trigger_1.decideTrigger)({
            mode: (this.config.aiReplyMode || 'hybrid'),
            counter: state.counter,
            threshold,
            probability: Number(this.config.aiRandomReplyProbability ?? 0.08),
            now: this.now(),
            lastAttemptAt: state.lastAttemptAt,
            minIntervalMs: Math.max(0, Number(this.config.aiMinReplyIntervalSeconds ?? 45)) * 1000,
            lastReplyAt: state.lastReplyAt || 0,
            mentionCooldownMs: Math.max(0, Number(this.config.aiMentionCooldownSeconds ?? 5)) * 1000,
            inFlight: state.inFlight,
            mention,
            followup,
            rng: this.rng,
        });
        this.log('ai-trigger', {
            fire: decision.fire,
            reason: decision.reason,
            counter: state.counter,
            threshold,
            mention,
            followup,
            ctx: state.records.length,
        }, session);
        if (!decision.fire)
            return;
        state.inFlight = true;
        state.lastAttemptAt = this.now();
        const startedAt = this.now();
        try {
            const allowPass = !mention && !followup;
            const memories = await this.loadMemories(record, state, session);
            const hookCtx = {
                session,
                groupId: String(session.guildId),
                mode: 'reply',
            };
            const styleSections = await this.hooks.collectSections(hookCtx);
            const webSearch = await this.webSearch(record, session);
            const promptInput = {
                selfName: this.selfName,
                persona: this.personaPrompt,
                groupId: String(session.guildId),
                records: state.records,
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
            if (allowPass && this.config.aiReplyDecision === 'two-stage') {
                const judge = await this.judge(promptInput);
                if (!judge) {
                    state.counter = 0;
                    this.log('ai-pass', { by: 'judge', latencyMs: this.now() - startedAt }, session);
                    return;
                }
            }
            const prompt = (0, prompt_1.buildReplyPrompt)(promptInput);
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
                    const revisedUser = `${(0, prompt_1.buildUserPrompt)(revisedInput)}\n\n你刚才的回答是：「${(0, text_1.truncate)(finalRaw, 120)}」。现在补上了联网搜索结果，请根据结果重写最终回复；不要提“刚才/搜索/系统”，直接给答案。`;
                    const revised = await this.provider.chat({
                        system: prompt.system,
                        user: revisedUser,
                        images,
                        temperature: Number(this.config.aiTemperature ?? 0.8),
                        maxTokens: Number(this.config.aiMaxOutputTokens ?? 400),
                    });
                    if (revised.ok && revised.text && !PASS_RE.test(revised.text.trim())) {
                        finalRaw = revised.text.trim();
                        this.log('web-search', { ok: true, revised: true, query: (0, websearch_1.buildSearchQuery)(record.text) }, session);
                    }
                }
            }
            const cleaned = cleanReply(finalRaw, this.selfName);
            if (!cleaned) {
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
            state.lastReplyAt = this.now();
            state.counter = 0;
            this.recordSelf(session, finalText);
            if (mention)
                this.startFollowup(state, record);
            else if (followup && state.followup)
                this.bumpFollowup(state, record);
            this.log('ai-reply', {
                ok: true,
                trigger: decision.reason,
                latencyMs: this.now() - startedAt,
                images: images.length,
                degradedToText: !!result.degradedToText,
                chars: finalText.length,
                preview: finalText.slice(0, 60),
            }, session);
            await this.hooks.runAfterReply({ ...hookCtx, text: finalText });
        }
        catch (error) {
            this.log('ai-reply', {
                ok: false,
                error: String(error?.message || error),
                trigger: decision.reason,
            }, session);
        }
        finally {
            state.inFlight = false;
        }
    }
    /** 供外部插件（如私聊插件）复用同一个模型 provider。 */
    chat(request) {
        return this.provider.chat(request);
    }
    /** 群内长时间没人说话时，生成一条主动话题。 */
    async idleTopic(groupId) {
        const session = { guildId: groupId, isDirect: false, platform: 'onebot' };
        let sections = [];
        try {
            sections = await this.hooks.collectSections({ session, groupId, mode: 'reply' });
        }
        catch { /* ignore */ }
        const system = [
            `你是 QQ 群 ${groupId} 里的一个普通成员。`,
            '群里已经很久没人说话了。主动抛一个轻松、具体、能接话的话题，一句话。',
            '不要问“在吗”，不要提“很久没人说话”，不要自我介绍。',
            ...sections,
        ].join('\n');
        const result = await this.provider.chat({
            system,
            user: '现在发一条主动话题。',
            temperature: Number(this.config.aiTemperature ?? 0.8),
            maxTokens: Math.min(300, Number(this.config.aiMaxOutputTokens ?? 400)),
        });
        if (!result.ok || !result.text)
            return '';
        const raw = String(result.text).trim();
        if (!raw || PASS_RE.test(raw))
            return '';
        return clipReply(cleanReply(raw, this.selfName), this.maxReplyChars)
            .replace(/\[表情[:：][^\]]*\]/g, '')
            .trim();
    }
    /** 需要时调用 DeepSeek Search API；失败/不支持/没结果都返回空串，继续普通回复。 */
    async webSearch(record, session, force = false) {
        if (this.config.aiWebSearchEnabled === false)
            return '';
        const mode = (this.config.aiWebSearchMode || 'auto');
        if (mode === 'off')
            return '';
        const text = String(record.text || '');
        if (!force && !(0, websearch_1.shouldWebSearch)(text, mode))
            return '';
        const query = (0, websearch_1.buildSearchQuery)(text);
        if (!query)
            return '';
        const now = this.now();
        if (this.searchUnsupportedUntil > now)
            return '';
        const groupId = String(session?.guildId || '');
        const maxPerHour = Math.max(0, Number(this.config.aiWebSearchMaxPerHour ?? 10));
        if (maxPerHour > 0) {
            const list = (this.searchRate.get(groupId) || []).filter((t) => now - t < 3600_000);
            if (list.length >= maxPerHour) {
                this.log('web-search', { ok: false, reason: 'rate-limit', groupId }, session);
                return '';
            }
            list.push(now);
            this.searchRate.set(groupId, list);
        }
        const cacheMinutes = Math.max(0, Number(this.config.aiWebSearchCacheMinutes ?? 10));
        const cacheKey = `${String(this.config.aiBaseUrl || '')}|${query}`;
        if (cacheMinutes > 0) {
            const hit = this.searchCache.get(cacheKey);
            if (hit && now - hit.at < cacheMinutes * 60_000)
                return hit.section;
        }
        const startedAt = this.now();
        const outcome = await (0, websearch_1.fetchWebSearch)({
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
                if (oldest)
                    this.searchCache.delete(oldest);
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
    shouldReviseWithSearch(raw) {
        if (this.config.aiWebSearchEnabled === false)
            return false;
        if (String(this.config.aiWebSearchMode || 'auto') === 'off')
            return false;
        return /(不知道|记不清|记不准|记不牢|不敢乱说|说岔|没法上网|查不了|搜不了|没有联网|无法联网|不确定|不太清楚|分不清|瞎猜)/.test(raw);
    }
    /** 读取合并转发的子消息，压成一行行文本；读不到就返回空串。 */
    async readForwards(session, forwards) {
        if (this.config.aiReadForwardMessage === false)
            return '';
        if (!Array.isArray(forwards) || !forwards.length)
            return '';
        const limit = Math.max(1, Math.min(50, Number(this.config.aiForwardMaxNodes ?? 20)));
        const onebot = this.host.getOneBotApi(session);
        if (!onebot?.getForwardMsg)
            return '';
        const blocks = [];
        for (const item of forwards.slice(0, 3)) {
            const id = String(item?.id || '').trim();
            if (!id)
                continue;
            try {
                const data = await onebot.getForwardMsg(id);
                const messages = Array.isArray(data?.messages) ? data.messages
                    : (Array.isArray(data?.message) ? data.message : (Array.isArray(data) ? data : []));
                for (const node of messages.slice(0, limit)) {
                    const sender = String(node?.sender?.card || node?.sender?.nickname || node?.nickname || node?.name || '').trim();
                    const content = Array.isArray(node?.message)
                        ? node.message.filter((seg) => seg?.type === 'text').map((seg) => String(seg?.data?.text ?? '')).join('')
                        : String(node?.content ?? node?.raw_message ?? node?.message ?? '');
                    const text = content.replace(/\[CQ:[^\]]+\]/g, '[图片]').replace(/\s+/g, ' ').trim();
                    if (!text)
                        continue;
                    blocks.push(`${sender ? `${sender}: ` : ''}${(0, text_1.truncate)(text, 160)}`);
                }
            }
            catch (error) {
                this.log('forward', { ok: false, error: String(error) }, session);
            }
        }
        if (!blocks.length)
            return '';
        this.log('forward', { ok: true, nodes: blocks.length }, session);
        return blocks.join('\n');
    }
    recentImageRecords(state, record, maxAgeMs = 120000) {
        const cutoff = Number(record.at) - maxAgeMs;
        const candidates = state.records
            .filter((item) => (!item.self
            && item.id !== record.id
            && item.userId === record.userId
            && item.images.length > 0
            && Number(item.at) >= cutoff))
            .slice(-4)
            .reverse();
        const out = [];
        for (const item of candidates) {
            for (const image of item.images)
                out.push(image);
        }
        return out;
    }
    async collectImages(session, record, state) {
        if (this.config.aiEnableImageRecognition === false)
            return [];
        const maxCount = Math.max(0, Number(this.config.aiImageMaxCount ?? 2));
        if (!maxCount)
            return [];
        const own = record.images.length ? record.images : this.host.extractImages(session);
        // 用户常见的“先发图，再单独 @ 一句”：当前消息没有图，回看同一用户最近 2 分钟内的图
        const fallback = own.length ? [] : this.recentImageRecords(state, record);
        let quoted = record.quote
            ? (record.quote.images?.length ? record.quote.images : this.host.extractImages(session?.quote))
            : [];
        // 引用消息里没解析到图（常见于 quote 只带 messageId）：用 get_msg 回查一次
        if (!quoted.length && record.quote?.id && typeof this.host.fetchQuotedImages === 'function') {
            quoted = await this.host.fetchQuotedImages(session, record.quote);
        }
        const items = (0, vision_1.pickImages)([...own, ...fallback], quoted, maxCount);
        if (!items.length)
            return [];
        return (0, vision_1.resolveImages)(items, (ref) => this.host.resolveImage(ref, session), { maxCount, budgetMs: Number(this.config.aiImageBudgetMs ?? 6000) });
    }
    async judge(input) {
        const prompt = (0, prompt_1.buildJudgePrompt)(input);
        const result = await this.provider.chat({
            system: prompt.system,
            user: prompt.user,
            temperature: 0.1,
            maxTokens: 256,
        });
        if (!result.ok || !result.text)
            return false;
        const match = result.text.match(/\{[\s\S]*\}/);
        if (!match)
            return false;
        try {
            const parsed = JSON.parse(match[0]);
            const score = Number(parsed?.score) || 0;
            const min = Number(this.config.aiInterestMinScore ?? 60);
            return !!parsed?.reply && score >= min;
        }
        catch {
            return false;
        }
    }
    platformAllowed(platform) {
        const list = Array.isArray(this.config.platformFilter) ? this.config.platformFilter : ['onebot'];
        return list.includes(platform);
    }
    log(event, data, session) {
        const extra = Object.entries(data)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : value}`)
            .join(' ');
        this.host.logger.info(`[${event}] ${extra} | platform=${session?.platform ?? '?'} user=${session?.userId ?? '?'} guild=${session?.guildId ?? '?'}`);
    }
    /** 供指令/调试使用 */
    displayNameFor(session, qq) {
        return this.names.display(session, qq);
    }
    clear() {
        this.state.clear();
        this.names.clear();
    }
}
exports.AiEngine = AiEngine;
