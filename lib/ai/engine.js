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
const trigger_1 = require("./trigger");
const prompt_1 = require("./prompt");
const provider_1 = require("./provider");
const vision_1 = require("./vision");
const memory_1 = require("./memory");
const names_1 = require("../core/names");
const text_1 = require("../core/text");
const hooks_1 = require("./hooks");
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
    host;
    config;
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
        return String(persona?.selfName || this.config.aiAgentName || 'MeowBot').trim() || 'MeowBot';
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
            mentions: rendered.mentions,
            atBot: rendered.atBot,
            self: false,
            at: Number(session.timestamp) || this.now(),
        };
        state.push(record, contextWindow);
        state.counter += 1;
        return record;
    }
    /** 追加一条系统注记（复读等），不进计数、不触发 */
    note(text, groupKey, session) {
        const key = groupKey || (session ? this.groupKey(session) : '');
        if (!key || !text?.trim())
            return;
        const state = this.state.get(key);
        state.push({
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
    }
    /** 机器人自己发出的消息：写回上下文，解决"说完就忘" */
    recordSelf(session, text) {
        const key = this.groupKey(session);
        if (!key || !text?.trim())
            return;
        const state = this.state.get(key);
        state.push({
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
    async loadMemories(record, state) {
        if (!this.config.enableMemory || this.config.memoryInAi === false)
            return [];
        let content = '';
        try {
            content = await this.host.readMemoryFile();
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
            const memories = await this.loadMemories(record, state);
            const hookCtx = {
                session,
                groupId: String(session.guildId),
                mode: 'reply',
            };
            const styleSections = await this.hooks.collectSections(hookCtx);
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
            const cleaned = cleanReply(raw, this.selfName);
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
        const quoted = record.quote ? this.host.extractImages(session?.quote) : [];
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
