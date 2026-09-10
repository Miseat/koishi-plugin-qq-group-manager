"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QQGroupManagerService = void 0;
const koishi_1 = require("koishi");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFile = (0, node_util_1.promisify)(node_child_process_1.execFile);
class QQGroupManagerService extends koishi_1.Service {
    ctx;
    config;
    _logger;
    unauthorizedMuteAttempts = new Map();
    menuPairings = new Map();
    aiBuffers = new Map();
    aiCounters = new Map();
    aiLastReplyAt = new Map();
    aiInFlight = new Set();
    aiHandledEvents = new Map();
    aiFollowups = new Map();
    aiUserMemory = new Map();
    repeatStates = new Map();
    aiTopicMemory = new Map();
    pendingJoinRequests = new Map();
    pendingJoinRequestFlags = new Map();
    violationRecords = new Map();
    _imageDataUrlCache = new Map();
    constructor(ctx, config) {
        super(ctx, 'nestimQqGroupManager', true);
        this.ctx = ctx;
        this.config = config;
        this._logger = ctx.logger('nestim-qq-group-manager');
        ctx.on('message', (session) => this.handleGroupModeration(session));
        ctx.on('guild-member-request', (session) => this.handleGuildMemberRequest(session));
    }
    isPlatformAllowed(platform) {
        return !!platform && this.config.platformFilter.includes(platform);
    }
    sessionTag(session) {
        if (!session)
            return 'platform=unknown user=unknown guild=unknown';
        return `platform=${session.platform ?? 'unknown'} user=${session.userId ?? 'unknown'} guild=${session.guildId ?? 'private'}`;
    }
    styleText(text) {
        return this.config.responseStyle === 'meow' ? `喵~ ${text}` : text;
    }
    escapeHtml(source) {
        return source
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    collectCategories(session) {
        const list = this.ctx.$commander._commandList;
        const available = session ? new Set(this.ctx.$commander.available(session)) : null;
        const categories = new Map();
        const getDesc = (command) => {
            const key = `commands.${command.name}.description`;
            const localized = session?.text?.(key);
            if (typeof localized === 'string' && localized && localized !== key)
                return localized;
            const rawDesc = command.toJSON?.().description;
            return typeof rawDesc === 'string' ? rawDesc : '';
        };
        const getRoot = (command) => {
            let node = command;
            while (node?.parent)
                node = node.parent;
            return node;
        };
        const getDepth = (command) => {
            let depth = 0;
            let node = command;
            while (node?.parent) {
                depth += 1;
                node = node.parent;
            }
            return depth;
        };
        for (const command of list) {
            if (!command.parent)
                continue;
            const root = getRoot(command);
            if (!root)
                continue;
            if (available && !available.has(command.name) && !available.has(command.displayName || ''))
                continue;
            const key = root.name;
            if (!categories.has(key)) {
                categories.set(key, {
                    key,
                    title: root.displayName || key,
                    desc: getDesc(root),
                    children: [],
                });
            }
            const category = categories.get(key);
            if (!category)
                continue;
            const depth = getDepth(command);
            if (depth !== 1)
                continue;
            const desc = getDesc(command);
            const display = command.displayName || command.name;
            category.children.push({ name: display, desc });
        }
        if (!categories.size) {
            for (const command of list) {
                if (command.parent)
                    continue;
                categories.set(command.name, {
                    key: command.name,
                    title: command.displayName || command.name,
                    desc: getDesc(command),
                    children: [],
                });
            }
        }
        for (const category of categories.values()) {
            category.children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        }
        const miscChildren = [];
        for (const command of list) {
            if (command.parent)
                continue;
            if (available && !available.has(command.name) && !available.has(command.displayName || ''))
                continue;
            const hasChildren = list.some((item) => item.parent === command);
            if (hasChildren)
                continue;
            miscChildren.push({ name: command.displayName || command.name, desc: getDesc(command) });
        }
        if (miscChildren.length) {
            miscChildren.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
            categories.set('other', {
                key: 'other',
                title: '其它',
                desc: '无父指令的功能集合',
                children: miscChildren,
            });
        }
        return [...categories.values()].sort((a, b) => {
            if (a.key === 'other' && b.key !== 'other')
                return 1;
            if (b.key === 'other' && a.key !== 'other')
                return -1;
            return a.title.localeCompare(b.title, 'zh-CN');
        });
    }
    resolveMenuCategory(keyword, session) {
        const query = keyword?.trim().toLowerCase();
        if (!query)
            return null;
        const norm = query.replace(/\s+/g, '');
        const categories = this.collectCategories(session);
        return categories.find((cat) => {
            const k = cat.key.toLowerCase();
            const t = cat.title.toLowerCase();
            const tk = `${t}菜单`;
            const kk = `${k}菜单`;
            return k === norm || t === norm || tk === norm || kk === norm || k.includes(norm) || t.includes(norm);
        }) ?? null;
    }
    pairingKey(session) {
        if (!session?.userId)
            return '';
        const scope = session.guildId || session.channelId || 'private';
        return `${session.platform}:${scope}:${session.userId}`;
    }
    armMenuPairing(session, ttlMs = 30_000) {
        const key = this.pairingKey(session);
        if (!key)
            return;
        this.menuPairings.set(key, Date.now() + ttlMs);
    }
    getMessageText(session) {
        const raw = session?.content ?? '';
        return raw
            .replace(/\[CQ:[^\]]+\]/g, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    aiGroupKey(session) {
        if (!session?.guildId)
            return '';
        return `${session.platform ?? 'unknown'}:${session.guildId}`;
    }
    resolveAiEnabled(session) {
        const guildId = this.normalizeGuildId(session.guildId);
        const rule = this.config.groupRules.find((item) => this.normalizeGuildId(item.guildId) === guildId);
        if (typeof rule?.enableAiReply === 'boolean')
            return rule.enableAiReply;
        return this.config.enableAiReply;
    }
    extractAiMessageText(session) {
        const text = this.getMessageText(session)
            .replace(/\s+/g, ' ')
            .trim();
        return text;
    }
    getMemoryFilePath() {
        const base = (this.ctx && this.ctx.baseDir) || process.cwd();
        const name = (this.config.memoryFileName || 'Memory.md').trim();
        return node_path_1.default.resolve(base, name);
    }
    async readMemoryFile() {
        const p = this.getMemoryFilePath();
        try {
            return await node_fs_1.default.promises.readFile(p, 'utf8');
        }
        catch {
            return '';
        }
    }
    async writeMemoryFile(content) {
        const p = this.getMemoryFilePath();
        await node_fs_1.default.promises.writeFile(p, String(content), 'utf8');
    }
    extractMemoryBlocks(content) {
        return String(content)
            .split(/\r?\n---\r?\n/)
            .map((b) => b.trim())
            .filter(Boolean);
    }
    async saveMemoryToFile(userId, content) {
        const now = new Date();
        const stamp = now.toLocaleString('zh-CN', { hour12: false });
        const block = `## ${stamp} · 用户 ${userId || 'unknown'}\n${String(content).trim()}`;
        const existing = (await this.readMemoryFile()).trim();
        const next = existing ? `${existing}\n\n---\n\n${block}\n` : `${block}\n`;
        await this.writeMemoryFile(next);
        return block;
    }
    async searchMemory(keyword, limit = 8) {
        const blocks = this.extractMemoryBlocks(await this.readMemoryFile());
        const kw = String(keyword || '').trim();
        if (!kw)
            return blocks.slice(-limit);
        return blocks.filter((b) => b.includes(kw)).slice(-limit);
    }
    async decoratePromptWithMemory(prompt, options) {
        if (!this.config.enableMemory || this.config.memoryInAi === false)
            return prompt;
        const keyword = (options?.focusText || options?.topicSummary || '').trim();
        let results = await this.searchMemory(keyword, 6);
        // 关键词没命中时（中文分词易漏），退而注入最近记忆，由模型自行判断相关性
        if (!results.length && keyword)
            results = await this.searchMemory('', 6);
        if (!results.length)
            return prompt;
        const memoryLines = results.map((b, i) => `${i + 1}. ${b.replace(/\n+/g, ' ').trim().slice(0, 140)}`).join('\n');
        return `${prompt}\n\n【记忆库参考】（若与当前话题相关可引用；不相关请忽略，不要编造，不要暴露"系统记忆"字样）：\n${memoryLines}\n`;
    }
    async handleMemoryCommand(session) {
        if (!this.config.enableMemory)
            return false;
        if (!session?.userId)
            return false;
        const text = this.getMessageText(session);
        const saveMatch = text.match(/^\[记忆\]\s*[：:]?\s*([\s\S]+)$/);
        if (saveMatch) {
            const content = saveMatch[1].trim();
            if (!content) {
                await session.send(this.styleText('用法：发送 [记忆]+内容 来保存一条记忆。'));
                return true;
            }
            try {
                await this.saveMemoryToFile(session.userId, content);
                await session.send(this.styleText('已记住。'));
                this.logCommandResult('memory-save', { ok: true, message: 'memory saved' }, session, { content });
            }
            catch (error) {
                await session.send(this.styleText(`记忆保存失败: ${String(error)}`));
                this.logCommandResult('memory-save', { ok: false, message: String(error) }, session, { content });
            }
            return true;
        }
        const queryMatch = text.match(/^\[记忆查询\]\s*[：:]?\s*([\s\S]*)$/);
        if (queryMatch) {
            const keyword = queryMatch[1].trim();
            const results = await this.searchMemory(keyword, 8);
            if (!results.length) {
                await session.send(this.styleText(keyword ? `没有找到包含「${keyword}」的记忆。` : '记忆库为空或没有可显示的记录。'));
                return true;
            }
            const reply = results.map((b, i) => `${i + 1}. ${b.replace(/\n+/g, ' ').trim()}`).join('\n');
            await session.send(this.styleText(`记忆内容：\n${reply}`));
            return true;
        }
        const listMatch = text.match(/^\[记忆(?:列表|全部|看)\]$/);
        if (listMatch) {
            const results = await this.searchMemory('', 8);
            if (!results.length) {
                await session.send(this.styleText('记忆库为空。'));
                return true;
            }
            const reply = results.map((b, i) => `${i + 1}. ${b.replace(/\n+/g, ' ').trim()}`).join('\n');
            await session.send(this.styleText(`最近的记忆：\n${reply}`));
            return true;
        }
        const deleteMatch = text.match(/^\[记忆删除\]\s*[：:]?\s*([\s\S]+)$/);
        if (deleteMatch) {
            const keyword = deleteMatch[1].trim();
            const existing = await this.readMemoryFile();
            const blocks = this.extractMemoryBlocks(existing);
            const kept = blocks.filter((b) => !b.includes(keyword));
            if (kept.length === blocks.length) {
                await session.send(this.styleText(`没有找到包含「${keyword}」的记忆可删除。`));
                return true;
            }
            await this.writeMemoryFile(kept.length ? `${kept.join('\n\n---\n\n')}\n` : '');
            await session.send(this.styleText(`已删除包含「${keyword}」的记忆（${blocks.length - kept.length} 条）。`));
            return true;
        }
        return false;
    }
    getDisplayName(session) {
        return session.username?.trim()
            || session.author?.nick?.trim()
            || session.author?.nickname?.trim()
            || session.userId
            || 'unknown';
    }
    isHomeUser(session) {
        const ownerPlatform = this.config.aiOwnerPlatform?.trim() || this.config.aiHomePlatform?.trim();
        const ownerUserId = this.config.aiOwnerUserId?.trim() || this.config.aiHomeUserId?.trim();
        if (!ownerPlatform || !ownerUserId)
            return false;
        return session.platform === ownerPlatform && session.userId === ownerUserId;
    }
    rememberUser(session) {
        if (!session.userId)
            return;
        const key = `${session.platform ?? 'unknown'}:${session.userId}`;
        this.aiUserMemory.set(key, {
            platform: session.platform ?? 'unknown',
            userId: session.userId,
            name: this.getDisplayName(session),
            isHomeUser: this.isHomeUser(session),
            updatedAt: Date.now(),
        });
        if (this.aiUserMemory.size > 2048) {
            const expireBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;
            for (const [id, item] of this.aiUserMemory) {
                if (item.updatedAt < expireBefore)
                    this.aiUserMemory.delete(id);
            }
        }
    }
    getFollowupSession(groupKey) {
        const state = this.aiFollowups.get(groupKey);
        if (!state)
            return null;
        if (Date.now() > state.expiresAt) {
            this.aiFollowups.delete(groupKey);
            return null;
        }
        return state;
    }
    tokenizeTopic(text) {
        const normalized = text
            .toLowerCase()
            .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
            .trim();
        if (!normalized)
            return [];
        return [...new Set(normalized.split(/\s+/g).filter((item) => item.length >= 2))].slice(0, 24);
    }
    scoreTopicRelevance(text, topicTokens) {
        if (!topicTokens.length)
            return 0;
        const tokens = this.tokenizeTopic(text);
        if (!tokens.length)
            return 0;
        const overlap = tokens.filter((token) => topicTokens.includes(token)).length;
        if (!overlap)
            return 0;
        return overlap / Math.max(1, Math.min(tokens.length, topicTokens.length));
    }
    startFollowupSession(groupKey, userId, anchorText) {
        if (!this.config.aiEnableFollowupAfterMention)
            return;
        const seconds = Math.max(1, this.config.aiFollowupWindowSeconds || 120);
        this.aiFollowups.set(groupKey, {
            userId,
            turns: 0,
            expiresAt: Date.now() + seconds * 1000,
            anchorTokens: this.tokenizeTopic(anchorText),
            lastText: anchorText,
        });
    }
    bumpFollowupSession(groupKey) {
        const state = this.getFollowupSession(groupKey);
        if (!state)
            return;
        state.turns += 1;
        const seconds = Math.max(1, this.config.aiFollowupWindowSeconds || 120);
        state.expiresAt = Date.now() + seconds * 1000;
        const maxTurns = Math.max(1, this.config.aiFollowupMaxTurns || 3);
        if (state.turns >= maxTurns) {
            this.aiFollowups.delete(groupKey);
            return;
        }
        this.aiFollowups.set(groupKey, state);
    }
    shouldContinueFollowup(text, state) {
        const value = text.trim();
        if (!value)
            return false;
        if (/^[/.!！#＃]/.test(value))
            return false;
        if (value.length <= 2)
            return false;
        if (/^[\u{1F300}-\u{1FAFF}\s~～!！.。]+$/u.test(value))
            return false;
        const shiftMarker = /(换个话题|换个问题|另外|题外话|不聊这个|先不说这个|说点别的|再问个新的|顺便问)/.test(value);
        if (shiftMarker)
            return false;
        if (/(何意|何意味|hyw|什么意思|啥意思|怎么回事|发生了什么)/.test(value))
            return true;
        if (state?.anchorTokens?.length) {
            const current = this.tokenizeTopic(value);
            if (current.length) {
                const overlap = current.filter((token) => state.anchorTokens.includes(token)).length;
                const ratio = overlap / Math.max(1, Math.min(current.length, state.anchorTokens.length));
                // Topic drift: almost no overlap with the original mentioned topic.
                if (value.length >= 8 && overlap === 0)
                    return false;
                if (value.length >= 8 && ratio <= 0.12 && /[?？]/.test(value))
                    return false;
            }
        }
        if (/[?？]/.test(value))
            return true;
        if (/(继续|然后|再|那|所以|为什么|怎么|如何|帮我|请问|还能|可以吗|行吗|能否)/.test(value))
            return true;
        return value.length >= 8;
    }
    getActivePersona() {
        const id = this.config.aiActivePersona?.trim();
        if (!id)
            return null;
        return this.config.aiPersonas.find((item) => item.id?.trim() === id) ?? null;
    }
    getActiveAgentName() {
        const persona = this.getActivePersona();
        const fromPersona = persona?.selfName?.trim();
        if (fromPersona)
            return fromPersona;
        return this.config.aiAgentName?.trim() || 'MeowBot';
    }
    getActiveSystemPrompt() {
        const persona = this.getActivePersona();
        const fromPersona = persona?.prompt?.trim();
        if (fromPersona)
            return fromPersona;
        return this.config.aiSystemPrompt?.trim() || '你是群聊中的友好机器人，请简洁、自然、符合中文互联网语境地回复。';
    }
    containsAgentName(text) {
        const agentName = this.getActiveAgentName();
        if (!agentName)
            return false;
        return text.toLowerCase().includes(agentName.toLowerCase());
    }
    isMentionBot(session) {
        const selfId = session.bot?.selfId;
        if (!selfId)
            return false;
        const content = session.content ?? '';
        if (content.includes(`<at id="${selfId}"`))
            return true;
        const escaped = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cqAt = new RegExp(`\\[CQ:at,[^\\]]*(qq|id)=${escaped}(?:,|\\])`, 'i');
        return cqAt.test(content);
    }
    isCommandLikeMessage(text) {
        const value = text.trim();
        if (!value)
            return false;
        if (/^[/.!！#＃]/.test(value))
            return true;
        const prefixes = [this.config.command, this.config.menuCommand, 'help', 'status']
            .map((item) => item?.trim())
            .filter(Boolean);
        return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix} `) || value === `${prefix}菜单`);
    }
    isDuplicateAiEvent(session) {
        if (!session.messageId)
            return false;
        const key = `${session.platform ?? 'unknown'}:${session.guildId ?? 'private'}:${session.userId ?? 'unknown'}:${session.messageId}`;
        const now = Date.now();
        const previous = this.aiHandledEvents.get(key) ?? 0;
        this.aiHandledEvents.set(key, now);
        const expireBefore = now - 120_000;
        if (this.aiHandledEvents.size > 512) {
            for (const [id, ts] of this.aiHandledEvents) {
                if (ts < expireBefore)
                    this.aiHandledEvents.delete(id);
            }
        }
        return previous > 0 && now - previous < 15_000;
    }
    pushAiRecord(session, text) {
        const key = this.aiGroupKey(session);
        if (!key || !session.userId)
            return;
        const name = session.username?.trim()
            || session.author?.nick?.trim()
            || session.author?.nickname?.trim()
            || session.userId;
        const record = {
            userId: session.userId,
            name,
            text,
            imageUrls: this.extractImageUrls(session),
            timestamp: Date.now(),
        };
        const current = this.aiBuffers.get(key) ?? [];
        current.push(record);
        const maxWindow = Math.max(6, this.config.aiContextWindow || 24);
        const next = current.slice(-maxWindow);
        this.aiBuffers.set(key, next);
        this.aiCounters.set(key, (this.aiCounters.get(key) ?? 0) + 1);
    }
    appendAiContextNote(groupKey, text) {
        if (!groupKey || !text.trim())
            return;
        const current = this.aiBuffers.get(groupKey) ?? [];
        current.push({
            userId: 'system',
            name: '系统',
            text,
            imageUrls: [],
            timestamp: Date.now(),
        });
        const maxWindow = Math.max(6, this.config.aiContextWindow || 24);
        this.aiBuffers.set(groupKey, current.slice(-maxWindow));
    }
    shouldTriggerAiReply(session, forceMention = false) {
        const key = this.aiGroupKey(session);
        if (!key)
            return { ok: false, reason: 'no-group' };
        const now = Date.now();
        const last = this.aiLastReplyAt.get(key) ?? 0;
        const minIntervalMs = Math.max(0, this.config.aiMinReplyIntervalSeconds || 0) * 1000;
        if (!forceMention && now - last < minIntervalMs)
            return { ok: false, reason: 'cooldown' };
        if (this.aiInFlight.has(key))
            return { ok: false, reason: 'in-flight' };
        if (forceMention)
            return { ok: true, reason: 'direct-mention' };
        const mode = this.config.aiReplyMode;
        const messageCount = this.aiCounters.get(key) ?? 0;
        const threshold = Math.max(1, this.config.aiMessageThreshold || 1);
        const thresholdHit = (mode === 'threshold' || mode === 'hybrid') && messageCount >= threshold;
        if (thresholdHit)
            return { ok: true, reason: `threshold(${messageCount}/${threshold})` };
        if (mode === 'threshold')
            return { ok: false, reason: 'not-triggered' };
        return { ok: true, reason: 'interest-check' };
    }
    parseInterestDecision(raw) {
        const text = raw.trim();
        if (!text)
            return { reply: false, score: 0, reason: 'empty' };
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const candidate = jsonMatch ? jsonMatch[0] : text;
        try {
            const parsed = JSON.parse(candidate);
            const reply = !!parsed.reply;
            const score = Number.isFinite(parsed.score) ? Number(parsed.score) : 0;
            return { reply, score: Math.max(0, Math.min(100, score)), reason: parsed.reason || '' };
        }
        catch {
            const lowered = text.toLowerCase();
            const reply = lowered.includes('true') || lowered.includes('yes');
            const scoreMatch = lowered.match(/(\d{1,3})/);
            const score = scoreMatch ? Math.max(0, Math.min(100, Number(scoreMatch[1]))) : 0;
            return { reply, score, reason: 'parse-fallback' };
        }
    }
    buildInterestContextPrompt(groupKey, currentText, window = 8, extras = {}) {
        const size = Math.max(4, Math.min(16, window));
        const records = (this.aiBuffers.get(groupKey) ?? []).slice(-size);
        const lines = records.map((item, idx) => {
            const imageHint = item.imageUrls?.length ? ` [图片:${item.imageUrls.length}张]` : '';
            const content = item.text?.trim() || '[图片消息]';
            return `${idx + 1}. ${item.name}(${item.userId}): ${content}${imageHint}`;
        });
        const topicHint = (this.aiTopicMemory.get(groupKey)?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const currentHint = extras.hasSticker
            ? '（当前消息是表情包/贴纸，没有文字。表情包是常见的互动方式，可以顺势接梗或回应其情绪，不要因为"没有文字"就直接判定为无价值。）'
            : (extras.hasImage
                ? '（当前消息含图片，没有文字。图片内容是重要的可回应素材，可以描述或调侃画面内容。）'
                : '');
        const prompt = [
            `当前消息：${currentText || '[空文本]'}`,
            currentHint,
            topicHint ? `当前群话题参考：${topicHint}` : '',
            `最近上下文（最多${size}条）：`,
            ...(lines.length ? lines : ['(无历史上下文)']),
            '判定要点：表情包/图片本身就是群聊中正常的互动内容，尤其是当对方在回应你刚才的发言时，应当积极接话。',
            '只有在明显与你无关、且属于无意义刷屏时才选择不回复。不要仅因为「没有文字」就压低评分。',
        ].filter(Boolean).join('\n');
        return { prompt, ctxSize: lines.length, topicHint };
    }
    async decideInterestByOpenAI(contextPrompt) {
        const apiKey = this.config.aiApiKey?.trim();
        if (!apiKey)
            return { reply: false, score: 0, reason: 'no-api-key' };
        const base = (this.config.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = this.config.aiModel?.trim();
        if (!model)
            return { reply: false, score: 0, reason: 'no-model' };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 18_000);
        try {
            const response = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.15,
                    // deepseek-flash 等带思考的模型会先消耗 reasoning tokens，
                    // 额度太小会导致 content 为空（finish_reason=length），判定直接失效
                    max_tokens: 512,
                    messages: [
                        {
                            role: 'system',
                            content: '你是群聊回复开关决策器。只输出 JSON: {"reply":boolean,"score":0-100,"reason":"..."}。除 JSON 外不输出任何文字。',
                        },
                        {
                            role: 'user',
                            content: `请判断是否值得回复这条消息。表情包/图片是群聊中正常的互动内容，不要因为「没有文字」就判定为无价值；仅在与本群无关且明显无意义刷屏时才不回复。以下是消息与上下文：\n${contextPrompt}`,
                        },
                    ],
                }),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            const choice = payload?.choices?.[0];
            const content = choice?.message?.content;
            if (!response.ok)
                return { reply: false, score: 0, reason: `http-${response.status}` };
            let plain = typeof content === 'string'
                ? content
                : Array.isArray(content)
                    ? content.map((item) => item?.text || '').join('')
                    : '';
            // 兜底：若仍为空（思考模型额度被截断），从 reasoning_content 里捞 JSON
            if (!plain.trim()) {
                const reasoning = String(choice?.message?.reasoning_content || '');
                const jsonLike = reasoning.match(/\{[\s\S]*\}/);
                if (jsonLike)
                    plain = jsonLike[0];
                if (!plain.trim()) {
                    this._logger.warn(`[ai-interest] 判定返回空内容 finish=${choice?.finish_reason} reasoningTokens=${payload?.usage?.completion_tokens_details?.reasoning_tokens} | ${this.sessionTag?.('') ?? ''}`);
                    return { reply: false, score: 0, reason: `empty(finish=${choice?.finish_reason || 'unknown'})` };
                }
            }
            return this.parseInterestDecision(plain);
        }
        catch {
            return { reply: false, score: 0, reason: 'request-failed' };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async decideInterestByGemini(contextPrompt) {
        const apiKey = this.config.aiApiKey?.trim();
        if (!apiKey)
            return { reply: false, score: 0, reason: 'no-api-key' };
        const model = this.config.aiModel?.trim();
        if (!model)
            return { reply: false, score: 0, reason: 'no-model' };
        const rawBase = (this.config.aiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
        const base = /\/v\d/i.test(rawBase) ? rawBase : `${rawBase}/v1beta`;
        const endpoint = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 18_000);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: '你是群聊回复开关决策器。只输出 JSON: {"reply":boolean,"score":0-100,"reason":"..."}。除 JSON 外不输出任何文字。' }],
                    },
                    contents: [{ role: 'user', parts: [{ text: `请判断是否值得回复这条消息。表情包/图片是群聊中正常的互动内容，不要因为「没有文字」就判定为无价值；仅在与本群无关且明显无意义刷屏时才不回复。以下是消息与上下文：\n${contextPrompt}` }] }],
                    generationConfig: {
                        temperature: 0.15,
                        // 带思考的模型会先消耗思考 token，额度太小会导致正文为空
                        maxOutputTokens: 512,
                    },
                }),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok)
                return { reply: false, score: 0, reason: `http-${response.status}` };
            const plain = (payload?.candidates?.[0]?.content?.parts ?? [])
                .map((item) => item?.text || '')
                .join('');
            return this.parseInterestDecision(plain);
        }
        catch {
            return { reply: false, score: 0, reason: 'request-failed' };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async shouldReplyByInterest(params) {
        const context = this.buildInterestContextPrompt(params.groupKey, params.text, this.config.aiInterestContextWindow || 8, {
            hasSticker: !!params.hasSticker,
            hasImage: !!params.hasImage,
        });
        const decision = this.config.aiProvider === 'gemini'
            ? await this.decideInterestByGemini(context.prompt)
            : await this.decideInterestByOpenAI(context.prompt);
        const threshold = Math.max(0, Math.min(100, this.config.aiInterestMinScore ?? 82));
        return {
            ok: decision.reply && decision.score >= threshold,
            score: decision.score,
            reason: decision.reason,
            threshold,
            ctxSize: context.ctxSize,
            topicHint: context.topicHint,
        };
    }
    buildAiUserPrompt(records, options) {
        const scored = records.map((item, index) => ({ item, index, score: this.scoreTopicRelevance(item.text, options?.topicTokens ?? []) }));
        const renderLine = (item, idx, score) => {
            const imageHint = item.imageUrls.length ? ` [图片:${item.imageUrls.length}张]` : '';
            const relHint = typeof score === 'number' && options?.thresholdMode && (options?.topicTokens?.length ?? 0) > 0
                ? ` [相关度:${score.toFixed(2)}]`
                : '';
            return `${idx + 1}. ${item.name}(${item.userId}): ${item.text}${imageHint}${relHint}`;
        };
        const ordered = options?.thresholdMode && (options?.topicTokens?.length ?? 0) > 0
            ? [...scored].sort((a, b) => b.score - a.score || a.index - b.index)
            : scored;
        let lines = ordered.map((entry, idx) => renderLine(entry.item, idx, entry.score));
        const selectedIndex = options?.selectedRecord
            ? records.findIndex((item) => item === options.selectedRecord)
            : -1;
        if (options?.thresholdMode && selectedIndex >= 0) {
            const start = Math.max(0, selectedIndex - 2);
            const end = Math.min(records.length, selectedIndex + 3);
            const local = records.slice(start, end);
            lines = local.map((item, idx) => renderLine(item, idx, this.scoreTopicRelevance(item.text, options?.topicTokens ?? [])));
        }
        const selfName = this.getActiveAgentName();
        const thresholdFocus = options?.thresholdMode && options?.selectedRecord
            ? [
                'SELECTED_TARGET_BEGIN',
                `${options.selectedRecord.name}(${options.selectedRecord.userId}): ${options.selectedRecord.text}`,
                'SELECTED_TARGET_END',
                'FORBIDDEN: 不要优先回复最后一条，除非与选定目标是同一对象同一问题。',
            ].join('\n')
            : '';
        const focusLine = options?.focusText
            ? `当前点名消息来自 ${options.focusUserName || '某用户'}(${options.focusUserId || 'unknown'})：${options.focusText}`
            : (thresholdFocus || '请从下面的聊天记录中选择一条你认为最值得回应的消息并回复。');
        const formatHint = '只输出最终要发送到群里的回复正文，不要解释，不要输出编号，不要代码块。';
        const imageHint = options?.focusImages?.length
            ? `本条点名消息附带图片 ${options.focusImages.length} 张，请结合图片理解后作答。`
            : '';
        if (options?.directMention) {
            const ownerPlatform = this.config.aiOwnerPlatform?.trim() || this.config.aiHomePlatform?.trim();
            const ownerUserId = this.config.aiOwnerUserId?.trim() || this.config.aiHomeUserId?.trim();
            const homeHint = options.focusUserId && ownerUserId && options.focusUserId === ownerUserId
                && (ownerPlatform ? `当前发言者命中主人身份(${ownerPlatform}:${ownerUserId})。` : '');
            return [
                '你现在在一个QQ群中。',
                `你的自称是「${selfName}」。当你描述自己时请使用这个自称，不要在每句话前机械加前缀。`,
                focusLine,
                homeHint || '',
                imageHint,
                '用户正在直接点名你，请优先围绕该点名问题回复；可结合其他人的反馈补充说明。',
                formatHint,
                '如果主人或其他用户在上下文里追问该问题，可向追问者解释，但不要偏离当前话题。',
                '',
                '最近上下文（仅参考）：',
                ...lines.slice(-8),
            ].join('\n');
        }
        if (options?.followup) {
            return [
                '你现在在一个QQ群中。',
                `你的自称是「${selfName}」。当你描述自己时请使用这个自称，不要在每句话前机械加前缀。`,
                focusLine,
                '这是点名话题的后续追问，允许回应上下文中对该话题的相关追问（包括主人）。',
                formatHint,
                '',
                '最近上下文（仅参考）：',
                ...lines.slice(-8),
            ].join('\n');
        }
        return [
            '你现在在一个QQ群中。',
            `你的自称是「${selfName}」。当你描述自己时请使用这个自称，不要在每句话前机械加前缀。`,
            focusLine,
            options?.thresholdMode && options?.topicSummary ? `当前群主话题摘要：${options.topicSummary}` : '',
            imageHint,
            formatHint,
            options?.thresholdMode
                ? `当前为阈值触发：你必须优先回复“已选定优先回复消息”；不要回复最后一条，除非它就是该消息。既有主题关键词：${(options.topicTokens ?? []).join(', ') || '无'}`
                : '',
            '请自然、简洁，尽量控制在80字内。',
            '',
            '聊天记录：',
            ...lines,
        ].join('\n');
    }
    normalizeAiOutput(text, preserveLines = false) {
        const cleaned = text
            .replace(/^```[\s\S]*?\n/, '')
            .replace(/```$/g, '')
            .replace(/\r\n/g, '\n')
            .trim();
        if (!preserveLines) {
            return cleaned.replace(/\s+/g, ' ').trim();
        }
        return cleaned
            .split('\n')
            .map((line) => line.replace(/[ \t]+/g, ' ').trim())
            .filter(Boolean)
            .join('\n');
    }
    sanitizeAiOutputForSend(text) {
        // Prevent model output from being parsed into platform segments (CQ/image/html image/markdown image).
        return text
            .replace(/\[CQ:[^\]]+\]/gi, '')
            .replace(/<img\b[^>]*>/gi, '')
            .replace(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi, '$1')
            .trim();
    }
    splitAiReplyParts(text) {
        const source = text.trim();
        if (!source)
            return [];
        const chunks = source
            .split(/\n+/g)
            .flatMap((line) => line.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [line])
            .map((item) => item.trim().replace(/[。；;]+$/g, '').trim())
            .filter(Boolean);
        if (!chunks.length)
            return [source];
        const maxParts = 4;
        if (chunks.length <= maxParts)
            return chunks;
        return [
            ...chunks.slice(0, maxParts - 1),
            chunks.slice(maxParts - 1).join(' '),
        ];
    }
    async waitHumanLikeDelay(minMs = 420, maxMs = 1100) {
        const lower = Math.max(0, minMs);
        const upper = Math.max(lower, maxMs);
        const delay = Math.floor(Math.random() * (upper - lower + 1)) + lower;
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    isAddressingOtherThanBot(session) {
        const selfId = session.bot?.selfId;
        const content = session.content ?? '';
        const mentionMatches = content.match(/\[CQ:at,[^\]]*\]/gi) ?? [];
        const ids = mentionMatches
            .map((item) => item.match(/(?:qq|id)=(\d+)/i)?.[1] || '')
            .filter(Boolean);
        if (!ids.length)
            return false;
        return ids.some((id) => !selfId || id !== selfId);
    }
    extractAiImageUrls(text) {
        const urls = new Set();
        const maxCount = Math.max(0, this.config.aiImageMaxCount || 0) || 4;
        const source = text || '';
        const cqImagePattern = /\[CQ:image,[^\]]*\]/gi;
        for (const chunk of source.match(cqImagePattern) ?? []) {
            const match = chunk.match(/(?:url|file)=([^,\]]+)/i);
            if (!match)
                continue;
            const value = decodeURIComponent(match[1].trim());
            if (!/^https?:\/\//i.test(value))
                continue;
            urls.add(value);
            if (urls.size >= maxCount)
                return [...urls];
        }
        const htmlImgPattern = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
        let htmlMatch;
        while ((htmlMatch = htmlImgPattern.exec(source))) {
            const value = htmlMatch[1]?.trim();
            if (!value || !/^https?:\/\//i.test(value))
                continue;
            urls.add(value);
            if (urls.size >= maxCount)
                return [...urls];
        }
        const markdownImgPattern = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi;
        let mdMatch;
        while ((mdMatch = markdownImgPattern.exec(source))) {
            const value = mdMatch[1]?.trim();
            if (!value)
                continue;
            urls.add(value);
            if (urls.size >= maxCount)
                return [...urls];
        }
        return [...urls].slice(0, maxCount);
    }
    async callOpenAiCompatible(prompt) {
        const apiKey = this.config.aiApiKey?.trim();
        if (!apiKey)
            return { ok: false, message: 'AI 未配置 apiKey。' };
        const base = (this.config.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = this.config.aiModel?.trim();
        if (!model)
            return { ok: false, message: 'AI 未配置 model。' };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
            const response = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    temperature: this.config.aiTemperature,
                    max_tokens: this.config.aiMaxOutputTokens,
                    messages: [
                        { role: 'system', content: this.getActiveSystemPrompt() },
                        { role: 'user', content: prompt },
                    ],
                }),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const errorMessage = payload?.error?.message;
                return { ok: false, message: `OpenAI兼容接口错误: ${errorMessage || response.statusText}` };
            }
            const content = payload?.choices?.[0]?.message?.content;
            if (typeof content === 'string')
                return { ok: true, message: content };
            if (Array.isArray(content)) {
                const text = content.map((item) => item?.text || '').join('').trim();
                if (text)
                    return { ok: true, message: text };
            }
            return { ok: false, message: 'OpenAI兼容接口未返回可用文本。' };
        }
        catch (error) {
            return { ok: false, message: `OpenAI兼容请求失败: ${String(error)}` };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async callGemini(prompt) {
        const apiKey = this.config.aiApiKey?.trim();
        if (!apiKey)
            return { ok: false, message: 'Gemini 未配置 apiKey。' };
        const model = this.config.aiModel?.trim();
        if (!model)
            return { ok: false, message: 'Gemini 未配置 model。' };
        const rawBase = (this.config.aiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
        const base = /\/v\d/i.test(rawBase) ? rawBase : `${rawBase}/v1beta`;
        const endpoint = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: this.getActiveSystemPrompt() }] },
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: this.config.aiTemperature,
                        maxOutputTokens: this.config.aiMaxOutputTokens,
                    },
                }),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const errorMessage = payload?.error?.message;
                return { ok: false, message: `Gemini接口错误: ${errorMessage || response.statusText}` };
            }
            const text = (payload?.candidates?.[0]?.content?.parts ?? [])
                .map((item) => item?.text || '')
                .join('')
                .trim();
            if (!text)
                return { ok: false, message: 'Gemini接口未返回可用文本。' };
            return { ok: true, message: text };
        }
        catch (error) {
            return { ok: false, message: `Gemini请求失败: ${String(error)}` };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    extractImageUrls(session) {
        if (!this.config.aiEnableImageRecognition)
            return [];
        const maxCount = Math.max(0, this.config.aiImageMaxCount || 0);
        if (!maxCount)
            return [];
        return this.extractMessageImageUrls(session, maxCount);
    }
    isImageReference(value) {
        if (!value || typeof value !== 'string')
            return false;
        const v = value.trim();
        if (!v)
            return false;
        if (/^https?:\/\//i.test(v))
            return true;
        if (/^data:image\//i.test(v))
            return true;
        if (/^base64:\/\//i.test(v))
            return true;
        if (/^file:\/\//i.test(v))
            return true;
        if (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith('/'))
            return true;
        // NapCat 常见：纯文件名 / hash.jpg
        if (/^[0-9A-Fa-f]{16,}\.[A-Za-z0-9]{2,5}$/.test(v))
            return true;
        return false;
    }
    extractImageCandidates(session, maxCount = 6) {
        const out = [];
        for (const item of this.extractImageElements(session)) {
            for (const candidate of [item.url, item.ref]) {
                if (!this.isImageReference(candidate))
                    continue;
                if (!out.includes(candidate))
                    out.push(candidate);
            }
        }
        return out.slice(0, Math.max(1, maxCount));
    }
    collectReplyAwareImageCandidates(session, maxCount = 2) {
        const own = this.extractImageCandidates(session, maxCount);
        const quotedSession = session?.quote;
        const quoted = quotedSession ? this.extractImageCandidates(quotedSession, maxCount) : [];
        const merged = [];
        for (const item of [...own, ...quoted]) {
            if (!merged.includes(item))
                merged.push(item);
        }
        return { own, quoted, merged: merged.slice(0, Math.max(1, maxCount)) };
    }
    detectImageMime(buffer, fallback = 'image/jpeg') {
        if (!buffer || buffer.length < 12)
            return fallback;
        const b = buffer;
        if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)
            return 'image/jpeg';
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)
            return 'image/png';
        if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
            return 'image/gif';
        if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
            && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
            return 'image/webp';
        if (b[0] === 0x42 && b[1] === 0x4D)
            return 'image/bmp';
        return fallback;
    }
    async resolveImageReferenceToDataUrl(ref, session) {
        const value = String(ref ?? '').trim();
        if (!value)
            return '';
        // 已经是 data URL，直接沿用
        if (/^data:image\//i.test(value)) {
            return value.length > 64 * 1024 * 1024 ? '' : value;
        }
        try {
            let finalUrl = value;
            let headers = {};
            if (/^base64:\/\//i.test(value)) {
                // Koishi/OneBot 常见形态：base64://<裸base64>
                const raw = value.replace(/^base64:\/\//i, '');
                const buffer = Buffer.from(raw, 'base64');
                if (!buffer.length)
                    return '';
                return `data:${this.detectImageMime(buffer)};base64,${buffer.toString('base64')}`;
            }
            if (/^https?:\/\//i.test(value)) {
                // OneBot 的 get_image 能把 file_id 换成可访问链接
                const direct = await this.fetchImageAsDataUrl(value, headers);
                if (direct)
                    return direct;
                return '';
            }
            // 其余形态（file_id / 文件名 / 本地路径）交给 get_image 解析
            const onebot = this.getOneBotApi(session);
            if (onebot?.getImage) {
                const resolved = await onebot.getImage(value).catch(() => null);
                const url = resolved?.url || resolved?.file || resolved?.filename || '';
                const isLocal = url && !/^https?:\/\//i.test(url) && !/^data:/i.test(url);
                if (isLocal) {
                    try {
                        finalUrl = String(url).replace(/^file:\/\//i, '');
                    }
                    catch {
                        finalUrl = '';
                    }
                }
                else if (url) {
                    const dataUrl = await this.fetchImageAsDataUrl(url, headers);
                    if (dataUrl)
                        return dataUrl;
                }
                if (finalUrl && finalUrl !== value && !/^https?:\/\//i.test(finalUrl)) {
                    try {
                        const buffer = await node_fs_1.default.promises.readFile(finalUrl);
                        if (buffer.length)
                            return `data:${this.detectImageMime(buffer)};base64,${buffer.toString('base64')}`;
                    }
                    catch {
                        return '';
                    }
                }
            }
            if (/^file:\/\//i.test(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')) {
                const localPath = value.replace(/^file:\/\//i, '');
                const buffer = await node_fs_1.default.promises.readFile(localPath).catch(() => null);
                if (buffer?.length)
                    return `data:${this.detectImageMime(buffer)};base64,${buffer.toString('base64')}`;
            }
            return '';
        }
        catch (error) {
            this._logger.warn(`[img-fetch] resolve failed: ${String(error)} ref=${value.slice(0, 120)} | ${this.sessionTag(session)}`);
            return '';
        }
    }
    async fetchImageAsDataUrl(url, extraHeaders = {}) {
        const MAX_BYTES = 8 * 1024 * 1024;
        const cached = this._imageDataUrlCache?.get(url);
        if (cached !== undefined)
            return cached;
        if (!this._imageDataUrlCache)
            this._imageDataUrlCache = new Map();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NapCat/QQ',
                    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                    ...extraHeaders,
                },
                redirect: 'follow',
                signal: controller.signal,
            });
            if (!response.ok) {
                this._logger.warn(`[img-fetch] http ${response.status} url=${url.slice(0, 140)}`);
                this.rememberImageDataUrl(url, '');
                return '';
            }
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (!buffer.length) {
                this.rememberImageDataUrl(url, '');
                return '';
            }
            if (buffer.length > MAX_BYTES) {
                this._logger.warn(`[img-fetch] image too large (${buffer.length} bytes) url=${url.slice(0, 140)}`);
                this.rememberImageDataUrl(url, '');
                return '';
            }
            const mime = this.detectImageMime(buffer, response.headers.get('content-type')?.split(';')[0] || 'image/jpeg');
            const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
            this.rememberImageDataUrl(url, dataUrl);
            return dataUrl;
        }
        catch (error) {
            this._logger.warn(`[img-fetch] download failed: ${String(error)} url=${url.slice(0, 140)}`);
            this.rememberImageDataUrl(url, '');
            return '';
        }
        finally {
            clearTimeout(timeout);
        }
    }
    rememberImageDataUrl(url, dataUrl) {
        if (!this._imageDataUrlCache)
            this._imageDataUrlCache = new Map();
        if (this._imageDataUrlCache.size > 64)
            this._imageDataUrlCache.clear();
        this._imageDataUrlCache.set(url, dataUrl);
    }
    async resolveImagesForModel(refs, session, maxCount) {
        const limit = Math.max(1, maxCount || 1);
        const out = [];
        for (const ref of refs) {
            if (out.length >= limit)
                break;
            const candidates = Array.isArray(ref) ? ref : [ref];
            for (const candidate of candidates) {
                const dataUrl = await this.resolveImageReferenceToDataUrl(candidate, session);
                if (dataUrl) {
                    out.push(dataUrl);
                    break;
                }
            }
        }
        return out;
    }
    /**
     * 把 extractImageElements 的结构化条目解析为可直接喂给模型的 data URL。
     * 每个条目会依次尝试：原始 URL -> 本地文件名（走 OneBot get_image）。
     */
    async resolveVisualItemsForModel(items, session, maxCount) {
        const limit = Math.max(1, maxCount || 1);
        const out = [];
        for (const item of items) {
            if (out.length >= limit)
                break;
            const attempts = [];
            if (item.url)
                attempts.push(item.url);
            if (item.ref && item.ref !== item.url)
                attempts.push(item.ref);
            for (const candidate of attempts) {
                const dataUrl = await this.resolveImageReferenceToDataUrl(candidate, session);
                if (dataUrl) {
                    out.push(dataUrl);
                    break;
                }
            }
        }
        return out;
    }
    isImageSendableUrl(value) {
        if (!value || typeof value !== 'string')
            return false;
        const v = value.trim();
        if (/^https?:\/\//i.test(v))
            return true;
        if (/^data:image\//i.test(v))
            return true;
        return false;
    }
    decodeHtmlEntities(value) {
        if (typeof value !== 'string' || !value)
            return '';
        return value
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#0?39;/g, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&#x2f;/gi, '/')
            .replace(/&#0?38;/g, '&');
    }
    parseHtmlTagParams(tag) {
        const params = {};
        const re = /([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"|([a-zA-Z][\w-]*)\s*=\s*'([^']*)'/g;
        let m;
        while ((m = re.exec(tag))) {
            const key = (m[1] || m[3] || '').toLowerCase();
            const raw = m[2] !== undefined ? m[2] : m[4];
            if (!key)
                continue;
            params[key.replace(/-/g, '')] = this.decodeHtmlEntities(raw);
        }
        return params;
    }
    extractImageElements(session) {
        const items = [];
        const seen = new Set();
        const push = (url, ref, sticker) => {
            const u = this.decodeHtmlEntities(url || '').trim();
            const r = (ref || '').trim();
            const key = u || r;
            if (!key || seen.has(key))
                return;
            seen.add(key);
            items.push({
                url: u,
                ref: r,
                sticker: !!sticker,
                sendable: this.isImageSendableUrl(u),
            });
        };
        const isStickerParams = (params) => {
            const sub = String(params.subtype ?? params.subType ?? params['sub-type'] ?? '');
            const summary = String(params.summary ?? '');
            return sub === '1' || /动画表情|表情|贴纸|sticker|mface/i.test(summary);
        };
        // 1) CQ 码形态
        const content = session?.content ?? '';
        for (const chunk of content.match(/\[CQ:image,[^\]]*\]/gi) ?? []) {
            const params = this.parseCqImageParams(chunk);
            push(params.url || params.src || params.file, params.file_id || params.file || params.id, isStickerParams(params));
        }
        // 2) koishi onebot 适配器的 HTML 形态：<img src="..." summary="[动画表情]" .../>
        for (const tag of content.match(/<img\b[^>]*\/?>/gi) ?? []) {
            const attrs = this.parseHtmlTagParams(tag);
            push(attrs.src || attrs.url || attrs.file, attrs.file || attrs.fileid, isStickerParams(attrs));
        }
        // 3) 元素形态：type 可能是 image / img / face / sticker / mface
        for (const element of session?.elements ?? []) {
            const type = String(element?.type ?? '').toLowerCase();
            const attrs = element?.attrs ?? {};
            const rawAttrs = {};
            for (const k of Object.keys(attrs)) rawAttrs[String(k).toLowerCase().replace(/-/g, '')] = attrs[k];
            const isImgLike = type === 'img' || type === 'image';
            const isStickerLike = type === 'face' || type === 'sticker' || type === 'mface';
            if (!isImgLike && !isStickerLike)
                continue;
            const url = element?.url || element?.src
                || attrs.url || attrs.src
                || attrs.image || attrs.href || '';
            const ref = element?.file || element?.fileId || element?.file_id || element?.id
                || attrs.file || attrs.fileid || attrs.file_id || attrs.id || '';
            const sticker = isStickerLike || isStickerParams(rawAttrs) || isStickerParams(attrs);
            push(url, ref, sticker);
        }
        return items;
    }
    extractImageUrlsFromSession(session, maxCount = 4) {
        return this.extractImageElements(session)
            .filter((item) => item.sendable)
            .map((item) => item.url)
            .slice(0, Math.max(1, maxCount));
    }
    hasAnyImageElement(session) {
        if (!session)
            return false;
        if (this.extractImageElements(session).length)
            return true;
        const content = session.content ?? '';
        return /\[CQ:image,/i.test(content)
            || /<img\b/i.test(content)
            || (session.elements ?? []).some((el) => {
                const t = String(el?.type ?? '').toLowerCase();
                return t === 'img' || t === 'image' || t === 'face' || t === 'sticker' || t === 'mface';
            });
    }
    isStickerElement(element) {
        if (!element || typeof element !== 'object')
            return false;
        const type = String(element.type ?? '').toLowerCase();
        if (type === 'face' || type === 'sticker' || type === 'mface' || type === 'img' || type === 'image')
            return true;
        const attrs = element.attrs ?? {};
        const sub = String(attrs.subType ?? attrs.subtype ?? attrs['sub-type'] ?? '');
        return type === 'image' && sub === '1';
    }
    hasStickerContent(session) {
        if (!session)
            return false;
        if (/\[CQ:(face|mface|sticker),/i.test(session.content ?? ''))
            return true;
        return this.extractImageElements(session).some((item) => item.sticker);
    }
    extractMessageImageUrls(session, maxCount = 4) {
        return this.extractImageUrlsFromSession(session, maxCount);
    }
    describeImageMessage(session) {
        const content = session.content ?? '';
        const rawCq = (content.match(/\[CQ:image,[^\]]*\]/gi) ?? []);
        const rawHtml = (content.match(/<img\b[^>]*\/?>/gi) ?? []);
        const items = this.extractImageElements(session);
        const elems = [];
        for (const el of session.elements ?? []) {
            const t = String(el?.type ?? '').toLowerCase();
            if (t !== 'image' && t !== 'img' && t !== 'face' && t !== 'sticker' && t !== 'mface')
                continue;
            const attrs = el.attrs ?? {};
            elems.push({
                type: el.type,
                url: el.url || attrs.url || '',
                src: el.src || attrs.src || '',
                file: el.file || attrs.file || '',
                fileId: el.fileId || el.file_id || attrs.fileId || attrs.fileid || attrs.file_id || '',
                subType: attrs.subType ?? attrs.subtype ?? attrs['sub-type'] ?? '',
                summary: attrs.summary || '',
            });
        }
        return {
            hasCqImage: rawCq.length > 0,
            rawCq,
            rawHtml,
            items,
            elementImages: elems,
            extractableUrls: this.extractImageUrlsFromSession(session, 10),
            candidates: this.extractImageCandidates(session, 10),
        };
    }
    logImageDebug(session) {
        const info = this.describeImageMessage(session);
        this._logger.info(`[img-debug] cq=${info.rawCq.length} html=${info.rawHtml.length} elements=${info.elementImages.length} sendable=${JSON.stringify(info.extractableUrls)} candidates=${JSON.stringify(info.candidates)} items=${JSON.stringify(info.items).slice(0, 400)} | ${this.sessionTag(session)}`);
    }
    extractImageFingerprintKeys(session, maxCount = 6) {
        const keys = [];
        const content = session.content ?? '';
        const pushKey = (value) => {
            const key = value.trim();
            if (!key)
                return;
            keys.push(key);
        };
        const hashPattern = /([A-Fa-f0-9]{32})/g;
        let hashMatch;
        while ((hashMatch = hashPattern.exec(content))) {
            pushKey(`hash:${hashMatch[1].toUpperCase()}`);
            if (keys.length >= maxCount)
                return [...new Set(keys)];
        }
        const cqPattern = /\[CQ:image,[^\]]*\]/gi;
        const cqList = content.match(cqPattern) ?? [];
        for (const chunk of cqList) {
            const file = chunk.match(/file=([^,\]]+)/i)?.[1];
            const id = chunk.match(/(?:file_id|id)=([^,\]]+)/i)?.[1];
            const md5 = chunk.match(/md5=([^,\]]+)/i)?.[1];
            const url = chunk.match(/(?:url|src)=([^,\]]+)/i)?.[1];
            let key = '';
            if (md5)
                key = `md5:${decodeURIComponent(md5).toUpperCase()}`;
            else if (file)
                key = `file:${decodeURIComponent(file)}`;
            else if (id)
                key = `id:${decodeURIComponent(id)}`;
            else if (url) {
                const u = decodeURIComponent(url);
                const hash = u.match(/([A-Fa-f0-9]{32})/)?.[1];
                if (hash)
                    key = `hash:${hash.toUpperCase()}`;
                else {
                    try {
                        const parsed = new URL(u);
                        key = `urlp:${parsed.origin}${parsed.pathname}`;
                    }
                    catch {
                        key = `url:${u.split('?')[0]}`;
                    }
                }
            }
            if (!key && file) {
                const hash = decodeURIComponent(file).match(/([A-Fa-f0-9]{32})/)?.[1];
                if (hash)
                    key = `hash:${hash.toUpperCase()}`;
            }
            if (!key)
                continue;
            pushKey(key);
            if (keys.length >= maxCount)
                return [...new Set(keys)];
        }
        const htmlImgPattern = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
        let htmlMatch;
        while ((htmlMatch = htmlImgPattern.exec(content))) {
            const src = htmlMatch[1] || '';
            const hash = src.match(/([A-Fa-f0-9]{32})/)?.[1];
            if (hash) {
                pushKey(`hash:${hash.toUpperCase()}`);
            }
            else if (src) {
                try {
                    const parsed = new URL(src);
                    pushKey(`urlp:${parsed.origin}${parsed.pathname}`);
                }
                catch {
                    pushKey(`url:${src.split('?')[0]}`);
                }
            }
            if (keys.length >= maxCount)
                return [...new Set(keys)];
        }
        const elements = session.elements ?? [];
        for (const element of elements) {
            if (element.type !== 'image')
                continue;
            const file = (typeof element.file === 'string' && element.file)
                || (typeof element.attrs?.file === 'string' && element.attrs.file);
            const id = (typeof element.id === 'string' && element.id)
                || (typeof element.attrs?.id === 'string' && element.attrs.id)
                || (typeof element.attrs?.file_id === 'string' && element.attrs.file_id);
            const md5 = typeof element.attrs?.md5 === 'string' ? element.attrs.md5 : '';
            const url = (typeof element.url === 'string' && element.url)
                || (typeof element.src === 'string' && element.src)
                || (typeof element.attrs?.url === 'string' && element.attrs.url)
                || (typeof element.attrs?.src === 'string' && element.attrs.src);
            let key = '';
            if (md5)
                key = `md5:${md5.toUpperCase()}`;
            else if (file)
                key = `file:${file}`;
            else if (id)
                key = `id:${id}`;
            else if (url) {
                const hash = url.match(/([A-Fa-f0-9]{32})/)?.[1];
                if (hash)
                    key = `hash:${hash.toUpperCase()}`;
                else {
                    try {
                        const parsed = new URL(url);
                        key = `urlp:${parsed.origin}${parsed.pathname}`;
                    }
                    catch {
                        key = `url:${url.split('?')[0]}`;
                    }
                }
            }
            if (!key && file) {
                const hash = file.match(/([A-Fa-f0-9]{32})/)?.[1];
                if (hash)
                    key = `hash:${hash.toUpperCase()}`;
            }
            if (!key)
                continue;
            pushKey(key);
            if (keys.length >= maxCount)
                break;
        }
        return [...new Set(keys)].slice(0, maxCount);
    }
    normalizeRepeatText(text) {
        return text
            .replace(/<img\b[^>]*>/gi, '[图片]')
            .replace(/\[CQ:image,[^\]]*\]/gi, '[图片]')
            .replace(/\s+/g, ' ')
            .trim();
    }
    buildRepeatPayload(session) {
        const text = this.normalizeRepeatText(this.extractAiMessageText(session));
        const images = this.extractMessageImageUrls(session, 6);
        const imageKeys = this.extractImageFingerprintKeys(session, 6);
        const normalizedText = text.replace(/\s+/g, ' ').trim();
        const textCore = normalizedText.replace(/\[图片\]/g, '').trim();
        const signature = imageKeys.length
            ? `img:${imageKeys.join('|')}|txt:${textCore}`
            : `txt:${normalizedText}`;
        const rawImageSegments = (session.content ?? '').match(/\[CQ:image,[^\]]+\]/gi) ?? [];
        const sendRefs = this.extractImageSendRefs(session);
        return { signature, text: normalizedText, images, imageKeys, rawImageSegments, sendRefs };
    }
    parseCqImageParams(chunk) {
        const body = chunk.replace(/^\[CQ:image,?/i, '').replace(/\]$/i, '');
        const params = {};
        for (const part of body.split(',')) {
            const idx = part.indexOf('=');
            if (idx <= 0)
                continue;
            const key = part.slice(0, idx).trim().toLowerCase();
            const value = part.slice(idx + 1).trim();
            if (!key || !value)
                continue;
            try {
                params[key] = decodeURIComponent(value);
            }
            catch {
                params[key] = value;
            }
        }
        return params;
    }
    extractImageRefsFromRawMessage(raw, maxCount = 6) {
        const refs = [];
        const push = (value) => {
            if (typeof value !== 'string')
                return;
            const v = value.trim();
            if (!v)
                return;
            refs.push(v);
        };
        const parseString = (text) => {
            const cqPattern = /\[CQ:image,[^\]]*\]/gi;
            for (const chunk of text.match(cqPattern) ?? []) {
                const params = this.parseCqImageParams(chunk);
                if (params.file_id)
                    push(params.file_id);
                if (params.id)
                    push(params.id);
                if (params.file)
                    push(params.file);
                if (params.url)
                    push(params.url);
                if (params.src)
                    push(params.src);
                if (refs.length >= maxCount)
                    return;
            }
            const htmlImgPattern = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
            let htmlMatch;
            while ((htmlMatch = htmlImgPattern.exec(text))) {
                push(htmlMatch[1]);
                if (refs.length >= maxCount)
                    return;
            }
        };
        const walk = (value) => {
            if (refs.length >= maxCount || value == null)
                return;
            if (typeof value === 'string') {
                parseString(value);
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value) {
                    walk(item);
                    if (refs.length >= maxCount)
                        return;
                }
                return;
            }
            if (typeof value !== 'object')
                return;
            const node = value;
            const candidates = [
                node.url,
                node.src,
                node.file,
                node.id,
                node.file_id,
                node.data?.url,
                node.data?.src,
                node.data?.file,
                node.data?.id,
                node.data?.file_id,
                node.attrs?.url,
                node.attrs?.src,
                node.attrs?.file,
                node.attrs?.id,
                node.attrs?.file_id,
            ];
            for (const item of candidates) {
                push(item);
                if (refs.length >= maxCount)
                    return;
            }
            walk(node.message);
            walk(node.raw_message);
            walk(node.content);
        };
        walk(raw);
        return [...new Set(refs)].slice(0, maxCount);
    }
    extractImageSegmentsFromRawMessage(raw, maxCount = 6) {
        const segments = [];
        const push = (value) => {
            const v = value.trim();
            if (!v)
                return;
            segments.push(v);
        };
        const parseString = (text) => {
            const cqPattern = /\[CQ:image,[^\]]+\]/gi;
            for (const chunk of text.match(cqPattern) ?? []) {
                push(chunk);
                if (segments.length >= maxCount)
                    return;
            }
        };
        const walk = (value) => {
            if (segments.length >= maxCount || value == null)
                return;
            if (typeof value === 'string') {
                parseString(value);
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value) {
                    walk(item);
                    if (segments.length >= maxCount)
                        return;
                }
                return;
            }
            if (typeof value !== 'object')
                return;
            const node = value;
            walk(node.message);
            walk(node.raw_message);
            walk(node.content);
        };
        walk(raw);
        return [...new Set(segments)].slice(0, maxCount);
    }
    extractImageSendRefs(session, maxCount = 6) {
        const refs = [];
        const pushRef = (value) => {
            const v = String(value ?? '').trim();
            if (!v)
                return;
            refs.push(v);
        };
        // 统一走 extractImageElements：同时覆盖 CQ 与 koishi HTML(<img>) 两种形态
        for (const item of this.extractImageElements(session)) {
            pushRef(item.ref);
            pushRef(item.url);
            if (refs.length >= maxCount)
                return [...new Set(refs)].slice(0, maxCount);
        }
        const content = session.content ?? '';
        const cqPattern = /\[CQ:image,[^\]]*\]/gi;
        for (const chunk of content.match(cqPattern) ?? []) {
            const params = this.parseCqImageParams(chunk);
            if (params.file_id)
                pushRef(params.file_id);
            if (params.id)
                pushRef(params.id);
            if (params.file)
                pushRef(params.file);
            if (params.url)
                pushRef(params.url);
            if (params.src)
                pushRef(params.src);
            if (refs.length >= maxCount)
                return [...new Set(refs)].slice(0, maxCount);
        }
        return [...new Set(refs)].slice(0, maxCount);
    }
    async fetchMessageImagePayload(session, maxCount = 6) {
        if (!this.config.repeaterEnableGetMsgRefetch)
            return { segments: [], refs: [] };
        if (session.platform !== 'onebot')
            return { segments: [], refs: [] };
        const messageId = session.messageId;
        if (!messageId)
            return { segments: [], refs: [] };
        const onebot = this.getOneBotApi(session);
        if (!onebot?.getMsg)
            return { segments: [], refs: [] };
        try {
            const data = await onebot.getMsg(messageId);
            return {
                segments: this.extractImageSegmentsFromRawMessage(data, maxCount),
                refs: this.extractImageRefsFromRawMessage(data, maxCount),
            };
        }
        catch (error) {
            this._logger.warn(`[repeater] get_msg refetch failed: ${String(error)} | ${this.sessionTag(session)} messageId=${messageId}`);
            return { segments: [], refs: [] };
        }
    }
    async sendImageRef(session, ref) {
        const value = ref.trim();
        if (!value)
            return false;
        const isHttp = /^https?:\/\//i.test(value);
        if (isHttp)
            return false;
        try {
            await session.send((0, koishi_1.h)('image', { src: value, cache: 0 }));
            return true;
        }
        catch (error) {
            this._logger.warn(`[repeater] send-image-by-file-failed: ${String(error)} | ${this.sessionTag(session)} ref=${value}`);
        }
        try {
            await session.send(koishi_1.h.image(value));
            return true;
        }
        catch {
            return false;
        }
    }
    async handleRepeater(session) {
        if (!this.config.enableRepeater)
            return;
        if (!session.guildId || !session.userId)
            return;
        if (session.userId === session.bot?.selfId)
            return;
        const groupKey = this.aiGroupKey(session);
        if (!groupKey)
            return;
        const payload = this.buildRepeatPayload(session);
        if (!payload.signature || (!payload.text && !payload.images.length && !payload.rawImageSegments.length && !payload.sendRefs.length && !payload.imageKeys.length))
            return;
        const now = Date.now();
        const prev = this.repeatStates.get(groupKey);
        const next = prev && prev.signature === payload.signature
            ? { ...prev, count: prev.count + 1, updatedAt: now }
            : { signature: payload.signature, count: 1, updatedAt: now, lastRepeatedSignature: prev?.lastRepeatedSignature, lastRepeatedAt: prev?.lastRepeatedAt };
        this.repeatStates.set(groupKey, next);
        const threshold = Math.max(2, this.config.repeaterThreshold || 3);
        if (next.count < threshold)
            return;
        const cooldownMs = Math.max(1, this.config.repeaterCooldownSeconds || 90) * 1000;
        const isSameAsLast = next.lastRepeatedSignature === payload.signature;
        if (isSameAsLast && next.lastRepeatedAt && now - next.lastRepeatedAt < cooldownMs)
            return;
        const meaningfulText = payload.text.replace(/\[图片\]/g, '').replace(/\s+/g, '').trim();
        if (meaningfulText) {
            const parts = this.splitAiReplyParts(payload.text);
            let first = true;
            for (const part of parts) {
                if (!first)
                    await this.waitHumanLikeDelay(350, 900);
                await session.send(koishi_1.h.text(part));
                first = false;
            }
        }
        let imageSent = false;
        let sendAttemptCount = 0;
        let sendSuccessCount = 0;
        let resolvedSegmentsFromGetMsg = 0;
        let resolvedRefsFromGetMsg = 0;
        const sentRefSet = new Set();
        const trySendRef = async (raw) => {
            const ref = raw.trim();
            if (!ref || /^https?:\/\//i.test(ref))
                return false;
            if (sentRefSet.has(ref))
                return false;
            sentRefSet.add(ref);
            await this.waitHumanLikeDelay(420, 980);
            sendAttemptCount += 1;
            if (await this.sendImageRef(session, ref)) {
                imageSent = true;
                sendSuccessCount += 1;
                return true;
            }
            return false;
        };
        for (const segment of payload.rawImageSegments) {
            const params = this.parseCqImageParams(segment);
            const refs = [params.file_id, params.id, params.file, params.url, params.src].filter(Boolean);
            for (const ref of refs) {
                await trySendRef(ref);
            }
        }
        if (!imageSent) {
            for (const ref of payload.sendRefs) {
                await trySendRef(ref);
            }
        }
        if (!imageSent && payload.imageKeys.length) {
            const fetched = await this.fetchMessageImagePayload(session, 6);
            resolvedSegmentsFromGetMsg = fetched.segments.length;
            resolvedRefsFromGetMsg = fetched.refs.length;
            for (const segment of fetched.segments) {
                const params = this.parseCqImageParams(segment);
                const file = params.file || '';
                const fileId = params.file_id || params.id || '';
                if (fileId)
                    await trySendRef(fileId);
                if (file && !/^https?:\/\//i.test(file))
                    await trySendRef(file);
            }
            for (const ref of fetched.refs) {
                await trySendRef(ref);
            }
        }
        const noSendableReason = !imageSent && payload.imageKeys.length ? 'no-sendable-image-payload' : '';
        if (!imageSent) {
            this._logger.warn(`[repeater] triggered but no sendable image payload | ${this.sessionTag(session)} keys=${JSON.stringify(payload.imageKeys)} refs=${JSON.stringify(payload.sendRefs)}`);
        }
        this.repeatStates.set(groupKey, {
            ...next,
            lastRepeatedSignature: payload.signature,
            lastRepeatedAt: now,
        });
        this.logCommandResult('repeater', { ok: true, message: `repeat triggered x${next.count}` }, session, {
            text: payload.text,
            images: payload.images.length,
            imageKeys: payload.imageKeys,
            sendRefs: payload.sendRefs,
            rawSegments: payload.rawImageSegments.length,
            resolvedSegmentsFromGetMsg,
            resolvedRefsFromGetMsg,
            sendAttemptCount,
            sendSuccessCount,
            reason: noSendableReason || undefined,
        });
        this.appendAiContextNote(groupKey, `群内触发复读：${payload.text || '[图片消息]'} (${payload.images.length}张图)`);
    }
    async callOpenAiCompatibleWithImages(prompt, imageUrls) {
        const apiKey = this.config.aiApiKey?.trim();
        if (!apiKey)
            return { ok: false, message: 'AI 未配置 apiKey。' };
        const base = (this.config.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const model = this.config.aiModel?.trim();
        if (!model)
            return { ok: false, message: 'AI 未配置 model。' };
        const userContent = [{ type: 'text', text: prompt }];
        for (const url of imageUrls) {
            userContent.push({ type: 'image_url', image_url: { url } });
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
            const response = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    temperature: this.config.aiTemperature,
                    max_tokens: this.config.aiMaxOutputTokens,
                    messages: [
                        { role: 'system', content: this.getActiveSystemPrompt() },
                        { role: 'user', content: userContent },
                    ],
                }),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const errorMessage = payload?.error?.message;
                return { ok: false, message: `OpenAI兼容接口错误: ${errorMessage || response.statusText}` };
            }
            const content = payload?.choices?.[0]?.message?.content;
            if (typeof content === 'string')
                return { ok: true, message: content };
            if (Array.isArray(content)) {
                const text = content.map((item) => item?.text || '').join('').trim();
                if (text)
                    return { ok: true, message: text };
            }
            return { ok: false, message: 'OpenAI兼容接口未返回可用文本。' };
        }
        catch (error) {
            return { ok: false, message: `OpenAI兼容请求失败: ${String(error)}` };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async generateAiReply(session, options) {
        const key = this.aiGroupKey(session);
        if (!key)
            return { ok: false, message: '缺少群聊上下文。' };
        const records = this.aiBuffers.get(key) ?? [];
        if (!records.length)
            return { ok: false, message: '无可用聊天上下文。' };
        let prompt = this.buildAiUserPrompt(records, options);
        prompt = await this.decoratePromptWithMemory(prompt, options);
        const focusImages = (options?.focusImages ?? [])
            .filter((url) => typeof url === 'string' && (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)))
            .slice(0, Math.max(1, this.config.aiImageMaxCount || 2));
        const result = this.config.aiProvider === 'gemini'
            ? await this.callGemini(focusImages.length
                ? `${prompt}\n\n点名消息图片链接（如可访问请一并识别）：\n${focusImages.map((item, i) => `${i + 1}. ${item}`).join('\n')}`
                : prompt)
            : (focusImages.length
                ? await this.callOpenAiCompatibleWithImages(prompt, focusImages)
                : await this.callOpenAiCompatible(prompt));
        if (!result.ok)
            return result;
        const text = this.normalizeAiOutput(result.message, false).trim();
        if (!text)
            return { ok: false, message: 'AI 返回空响应。' };
        const normalized = text.length > 600 ? `${text.slice(0, 600)}...` : text;
        return { ok: true, message: normalized };
    }
    async maybeReplyWithAi(session) {
        if (!this.resolveAiEnabled(session))
            return;
        if (!session.guildId || !session.userId)
            return;
        if (session.userId === session.bot?.selfId)
            return;
        if (this.isDuplicateAiEvent(session))
            return;
        this.rememberUser(session);
        const groupKey = this.aiGroupKey(session);
        if (!groupKey)
            return;
        const text = this.extractAiMessageText(session);
        const atBot = this.isMentionBot(session);
        const messageImages = this.extractImageUrls(session);
        // 识图：当前消息没有图时，回退到「被回复的那条消息」里的图（适配器已把原消息放在 session.quote）
        const ownItems = this.extractImageElements(session);
        const quoteItems = session.quote ? this.extractImageElements(session.quote) : [];
        const itemsForModel = ownItems.length ? ownItems : quoteItems;
        const imageCandidates = this.collectReplyAwareImageCandidates(session, Math.max(1, this.config.aiImageMaxCount || 2));
        const replyImageRefs = messageImages.length ? [] : imageCandidates.quoted;
        const rawImageRefs = messageImages.length ? [] : imageCandidates.merged;
        // 注意：图片下载（http -> data URL）延迟到"确认要回复"之后，避免每条含图消息都产生网络开销
        let focusImages = messageImages;
        const hasSticker = this.hasStickerContent(session)
            || !!(session.quote && this.hasStickerContent(session.quote));
        // 识图调试：消息里带图/表情但提取不到可发送图片时，记录原始字段，便于排查
        if (this.config.aiEnableImageRecognition) {
            const quotedHasImage = this.hasAnyImageElement(session.quote);
            if ((this.hasAnyImageElement(session) || quotedHasImage) && !messageImages.length) {
                this.logImageDebug(session);
                this._logger.info(`[img-debug] reply-aware ownItems=${ownItems.length} quoteItems=${quoteItems.length} own=${JSON.stringify(imageCandidates.own)} quoted=${JSON.stringify(replyImageRefs)} hasQuote=${!!session.quote} | ${this.sessionTag(session)}`);
            }
        }
        // 纯图片/表情包消息也参与 AI 判定（此前会被下面的空文本早退直接丢弃）
        const hasVisualContent = hasSticker || !!rawImageRefs.length || focusImages.length > 0;
        const visualText = hasVisualContent ? '[图片/表情]' : '';
        const effectiveText = text || visualText;
        // 记录上下文（放在视觉变量计算之后，避免 const 暂时性死区）
        this.pushAiRecord(session, text || visualText || '@bot');
        if (hasVisualContent) {
            // 用视觉占位文本刷新上下文，避免 buffer 里该条为空文本
            const buffered = this.aiBuffers.get(groupKey) ?? [];
            const last = buffered[buffered.length - 1];
            if (last && !String(last.text ?? '').trim()) {
                last.text = visualText;
                last.imageUrls = last.imageUrls?.length ? last.imageUrls : (hasSticker ? ['sticker'] : ['image']);
            }
        }
        const directMention = this.config.aiEnableDirectMentionTrigger && (this.containsAgentName(text) || atBot);
        const followup = this.getFollowupSession(groupKey);
        const isFollowupUser = !!followup && followup.userId === session.userId;
        const talkingToOthers = isFollowupUser && this.isAddressingOtherThanBot(session);
        const isOwnerUser = this.isHomeUser(session);
        const followupForce = !!(this.config.aiEnableFollowupAfterMention
            && isFollowupUser
            && !directMention
            && !talkingToOthers
            && this.shouldContinueFollowup(text, followup));
        const relatedContextFollowup = !!(this.config.aiEnableFollowupAfterMention
            && followup
            && !isFollowupUser
            && !directMention
            && this.shouldContinueFollowup(text, followup)
            && (isOwnerUser || /[?？]|(何意|何意味|什么意思|啥意思|怎么回事|发生了什么)/.test(text)));
        if (talkingToOthers) {
            this.aiFollowups.delete(groupKey);
        }
        if (followup && !isFollowupUser && !directMention && !relatedContextFollowup)
            return;
        // 纯图片/表情消息也允许进入随机/阈值/兴趣判定（visualText 已给出占位文本）
        if (!effectiveText && !hasVisualContent && !directMention && !followupForce && !relatedContextFollowup)
            return;
        if (this.config.aiIgnoreCommandMessage && !directMention && !followupForce && !relatedContextFollowup && this.isCommandLikeMessage(text))
            return;
        const trigger = directMention
            ? { ok: true, reason: 'direct-mention' }
            : (followupForce || relatedContextFollowup)
                ? { ok: true, reason: 'followup' }
                : this.shouldTriggerAiReply(session, false);
        if (!trigger.ok)
            return;
        const topicHint = (this.aiTopicMemory.get(groupKey)?.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (trigger.reason === 'interest-check') {
            const interest = await this.shouldReplyByInterest({ groupKey, text: effectiveText, hasSticker, hasImage: focusImages.length > 0 });
            this.logCommandResult('ai-interest', { ok: interest.ok, message: `score=${interest.score} threshold=${interest.threshold} reason=${interest.reason}` }, session, { ctxSize: interest.ctxSize, topicHint: interest.topicHint || topicHint || undefined });
            if (!interest.ok)
                return;
        }
        const thresholdMode = typeof trigger.reason === 'string' && trigger.reason.startsWith('threshold(');
        const topicMemory = this.aiTopicMemory.get(groupKey);
        const topicTokens = topicMemory?.tokens ?? [];
        let selectedRecord;
        if (thresholdMode && topicTokens.length) {
            const records = this.aiBuffers.get(groupKey) ?? [];
            let bestScore = -1;
            for (const record of records) {
                if (!record.text?.trim())
                    continue;
                const score = this.scoreTopicRelevance(record.text, topicTokens);
                if (score > bestScore) {
                    bestScore = score;
                    selectedRecord = record;
                }
            }
        }
        if (thresholdMode) {
            const interest = await this.shouldReplyByInterest({ groupKey, text: effectiveText, hasSticker, hasImage: focusImages.length > 0 });
            this.logCommandResult('ai-threshold-interest', { ok: interest.ok, message: `score=${interest.score} threshold=${interest.threshold} reason=${interest.reason}` }, session, { ctxSize: interest.ctxSize, topicHint: interest.topicHint || topicHint || undefined });
            if (!interest.ok) {
                this.logCommandResult('ai-threshold-skip-by-interest', { ok: true, message: 'threshold hit but skipped by low interest' }, session, {
                    score: interest.score,
                    threshold: interest.threshold,
                    reason: interest.reason,
                });
                return;
            }
        }
        this.aiInFlight.add(groupKey);
        const startedAt = Date.now();
        // 已确认要回复，此时才把图片下载/转换为 base64（模型需要可直接读取的图片数据）
        const maxImg = Math.max(1, this.config.aiImageMaxCount || 2);
        let modelImages = focusImages.filter((u) => /^data:image\//i.test(u)).slice(0, maxImg);
        if (this.config.aiEnableImageRecognition && modelImages.length < maxImg) {
            const pendingItems = itemsForModel.slice();
            if (pendingItems.length) {
                const resolved = await this.resolveVisualItemsForModel(pendingItems, session, maxImg - modelImages.length);
                modelImages = [...modelImages, ...resolved].slice(0, maxImg);
            }
            else if (rawImageRefs.length) {
                const resolved = await this.resolveImagesForModel(rawImageRefs, session, maxImg - modelImages.length);
                modelImages = [...modelImages, ...resolved].slice(0, maxImg);
            }
        }
        this._logger.info(`[img-probe] trigger=${trigger.reason} ownItems=${ownItems.length} quoteItems=${quoteItems.length} candidates=${rawImageRefs.length} modelImages=${modelImages.length} sticker=${hasSticker} | ${this.sessionTag(session)}`);
        try {
            const result = await this.generateAiReply(session, {
                directMention,
                followup: (followupForce || relatedContextFollowup),
                thresholdMode,
                focusText: (directMention || followupForce || relatedContextFollowup) ? (effectiveText || '@bot') : undefined,
                focusUserId: (directMention || followupForce || relatedContextFollowup) ? session.userId : undefined,
                focusImages: modelImages,
                focusUserName: (directMention || followupForce || relatedContextFollowup) ? this.getDisplayName(session) : undefined,
                topicTokens: thresholdMode ? topicTokens : undefined,
                selectedRecord,
                topicSummary: thresholdMode ? (topicHint || undefined) : undefined,
            });
            if (!result.ok) {
                this.logCommandResult('ai-reply', { ok: false, message: result.message }, session, { trigger: trigger.reason });
                return;
            }
            const imageUrls = this.extractAiImageUrls(result.message);
            const safeText = this.sanitizeAiOutputForSend(result.message);
            if (!safeText) {
                this.logCommandResult('ai-reply', { ok: false, message: 'ai reply empty after sanitize' }, session, { trigger: trigger.reason });
                return;
            }
            const parts = this.splitAiReplyParts(safeText);
            if (!parts.length)
                return;
            if (session.messageId) {
                try {
                    await session.send([koishi_1.h.quote(session.messageId), koishi_1.h.text(parts[0])]);
                }
                catch (error) {
                    // Some OneBot implementations reject reply ids in specific ranges; fallback to plain text.
                    this._logger.warn(`[ai-reply] quote send failed, fallback to plain: ${String(error)} | ${this.sessionTag(session)}`);
                    await session.send(koishi_1.h.text(parts[0]));
                }
                for (const part of parts.slice(1)) {
                    await this.waitHumanLikeDelay();
                    await session.send(koishi_1.h.text(part));
                }
            }
            else {
                let first = true;
                for (const part of parts) {
                    if (!first)
                        await this.waitHumanLikeDelay();
                    await session.send(koishi_1.h.text(part));
                    first = false;
                }
            }
            for (const url of imageUrls) {
                try {
                    await this.waitHumanLikeDelay(500, 1200);
                    await session.send(koishi_1.h.image(url));
                }
                catch (error) {
                    this._logger.warn(`[ai-reply] image send failed: ${String(error)} url=${url} | ${this.sessionTag(session)}`);
                }
            }
            this.aiLastReplyAt.set(groupKey, Date.now());
            if (!directMention && !followupForce && !relatedContextFollowup)
                this.aiCounters.set(groupKey, 0);
            if (directMention)
                this.startFollowupSession(groupKey, session.userId, text || '@bot');
            if (followupForce || relatedContextFollowup) {
                this.bumpFollowupSession(groupKey);
                const latest = this.getFollowupSession(groupKey);
                if (latest) {
                    latest.lastText = text;
                    this.aiFollowups.set(groupKey, latest);
                }
            }
            const replyTokens = this.tokenizeTopic(safeText);
            if (replyTokens.length) {
                this.aiTopicMemory.set(groupKey, {
                    tokens: replyTokens,
                    text: safeText,
                    updatedAt: Date.now(),
                });
            }
            this.logCommandResult('ai-reply', { ok: true, message: 'ai reply sent' }, session, { trigger: trigger.reason, latencyMs: Date.now() - startedAt });
        }
        catch (error) {
            this.logCommandResult('ai-reply', { ok: false, message: `ai reply failed: ${String(error)}` }, session, { trigger: trigger.reason });
        }
        finally {
            this.aiInFlight.delete(groupKey);
        }
    }
    async fetchOneBotStatus(session) {
        if (!session || session.platform !== 'onebot')
            return null;
        const onebot = this.getOneBotApi(session);
        if (!onebot?.getStatus)
            return null;
        try {
            return await onebot.getStatus();
        }
        catch (error) {
            this._logger.warn(`[status] 获取 OneBot 状态失败: ${String(error)}`);
            return null;
        }
    }
    async fetchOnlineClientsCount(session) {
        if (!session || session.platform !== 'onebot')
            return null;
        const onebot = this.getOneBotApi(session);
        if (!onebot?.getOnlineClients)
            return null;
        try {
            const data = await onebot.getOnlineClients(true);
            return Array.isArray(data) ? data.length : null;
        }
        catch {
            return null;
        }
    }
    formatRssKbToMb(rssKb) {
        if (!Number.isFinite(rssKb) || rssKb <= 0)
            return '-';
        return `${(rssKb / 1024).toFixed(1)} MB`;
    }
    async fetchProcessUsageByHints(hints) {
        try {
            const { stdout } = await execFile('ps', ['-eo', 'comm=,%cpu=,rss=,args='], { timeout: 1800, maxBuffer: 1024 * 1024 });
            const loweredHints = hints.map((item) => item.toLowerCase());
            const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
            let best = null;
            for (const line of lines) {
                const matched = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
                if (!matched)
                    continue;
                const comm = matched[1];
                const cpu = Number(matched[2]);
                const rssKb = Number(matched[3]);
                const args = matched[4];
                const haystack = `${comm} ${args}`.toLowerCase();
                if (!loweredHints.some((hint) => haystack.includes(hint)))
                    continue;
                if (!best || cpu > best.cpu) {
                    best = { name: comm, cpu: Number.isFinite(cpu) ? cpu : 0, rssKb: Number.isFinite(rssKb) ? rssKb : 0 };
                }
            }
            if (!best)
                return null;
            return {
                source: 'process',
                name: best.name,
                cpuText: `${best.cpu.toFixed(1)}%`,
                memText: this.formatRssKbToMb(best.rssKb),
            };
        }
        catch {
            return null;
        }
    }
    async fetchDockerUsageByHints(hints) {
        try {
            const { stdout: namesStdout } = await execFile('docker', ['ps', '--format', '{{.Names}}'], { timeout: 1800, maxBuffer: 1024 * 1024 });
            const names = namesStdout.split('\n').map((line) => line.trim()).filter(Boolean);
            if (!names.length)
                return null;
            const loweredHints = hints.map((item) => item.toLowerCase());
            const target = names.find((name) => loweredHints.some((hint) => name.toLowerCase().includes(hint)));
            if (!target)
                return null;
            const { stdout: statsStdout } = await execFile('docker', ['stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}'], { timeout: 2200, maxBuffer: 1024 * 1024 });
            const line = statsStdout
                .split('\n')
                .map((item) => item.trim())
                .find((item) => item.startsWith(`${target}|`));
            if (!line)
                return null;
            const parts = line.split('|');
            if (parts.length < 3)
                return null;
            const memUsage = parts[2].split('/')[0].trim();
            return {
                source: 'docker',
                name: parts[0],
                cpuText: parts[1].trim() || '-',
                memText: memUsage || '-',
            };
        }
        catch {
            return null;
        }
    }
    async fetchLlbotClientUsage() {
        const hints = ['llonebot', 'llbot', 'onebot', 'napcat', 'lagrange'];
        const dockerUsage = await this.fetchDockerUsageByHints(hints);
        if (dockerUsage)
            return dockerUsage;
        return this.fetchProcessUsageByHints(hints);
    }
    async fetchQqClientUsage() {
        const hints = ['ntqq', 'qq', 'qqnt'];
        return this.fetchProcessUsageByHints(hints);
    }
    async handleMenuPairing(session) {
        const key = this.pairingKey(session);
        if (!key)
            return false;
        const expiresAt = this.menuPairings.get(key);
        if (!expiresAt)
            return false;
        if (Date.now() > expiresAt) {
            this.menuPairings.delete(key);
            return false;
        }
        const keyword = this.getMessageText(session);
        if (!keyword)
            return false;
        this.menuPairings.delete(key);
        const hit = this.resolveMenuCategory(keyword, session);
        if (!hit) {
            this.logCommandResult('menu-pairing', { ok: true, message: 'paired menu ignored: no match' }, session, { keyword });
            return false;
        }
        const output = await this.renderMenu(keyword, session);
        try {
            await session.send(output);
            this.logCommandResult('menu-pairing', { ok: true, message: 'paired menu rendered' }, session, { keyword });
        }
        catch (error) {
            this.logCommandResult('menu-pairing', { ok: false, message: `paired menu send failed: ${String(error)}` }, session, { keyword });
        }
        return true;
    }
    getPuppeteer() {
        return this.ctx.puppeteer;
    }
    formatBytes(bytes) {
        const mb = bytes / 1024 / 1024;
        if (mb < 1024)
            return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    }
    async sampleCpuUsage(intervalMs = 160) {
        const snapshot = () => {
            const cpus = node_os_1.default.cpus();
            let idle = 0;
            let total = 0;
            for (const cpu of cpus) {
                const t = cpu.times;
                idle += t.idle;
                total += t.user + t.nice + t.sys + t.irq + t.idle;
            }
            return { idle, total };
        };
        const a = snapshot();
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        const b = snapshot();
        const idle = b.idle - a.idle;
        const total = b.total - a.total;
        if (total <= 0)
            return 0;
        const used = 1 - idle / total;
        return Math.max(0, Math.min(100, used * 100));
    }
    async renderStatusCard(session) {
        const cpuPercent = await this.sampleCpuUsage();
        const onebotStatus = await this.fetchOneBotStatus(session);
        const onlineClientsCount = await this.fetchOnlineClientsCount(session);
        const [llbotUsage, qqUsage] = await Promise.all([
            this.fetchLlbotClientUsage(),
            this.fetchQqClientUsage(),
        ]);
        const totalMem = node_os_1.default.totalmem();
        const freeMem = node_os_1.default.freemem();
        const usedMem = totalMem - freeMem;
        const usedPercent = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
        const processMem = process.memoryUsage();
        const uptimeSec = Math.floor(process.uptime());
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const s = uptimeSec % 60;
        const uptime = `${h}h ${m}m ${s}s`;
        const fallback = this.styleText(`状态：CPU ${cpuPercent.toFixed(1)}% | 内存 ${usedPercent.toFixed(1)}% | 进程RSS ${this.formatBytes(processMem.rss)}`
            + (onebotStatus ? ` | OneBot ${onebotStatus.online ? '在线' : '离线'}` : '')
            + (llbotUsage ? ` | LLBot ${llbotUsage.cpuText}/${llbotUsage.memText}` : ''));
        const puppeteer = this.getPuppeteer();
        if (!puppeteer)
            return fallback;
        const bar = (v) => Math.max(0, Math.min(100, v)).toFixed(1);
        const onlineText = onebotStatus?.online ? '在线' : '离线';
        const healthText = onebotStatus?.good ? '正常' : '异常';
        const onebotSection = onebotStatus
            ? `
      <div class="item">
        <div class="line"><span>LLOneBot 状态</span><span class="${onebotStatus.online ? 'ok' : 'bad'}">${onlineText}</span></div>
        <div class="meta">连接状态：<span class="${onebotStatus.online ? 'ok' : 'bad'}">${onlineText}</span></div>
        <div class="meta">运行状态：<span class="${onebotStatus.good ? 'ok' : 'bad'}">${healthText}</span></div>
        <div class="meta">收到消息数 / 发送消息数：${onebotStatus.stat?.message_received ?? '-'} / ${onebotStatus.stat?.message_sent ?? '-'}</div>
        <div class="meta">在线客户端数：${onlineClientsCount ?? '-'}</div>
        <div class="meta">LLBot 客户端占用：${llbotUsage ? `${llbotUsage.cpuText} / ${llbotUsage.memText} (${llbotUsage.source}:${llbotUsage.name})` : '未获取到'}</div>
        <div class="meta">QQ 客户端占用：${qqUsage ? `${qqUsage.cpuText} / ${qqUsage.memText} (${qqUsage.name})` : '未获取到'}</div>
      </div>`
            : '';
        const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html { background: transparent; }
    body { margin: 0; display: inline-block; font-family: "LXGW WenKai", "Noto Sans SC", sans-serif; color: #2b1d2a; background: #f8f3f8; }
    .bg { position: relative; padding: 22px; background: linear-gradient(165deg, #fff4fb 0%, #ffe9f4 42%, #f8f3f8 100%); }
    .bg::before { content: ""; position: absolute; inset: 0; opacity: .08; pointer-events: none;
      background-image: url("data:image/svg+xml;utf8,%3Csvg width='120' height='120' viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23bca6d9'%3E%3Ccircle cx='24' cy='24' r='6'/%3E%3Ccircle cx='44' cy='18' r='6'/%3E%3Ccircle cx='64' cy='24' r='6'/%3E%3Ccircle cx='32' cy='48' r='12'/%3E%3C/g%3E%3C/svg%3E");
      background-size: 140px 140px; }
    .card { position: relative; width: 620px; border-radius: 18px; padding: 16px 18px 14px;
      background: rgba(255,255,255,.74); border: 1px solid rgba(233,217,234,.92); box-shadow: 0 12px 28px rgba(47,20,47,.12); }
    .bar { display: flex; align-items: center; gap: 12px; padding: 2px 2px 10px; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; }
    .dots { width: 10px; height: 10px; border-radius: 50%; background: #f0b1c9; box-shadow: 16px 0 0 #f6d48f, 32px 0 0 #b9efdf; }
    .bar-title { margin-left: 28px; font-weight: 700; opacity: .88; }
    .title { font-size: 28px; font-weight: 800; margin: 0 0 4px; }
    .sub { font-size: 15px; opacity: .76; margin: 0 0 12px; }
    .item { margin-bottom: 10px; background: rgba(255,255,255,.78); border: 1px solid rgba(233,217,234,.9); border-radius: 14px; padding: 10px 12px; }
    .line { display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; margin-bottom: 6px; }
    .meter { height: 10px; border-radius: 999px; background: rgba(221, 195, 221, .45); overflow: hidden; }
    .fill { height: 100%; background: linear-gradient(90deg, #f0b1c9, #b9efdf); }
    .meta { font-size: 14px; opacity: .78; line-height: 1.45; margin-top: 4px; }
    .ok { color: #1f8f49; font-weight: 700; }
    .bad { color: #cf3f48; font-weight: 700; }
  </style>
</head>
<body>
  <div class="bg">
    <div class="card">
      <div class="bar"><span class="dots"></span><span class="bar-title">MEOW STATUS</span></div>
      <div class="title">系统状态</div>
      <div class="sub">喵~ 实时资源占用</div>

      <div class="item">
        <div class="line"><span>CPU 占用</span><span>${cpuPercent.toFixed(1)}%</span></div>
        <div class="meter"><div class="fill" style="width:${bar(cpuPercent)}%"></div></div>
      </div>

      <div class="item">
        <div class="line"><span>内存占用</span><span>${usedPercent.toFixed(1)}%</span></div>
        <div class="meter"><div class="fill" style="width:${bar(usedPercent)}%"></div></div>
        <div class="meta">系统内存：${this.formatBytes(usedMem)} / ${this.formatBytes(totalMem)}</div>
        <div class="meta">进程 RSS：${this.formatBytes(processMem.rss)}，Heap：${this.formatBytes(processMem.heapUsed)} / ${this.formatBytes(processMem.heapTotal)}</div>
        <div class="meta">进程运行时长：${uptime}</div>
      </div>
      ${onebotSection}
    </div>
  </div>
</body>
</html>`;
        try {
            return await puppeteer.render(html);
        }
        catch (error) {
            this._logger.warn(`[status] 图片渲染失败: ${String(error)}`);
            return fallback;
        }
    }
    renderCategoryHtml(title, subTitle, entries, options, narrow = true) {
        const showUsageLabel = options?.showUsageLabel ?? false;
        const lines = entries.map((item) => {
            const desc = item.desc
                ? `<span class="desc">${showUsageLabel ? '用途：' : ''}${this.escapeHtml(item.desc)}</span>`
                : '';
            return `<li><span class="name">${this.escapeHtml(item.name)}</span>${desc}</li>`;
        }).join('');
        const width = narrow ? 620 : 680;
        return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html { background: transparent; }
    body { margin: 0; display: inline-block; font-family: "LXGW WenKai", "Noto Sans SC", sans-serif; color: #2b1d2a; background: #f8f3f8; }
    .bg { position: relative; padding: 22px; background: linear-gradient(165deg, #fff4fb 0%, #ffe9f4 42%, #f8f3f8 100%); }
    .bg::before { content: ""; position: absolute; inset: 0; opacity: 0.08; pointer-events: none;
      background-image: url("data:image/svg+xml;utf8,%3Csvg width='120' height='120' viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23bca6d9'%3E%3Ccircle cx='24' cy='24' r='6'/%3E%3Ccircle cx='44' cy='18' r='6'/%3E%3Ccircle cx='64' cy='24' r='6'/%3E%3Ccircle cx='32' cy='48' r='12'/%3E%3C/g%3E%3C/svg%3E");
      background-size: 140px 140px; }
    .card { position: relative; width: ${width}px; border-radius: 18px; padding: 16px 18px 14px;
      background: rgba(255, 255, 255, 0.74); border: 1px solid rgba(233, 217, 234, 0.92); box-shadow: 0 12px 28px rgba(47, 20, 47, 0.12); }
    .bar { display: flex; align-items: center; gap: 12px; padding: 2px 2px 10px; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; }
    .dots { width: 10px; height: 10px; border-radius: 50%; background: #f0b1c9; box-shadow: 16px 0 0 #f6d48f, 32px 0 0 #b9efdf; }
    .bar-title { margin-left: 28px; font-weight: 700; opacity: .88; }
    .title { font-size: 28px; font-weight: 800; margin: 0 0 4px; }
    .sub { font-size: 15px; opacity: .76; margin: 0 0 12px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 8px; }
    li { border-radius: 14px; padding: 10px 12px; background: rgba(255,255,255,.78); border: 1px solid rgba(233, 217, 234, 0.9); }
    .name { font-size: 18px; font-weight: 700; display: block; }
    .desc { font-size: 13px; opacity: .75; display: block; margin-top: 2px; line-height: 1.35; }
    .foot { margin-top: 10px; font-size: 13px; opacity: .72; }
  </style>
</head>
<body>
  <div class="bg">
    <div class="card">
      <div class="bar"><span class="dots"></span><span class="bar-title">MEOW MENU</span></div>
      <div class="title">${this.escapeHtml(title)}</div>
      <div class="sub">${this.escapeHtml(subTitle)}</div>
      <ul>${lines}</ul>
      <div class="foot">喵~ 发送 help &lt;父指令菜单&gt; 查看子指令</div>
    </div>
  </div>
</body>
</html>`;
    }
    async renderMenu(keyword, session) {
        const categories = this.collectCategories(session);
        if (!categories.length)
            return this.styleText('没有匹配到可用指令。');
        const puppeteer = this.getPuppeteer();
        if (!puppeteer) {
            return this.styleText('未启用 puppeteer，无法生成图片菜单。');
        }
        const hit = this.resolveMenuCategory(keyword, session);
        const html = hit
            ? this.renderCategoryHtml(`Meow 菜单 · ${hit.title}`, `分类 ${hit.key}，共 ${hit.children.length} 条子指令`, hit.children, { showUsageLabel: true })
            : this.renderCategoryHtml('Meow 菜单', `共 ${categories.length} 个大分类`, categories.map((cat) => ({
                name: `${cat.title}菜单`,
                desc: cat.desc
                    ? `${cat.children.length} 条子指令 · ${cat.desc}`
                    : `${cat.children.length} 条子指令`,
            })), { showUsageLabel: false }, false);
        try {
            return await puppeteer.render(html);
        }
        catch (error) {
            this._logger.warn(`[menu] 图片渲染失败: ${String(error)}`);
            return this.styleText('图片菜单生成失败，请检查 puppeteer。');
        }
    }
    logAuth(stage, result, session) {
        if (!this.config.logAuthCheck)
            return;
        const level = result.ok ? 'info' : 'warn';
        this._logger[level](`[auth:${stage}] ${result.message} | ${this.sessionTag(session)}`);
    }
    logCommandResult(command, result, session, extra) {
        if (!this.config.logCommandResult)
            return;
        const level = result.ok ? 'info' : 'warn';
        const plan = result.plan ? JSON.stringify(result.plan) : '-';
        const payload = extra ? ` extra=${JSON.stringify(extra)}` : '';
        this._logger[level](`[cmd:${command}] ok=${result.ok} message="${result.message}" plan=${plan}${payload} | ${this.sessionTag(session)}`);
    }
    async authorizeCommand(command, session) {
        const result = await this.authorize(session);
        this.logAuth(command, result, session);
        return result;
    }
    async authorize(session) {
        if (!session) {
            return { ok: false, message: '缺少会话上下文。', userMessage: '权限不足或上下文不符合要求。' };
        }
        const platform = session.platform;
        if (!this.isPlatformAllowed(platform)) {
            return {
                ok: false,
                message: `当前平台 ${platform ?? 'unknown'} 未启用群管理。`,
                userMessage: '当前平台未启用群管理。',
            };
        }
        const userId = session.userId;
        if (!userId) {
            return { ok: false, message: '无法识别当前账号。', userMessage: '权限不足或上下文不符合要求。' };
        }
        if (this.config.allowedUserIds.includes(userId)) {
            return { ok: true, message: '账号白名单通过。' };
        }
        if (!session.guildId) {
            return {
                ok: false,
                message: '当前账号不在白名单，且仅支持在群聊中按管理员权限使用。',
                userMessage: '仅支持群聊中按管理员权限使用。',
            };
        }
        const role = await this.resolveMemberRole(session);
        if (!role) {
            return { ok: false, message: '无法获取群成员角色，权限校验失败。', userMessage: '权限校验失败。' };
        }
        if (role === 'owner' && this.config.allowGroupOwner) {
            return { ok: true, message: '群主权限通过。' };
        }
        if (role === 'admin' && this.config.allowGroupAdmin) {
            return { ok: true, message: '群管理员权限通过。' };
        }
        return {
            ok: false,
            message: '权限不足：仅账号白名单、群主或群管理员可执行。',
            userMessage: '权限不足：仅白名单、群主或群管理员可执行。',
        };
    }
    async canUseAdminCommand(session) {
        if (!this.config.requireBotOwnerForAdmin) {
            const allowed = { ok: true, message: '已关闭 bot 群主限制，admin 子命令可用。' };
            this.logAuth('admin-visibility', allowed, session);
            return allowed;
        }
        if (!session) {
            const denied = { ok: false, message: '缺少会话上下文，admin 子命令不可用。', userMessage: '当前场景不可用该子命令。' };
            this.logAuth('admin-visibility', denied, session);
            return denied;
        }
        if (!session.guildId) {
            const denied = { ok: false, message: '当前不是群聊上下文，admin 子命令不可用。', userMessage: '请在群聊中使用该子命令。' };
            this.logAuth('admin-visibility', denied, session);
            return denied;
        }
        const botId = Number(session.bot?.selfId);
        if (!Number.isFinite(botId)) {
            const denied = { ok: false, message: `bot selfId 无法解析为数字: ${session.bot?.selfId ?? 'unknown'}`, userMessage: '当前场景不可用该子命令。' };
            this.logAuth('admin-visibility', denied, session);
            return denied;
        }
        const botRole = await this.getTargetRole(session, botId);
        if (botRole === 'owner') {
            const allowed = { ok: true, message: `bot(${botId}) 在当前群是 owner，admin 子命令可用。` };
            this.logAuth('admin-visibility', allowed, session);
            return allowed;
        }
        const denied = {
            ok: false,
            message: `bot(${botId}) 在当前群角色=${botRole ?? 'unknown'}，未达到 owner，admin 子命令不可用。`,
            userMessage: '当前群中 bot 不是群主，admin 子命令不可用。',
        };
        this.logAuth('admin-visibility', denied, session);
        return denied;
    }
    async isBotOwnerInGroup(session) {
        if (!session?.bot?.selfId)
            return false;
        const botId = Number(session.bot.selfId);
        if (!Number.isFinite(botId))
            return false;
        const role = await this.getTargetRole(session, botId);
        return role === 'owner';
    }
    async resolveMemberRole(session) {
        const authorRoles = session.author?.roles ?? [];
        for (const role of authorRoles) {
            const normalized = this.normalizeRole(role);
            if (normalized)
                return normalized;
        }
        const eventRole = session.event?.member?.role;
        if (eventRole === 'owner' || eventRole === 'admin' || eventRole === 'member') {
            return eventRole;
        }
        if (session.platform !== 'onebot')
            return null;
        const onebot = session.onebot;
        if (!onebot?.getGroupMemberInfo || !session.guildId || !session.userId)
            return null;
        const groupId = Number(session.guildId);
        const userId = Number(session.userId);
        if (!Number.isFinite(groupId) || !Number.isFinite(userId))
            return null;
        try {
            const info = await onebot.getGroupMemberInfo(groupId, userId, true);
            if (info.role === 'owner' || info.role === 'admin' || info.role === 'member') {
                return info.role;
            }
            return null;
        }
        catch {
            return null;
        }
    }
    normalizeRole(input) {
        if (input === 'owner' || input === 'admin' || input === 'member') {
            return input;
        }
        if (!input || typeof input !== 'object')
            return null;
        const role = input;
        if (role.id === 'owner' || role.id === 'admin' || role.id === 'member')
            return role.id;
        if (role.name === 'owner' || role.name === 'admin' || role.name === 'member')
            return role.name;
        if (role.type === 'owner' || role.type === 'admin' || role.type === 'member')
            return role.type;
        return null;
    }
    parseTargetId(input) {
        const matched = input.match(/\d+/)?.[0];
        return matched ?? '';
    }
    randomMinutes(min = 1, max = 60) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    extractAtIds(session) {
        const ids = [];
        const seen = new Set();
        const selfId = session?.bot?.selfId != null ? String(session.bot.selfId) : '';
        const add = (id) => {
            if (id == null)
                return;
            const text = String(id).trim();
            if (!/^\d+$/.test(text) || seen.has(text) || (selfId && text === selfId))
                return;
            seen.add(text);
            ids.push(text);
        };
        for (const el of session?.elements ?? []) {
            if (el?.type === 'at' || el?.type === 'mention') {
                add(el.id ?? el.pid ?? el.qq);
            }
        }
        const content = session?.content ?? '';
        const cqRegex = /\[CQ:at,qq=(\d+)(?:,[^\]]*)?\]/gi;
        let match;
        while ((match = cqRegex.exec(content)) !== null) {
            add(match[1]);
        }
        return ids;
    }
    parseDurationToken(token) {
        if (typeof token !== 'string')
            return null;
        const matched = String(token).trim().match(/^(\d+(?:\.\d+)?)\s*(分钟|分|mins?|min|m|小时|时|h|天|d|周|w)?$/i);
        if (!matched)
            return null;
        const value = parseFloat(matched[1]);
        if (!Number.isFinite(value) || value <= 0)
            return null;
        const unit = (matched[2] || '').toLowerCase();
        let factor = 1;
        if (unit === '小时' || unit === '时' || unit === 'h') {
            factor = 60;
        }
        else if (unit === '天' || unit === 'd') {
            factor = 24 * 60;
        }
        else if (unit === '周' || unit === 'w') {
            factor = 7 * 24 * 60;
        }
        return { raw: String(token).trim(), value, hasUnit: !!unit, minutes: Math.ceil(value * factor) };
    }
    extractMuteTokens(session) {
        const content = session?.content ?? '';
        const cleaned = content.replace(/\[CQ:[^\]]+\]/g, ' ');
        const rawTokens = cleaned.split(/\s+/).filter(Boolean);
        const tokens = [];
        for (const token of rawTokens) {
            const parsed = this.parseDurationToken(token);
            if (parsed)
                tokens.push(parsed);
        }
        return { atIds: this.extractAtIds(session), tokens };
    }
    async looksLikeMemberInGroup(session, targetIdRaw) {
        const onebot = this.getOneBotApi(session);
        const groupId = this.toGroupId(session);
        const uid = Number(targetIdRaw);
        if (!onebot?.getGroupMemberInfo || groupId == null || !Number.isFinite(uid))
            return false;
        try {
            const info = await onebot.getGroupMemberInfo(groupId, uid, true);
            return !!(info && (info.user_id || info.userId || info.nickname || info.card));
        }
        catch {
            return false;
        }
    }
    async parseMuteArguments(session) {
        const usage = '禁言用法：群管 mute <@用户|QQ号> <时长>（时长示例：10、10分钟、1小时、1天）。';
        const { atIds, tokens } = this.extractMuteTokens(session);
        const withUnit = tokens.filter((t) => t.hasUnit);
        const bare = tokens.filter((t) => !t.hasUnit);
        let targetId = '';
        let duration = null;
        const fail = (message, id = '') => ({ ok: false, targetId: id, minutes: 0, message });
        if (atIds.length > 0) {
            targetId = atIds[0];
            if (withUnit.length === 1) {
                duration = withUnit[0];
            }
            else if (withUnit.length > 1) {
                return fail('检测到多个带单位的时长，无法确认要禁言多久。', targetId);
            }
            else if (bare.length === 0) {
                return fail(`已识别目标 ${targetId}，但缺少禁言时长。${usage}`, targetId);
            }
            else {
                // 无单位数字：取最后一个看起来像时长的数字（≤30天分钟数），其余忽略
                const candidates = bare.filter((t) => t.minutes <= 43200);
                duration = candidates.length > 0 ? candidates[candidates.length - 1] : null;
                if (!duration)
                    return fail('未识别到有效禁言时长（支持 1~43200 分钟）。', targetId);
            }
        }
        else if (tokens.length === 0) {
            return fail(usage);
        }
        else if (tokens.length === 1 && !tokens[0].hasUnit) {
            // 单个数字且无 @：默认是目标 QQ 号，需要补充时长（避免把时长当 QQ 用）
            return fail(`已识别目标 QQ ${tokens[0].raw}，请补充禁言时长。${usage}`, tokens[0].raw);
        }
        else {
            // 无 @：目标与时长都要从数字里区分
            if (withUnit.length === 1) {
                duration = withUnit[0];
            }
            else if (withUnit.length > 1) {
                return fail('检测到多个带单位的时长，无法确认要禁言多久。');
            }
            else {
                const candidates = bare.filter((t) => t.minutes <= 43200);
                duration = candidates.length > 0 ? candidates[candidates.length - 1] : null;
                if (!duration)
                    return fail('未识别到有效禁言时长（支持 1~43200 分钟）。');
            }
            const others = tokens.filter((t) => t !== duration);
            if (others.length === 0) {
                return fail(`已识别禁言时长 ${duration.raw} 分钟，但缺少目标 QQ 号。${usage}`);
            }
            targetId = others[0].raw;
            // 两个数字且“时长在后”时，若第一个不像群成员而第二个像，则说明用户把时长写在了前面，交换一次
            if (others.length === 1 && bare.length === 2 && duration.raw !== targetId) {
                const firstIsMember = await this.looksLikeMemberInGroup(session, targetId);
                const secondIsMember = await this.looksLikeMemberInGroup(session, duration.raw);
                if (!firstIsMember && secondIsMember) {
                    targetId = duration.raw;
                    duration = others[0];
                }
            }
        }
        if (!targetId) {
            return fail(usage);
        }
        if (!duration) {
            return fail(`已识别目标 ${targetId}，请补充禁言时长。${usage}`, targetId);
        }
        const minutes = Math.max(1, Math.floor(duration.minutes));
        if (minutes > 43200) {
            return fail('禁言时长不能超过 30 天（43200 分钟）。', targetId);
        }
        return { ok: true, targetId, minutes, message: '' };
    }
    isPrivilegedUser(session, role) {
        if (!session?.userId)
            return false;
        if (this.config.allowedUserIds.includes(session.userId))
            return true;
        return role === 'owner' || role === 'admin';
    }
    recordUnauthorizedMuteAttempt(session) {
        const key = `${session.guildId}:${session.userId}`;
        const now = Date.now();
        const windowMinutes = Math.max(1, this.config.unauthorizedMuteWindowMinutes || 10);
        const windowMs = windowMinutes * 60 * 1000;
        const threshold = Math.max(1, this.config.unauthorizedMuteAttemptThreshold || 2);
        const previous = this.unauthorizedMuteAttempts.get(key);
        if (!previous || now - previous.updatedAt > windowMs) {
            this.unauthorizedMuteAttempts.set(key, { count: 1, updatedAt: now });
            return false;
        }
        const next = { count: previous.count + 1, updatedAt: now };
        this.unauthorizedMuteAttempts.set(key, next);
        if (next.count < threshold)
            return false;
        this.unauthorizedMuteAttempts.delete(key);
        return true;
    }
    async isRegularMember(session) {
        if (!session?.userId || !session.guildId || session.platform !== 'onebot')
            return false;
        if (this.config.allowedUserIds.includes(session.userId))
            return false;
        const role = await this.resolveMemberRole(session);
        return role === 'member';
    }
    async shouldSelfGag(session, target) {
        if (!this.config.enableSelfGag)
            return false;
        if (!session?.userId || !session.guildId || session.platform !== 'onebot')
            return false;
        if (this.config.allowedUserIds.includes(session.userId))
            return false;
        const targetId = target ? this.parseTargetId(target) : session.userId;
        if (!targetId || targetId !== session.userId)
            return false;
        return this.isRegularMember(session);
    }
    async selfGag(session, reason) {
        const groupId = this.toGroupId(session);
        const userIdRaw = session.userId ?? '';
        const userId = Number(userIdRaw);
        if (!userIdRaw || !Number.isFinite(userId)) {
            return { ok: false, message: '无法识别当前账号。' };
        }
        if (groupId == null) {
            return { ok: false, message: '请在群聊中执行该命令。' };
        }
        const onebot = this.getOneBotApi(session);
        if (!onebot?.setGroupBan) {
            return { ok: false, message: '当前会话不支持 OneBot 禁言接口。' };
        }
        const minutes = this.randomMinutes(1, 60);
        const duration = minutes * 60;
        const plan = {
            action: 'gag',
            groupId: String(groupId),
            targetId: userIdRaw,
            reason: reason ? `${reason}; minutes=${minutes}` : `minutes=${minutes}`,
        };
        try {
            await onebot.setGroupBan(groupId, userId, duration);
            return { ok: true, message: `已触发口球：${userIdRaw}，随机禁言 ${minutes} 分钟`, plan };
        }
        catch (error) {
            return { ok: false, message: `口球失败: ${String(error)}`, plan };
        }
    }
    async punishUnauthorizedMuteAttempt(session, target) {
        if (!this.config.enableUnauthorizedMutePunish)
            return null;
        if (!session?.userId || !session.guildId || session.platform !== 'onebot')
            return null;
        const targetId = target ? this.parseTargetId(target) : '';
        if (!targetId || targetId === session.userId)
            return null;
        const role = await this.resolveMemberRole(session);
        if (this.isPrivilegedUser(session, role))
            return null;
        if (!this.recordUnauthorizedMuteAttempt(session))
            return null;
        const onebot = this.getOneBotApi(session);
        const groupId = this.toGroupId(session);
        const userId = Number(session.userId);
        if (!onebot?.setGroupBan || groupId == null || !Number.isFinite(userId)) {
            return null;
        }
        const minMinutes = Math.max(1, this.config.unauthorizedMutePunishMinMinutes || 1);
        const maxMinutes = Math.max(minMinutes, this.config.unauthorizedMutePunishMaxMinutes || 10);
        const minutes = this.randomMinutes(minMinutes, maxMinutes);
        const duration = minutes * 60;
        const plan = {
            action: 'punish-unauthorized-mute',
            groupId: String(groupId),
            targetId: session.userId,
            reason: `illegal-mute-attempt; minutes=${minutes}`,
        };
        try {
            await onebot.setGroupBan(groupId, userId, duration);
            return { ok: false, message: `喵~ 乱用禁言指令，已口球 ${minutes} 分钟。`, plan };
        }
        catch (error) {
            return { ok: false, message: `喵~ 检测到乱用禁言指令，但惩罚执行失败：${String(error)}`, plan };
        }
    }
    toGroupId(session) {
        const groupId = Number(session.guildId);
        if (!Number.isFinite(groupId))
            return null;
        return groupId;
    }
    getOneBotApi(session) {
        if (session.platform !== 'onebot')
            return null;
        const onebot = session.onebot;
        return onebot ?? null;
    }
    extractTextForFilter(session) {
        const raw = (session.content ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\[CQ:[^\]]+\]/g, ' ');
        return raw.trim();
    }
    hasTextContent(session) {
        const text = this.extractTextForFilter(session);
        if (text)
            return true;
        // 有的适配器把图片/表情放在 elements 里，content 可能没文字；检查是否有文字元素
        for (const el of session.elements ?? []) {
            if (el.type === 'text' && String(el.text ?? el.content ?? '').trim())
                return true;
        }
        return false;
    }
    hasImageOrFace(session) {
        const content = session.content ?? '';
        if (/\[CQ:(image|face|record|video|flash),/i.test(content))
            return true;
        if (/<img\b/i.test(content))
            return true;
        return (session.elements ?? []).some((el) => {
            const t = String(el?.type ?? '').toLowerCase();
            return t === 'img' || t === 'image' || t === 'face' || t === 'record' || t === 'video' || t === 'flash';
        });
    }
    hasCardMessage(session) {
        const content = session.content ?? '';
        if (/\[CQ:(json|xml),/i.test(content))
            return true;
        const elements = session.elements ?? [];
        return elements.some((el) => el.type === 'json' || el.type === 'xml');
    }
    hasForwardMessage(session) {
        const content = session.content ?? '';
        if (/\[CQ:forward,/i.test(content))
            return true;
        const elements = session.elements ?? [];
        return elements.some((el) => el.type === 'forward');
    }
    normalizeGuildId(guildId) {
        if (!guildId)
            return '';
        const matched = guildId.match(/\d+/)?.[0];
        return matched ?? guildId;
    }
    resolveModerationPolicy(session) {
        const currentGuild = this.normalizeGuildId(session.guildId);
        const rule = this.config.groupRules.find((item) => this.normalizeGuildId(item.guildId) === currentGuild);
        if (!rule) {
            return {
                bannedWords: this.config.bannedWords,
                blockCardMessage: this.config.blockCardMessage,
                blockForwardMessage: this.config.blockForwardMessage,
                autoDeleteViolation: this.config.autoDeleteViolation,
                sendViolationNotice: this.config.sendViolationNotice,
                enableAutoMute: this.config.enableAutoMute,
                autoMuteThreshold: this.config.autoMuteViolationThreshold,
                autoMuteMinutes: this.config.autoMuteMinutes,
                enableAutoKick: this.config.enableAutoKick,
                autoKickThreshold: this.config.autoKickViolationThreshold,
                violationWindowMinutes: this.config.autoViolationWindowMinutes,
            };
        }
        return {
            bannedWords: rule.bannedWords,
            blockCardMessage: rule.blockCardMessage,
            blockForwardMessage: rule.blockForwardMessage,
            autoDeleteViolation: rule.autoDeleteViolation,
            sendViolationNotice: rule.sendViolationNotice,
            enableAutoMute: rule.autoMuteEnabled ?? this.config.enableAutoMute,
            autoMuteThreshold: rule.autoMuteThreshold ?? this.config.autoMuteViolationThreshold,
            autoMuteMinutes: rule.autoMuteMinutes ?? this.config.autoMuteMinutes,
            enableAutoKick: rule.autoKickEnabled ?? this.config.enableAutoKick,
            autoKickThreshold: rule.autoKickThreshold ?? this.config.autoKickViolationThreshold,
            violationWindowMinutes: rule.autoViolationWindowMinutes ?? this.config.autoViolationWindowMinutes,
        };
    }
    /**
     * 违禁词分档默认分值（可通过配置用 "关键词|分值" 或 {keyword,score} 覆盖）
     * 设计原则：单独出现时属于强广告特征的词给高分（可独立触发），
     * 需要组合才能确认的弱特征词给低分（需多条累计）。
     */
    static DEFAULT_BANNED_WORD_SCORES = {
        // 显式广告行为（单条精确命中即可接近/达到阈值）
        '加群': 50, '拉人': 50, '拉群': 50, '互推': 50, '引流': 55,
        '加微信': 55, '加v': 50, '加V': 50, '加qq': 50, '加QQ': 50,
        '扫码进群': 80, '进群领': 60, '加我好友': 50, '私信我': 50,
        '点击链接': 50, '刷单': 60, '躺赚': 60, '日结': 50,
        // 需要组合确认的运营/营销词
        '邀请你': 35, '问卷': 30, '兼职': 40, '赚钱': 35, '赚米': 35,
        '返利': 45, '代理': 30, '招人': 35, '零成本': 40, '速来': 30,
        '福利群': 45, '红包群': 45, '活动群': 40, '转发群': 40,
        '免费领': 50, '免费送': 45, '领红包': 40, '抢红包': 35, '领福利': 40,
        '点击查看': 35, '名额有限': 35,
    };
    static DEFAULT_BANNED_WORD_SCORE = 40;
    normalizeBannedWordEntry(entry) {
        const raw = String(entry ?? '').trim();
        if (!raw)
            return null;
        let keyword = raw;
        let score = null;
        // 支持 "关键词|分值"、全角竖线、逗号分隔
        const m = raw.match(/^(.+?)\s*[|｜,，:：]\s*(\d{1,3})$/);
        if (m) {
            keyword = m[1].trim();
            const parsed = parseInt(m[2], 10);
            if (Number.isFinite(parsed))
                score = Math.max(0, Math.min(100, parsed));
        }
        if (!keyword)
            return null;
        if (score === null) {
            const table = this.constructor.DEFAULT_BANNED_WORD_SCORES || {};
            const hit = Object.keys(table).find((k) => k.toLowerCase() === keyword.toLowerCase());
            score = hit ? table[hit] : this.constructor.DEFAULT_BANNED_WORD_SCORE;
        }
        return { keyword, score };
    }
    normalizeBannedWordList(list) {
        const out = [];
        const seen = new Set();
        for (const entry of list ?? []) {
            let keyword;
            let score;
            if (entry && typeof entry === 'object') {
                keyword = String(entry.keyword ?? entry.word ?? entry.text ?? '').trim();
                const parsed = Number(entry.score ?? entry.weight ?? NaN);
                score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
                if (keyword && score === null) {
                    const table = this.constructor.DEFAULT_BANNED_WORD_SCORES || {};
                    const hit = Object.keys(table).find((k) => k.toLowerCase() === keyword.toLowerCase());
                    score = hit ? table[hit] : this.constructor.DEFAULT_BANNED_WORD_SCORE;
                }
            }
            else {
                const norm = this.normalizeBannedWordEntry(entry);
                if (!norm)
                    continue;
                keyword = norm.keyword;
                score = norm.score;
            }
            if (!keyword)
                continue;
            const key = keyword.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push({ keyword, score });
        }
        return out;
    }
    /**
     * 顺序子序列匹配：关键词的字符按顺序出现在文本中即命中，允许中间隔词。
     * 返回匹配跨度与紧凑度（跨度越接近词长，置信度越高）。
     */
    /**
     * 模糊命中的最低置信度门槛。
     * 短关键词（2~4 字）极易被无关文本凑齐（如「领导说…红色包装袋」凑出「领红包」），
     * 因此对短词要求更高的置信度；长词本身信息量足，门槛可放宽。
     */
    minBannedWordConfidence(keywordLength) {
        if (keywordLength <= 1)
            return 1;
        if (keywordLength <= 2)
            return 0.6;
        if (keywordLength <= 4)
            return 0.65;
        if (keywordLength <= 6)
            return 0.55;
        return 0.45;
    }
    subsequenceMatch(text, keyword) {
        if (!text || !keyword)
            return null;
        const first = text.indexOf(keyword);
        if (first >= 0) {
            return { start: first, end: first + keyword.length, span: keyword.length, ratio: 1, exact: true };
        }
        const chars = Array.from(keyword);
        let pos = 0;
        let start = -1;
        let end = -1;
        for (let i = 0; i < chars.length; i++) {
            const idx = text.indexOf(chars[i], pos);
            if (idx < 0) {
                // 单个字符找不到即判定不命中
                return null;
            }
            if (i === 0)
                start = idx;
            end = idx;
            pos = idx + 1;
        }
        const span = end - start + 1;
        const overflow = span - chars.length;
        // 分散过滤：隔得太开（跨度超过词长 + 8 或 3 倍词长）视为偶然凑齐
        if (span > chars.length * 3 || overflow > 8) {
            return null;
        }
        // 置信度按「词长归一化的溢出」衰减：短词对间隔更敏感
        // 例：领红包(len3) 在「领xxx元红包」(span6,overflow3) → 1-0.25*1 = 0.75
        const confidence = Math.max(0.25, 1 - 0.25 * (overflow / chars.length));
        // 短词需要更高置信度才算命中，避免无关文本偶然凑齐字符
        if (confidence < this.minBannedWordConfidence(chars.length)) {
            return null;
        }
        return { start, end: end + 1, span, overflow, ratio: chars.length / span, confidence, exact: false };
    }
    evaluateBannedWords(text, policy) {
        const words = this.normalizeBannedWordList(policy?.bannedWords ?? []);
        const evaluations = [];
        let total = 0;
        for (const { keyword, score } of words) {
            if (!keyword || keyword.length < 1)
                continue;
            const match = this.subsequenceMatch(text, keyword);
            if (!match)
                continue;
            const confidence = match.exact ? 1 : (match.confidence ?? 0.3);
            const gained = Math.round(score * Math.min(1, confidence) * 100) / 100;
            if (gained <= 0)
                continue;
            total += gained;
            evaluations.push({
                keyword,
                score,
                confidence: Math.round(Math.min(1, confidence) * 100) / 100,
                gained,
                span: match.span,
                exact: !!match.exact,
            });
        }
        evaluations.sort((a, b) => b.gained - a.gained);
        return { total: Math.round(total * 100) / 100, evaluations };
    }
    detectViolation(session, policy, type = 'message') {
        // 纯图片/表情/贴纸（无实际文字内容）的消息不作为违规处理，避免表情包被当成违禁词
        if (type === 'message' && this.hasImageOrFace(session) && !this.hasTextContent(session)) {
            return null;
        }
        if (policy.blockCardMessage && this.hasCardMessage(session)) {
            return { type: 'card', detail: '检测到卡片消息(json/xml)' };
        }
        if (policy.blockForwardMessage && this.hasForwardMessage(session)) {
            return { type: 'forward', detail: '检测到合并转发消息(forward)' };
        }
        const text = this.extractTextForFilter(session);
        if (!text)
            return null;
        const assessment = this.evaluateBannedWords(text, policy);
        const threshold = Math.max(1, Math.min(100, Number(this.config.bannedWordScoreThreshold ?? 70)));
        if (assessment.total >= threshold) {
            const top = assessment.evaluations.slice(0, 4)
                .map((item) => `${item.keyword}(+${item.gained}${item.exact ? '' : `/${item.confidence}`})`)
                .join(' ');
            return {
                type: 'banned-word',
                detail: `违禁词评分 ${assessment.total}/${threshold}：${top}`,
                assessment,
            };
        }
        return null;
    }
    async deleteMessage(session) {
        const onebot = this.getOneBotApi(session);
        const messageId = session.messageId;
        if (!onebot?.deleteMsg || !messageId)
            return false;
        try {
            await onebot.deleteMsg(messageId);
            return true;
        }
        catch (error) {
            this._logger.warn(`[moderation] 撤回失败: ${String(error)} | ${this.sessionTag(session)}`);
            return false;
        }
    }
    async shouldExemptViolationPunish(session) {
        if (!session?.userId || !session.guildId || session.platform !== 'onebot')
            return true;
        if (session.bot?.selfId && session.userId === String(session.bot.selfId))
            return true;
        if (this.config.allowedUserIds.includes(session.userId))
            return true;
        const role = await this.resolveMemberRole(session);
        return role === 'owner' || role === 'admin';
    }
    recordViolation(session, policy) {
        const key = `${session.guildId}:${session.userId}`;
        const windowMs = Math.max(1, policy.violationWindowMinutes || 60) * 60 * 1000;
        const now = Date.now();
        const prev = this.violationRecords.get(key);
        let count = 1;
        if (prev && now - prev.lastAt <= windowMs) {
            count = (prev.count || 0) + 1;
        }
        this.violationRecords.set(key, { count, lastAt: now });
        return count;
    }
    clearViolationRecord(session) {
        this.violationRecords.delete(`${session.guildId}:${session.userId}`);
    }
    async autoModerationPunish(session, policy) {
        if (session.platform !== 'onebot')
            return null;
        if (await this.shouldExemptViolationPunish(session))
            return null;
        const count = this.recordViolation(session, policy);
        const onebot = this.getOneBotApi(session);
        const groupId = this.toGroupId(session);
        const userId = Number(session.userId);
        if (!onebot?.setGroupBan || groupId == null || !Number.isFinite(userId)) {
            return { ok: false, action: 'none', count, message: '当前会话不支持自动处理接口，仅记录违规计数。' };
        }
        const kickThreshold = Math.max(1, Math.floor(policy.autoKickThreshold || 5));
        const muteThreshold = Math.max(1, Math.floor(policy.autoMuteThreshold || 3));
        if (policy.enableAutoKick && count >= kickThreshold && onebot?.setGroupKick) {
            try {
                await onebot.setGroupKick(groupId, userId, false);
                this.clearViolationRecord(session);
                return { ok: true, action: 'auto-kick', count, message: `累计违规 ${count} 次，已自动移出群聊。` };
            }
            catch (error) {
                return { ok: false, action: 'auto-kick', count, message: `自动移出群聊失败: ${String(error)}` };
            }
        }
        if (policy.enableAutoMute && count >= muteThreshold) {
            const requested = Math.max(1, Math.floor(policy.autoMuteMinutes || 10));
            const minutes = Math.min(requested, 43200);
            const duration = minutes * 60;
            try {
                await onebot.setGroupBan(groupId, userId, duration);
                return { ok: true, action: 'auto-mute', count, minutes, message: `累计违规 ${count} 次，已自动禁言 ${minutes} 分钟。` };
            }
            catch (error) {
                return { ok: false, action: 'auto-mute', count, message: `自动禁言失败: ${String(error)}` };
            }
        }
        return { ok: true, action: 'none', count, message: `累计违规 ${count} 次（自动禁言线 ${muteThreshold} 次 / 自动踢人线 ${kickThreshold} 次）。` };
    }
    async handleGroupModeration(session) {
        if (!this.isPlatformAllowed(session.platform))
            return;
        if (await this.handleMenuPairing(session))
            return;
        if (await this.handleMemoryCommand(session))
            return;
        if (!session.guildId)
            return;
        if (session.userId && session.bot?.selfId && session.userId === session.bot.selfId)
            return;
        if (await this.handleJoinRequestReviewMessage(session))
            return;
        if (session.platform === 'onebot') {
            const policy = this.resolveModerationPolicy(session);
            const violation = this.detectViolation(session, policy);
            if (violation) {
                let deleted = false;
                if (policy.autoDeleteViolation) {
                    deleted = await this.deleteMessage(session);
                }
                const scoreInfo = violation.assessment
                    ? ` score=${violation.assessment.total} hits=${violation.assessment.evaluations.map((item) => `${item.keyword}:${item.gained}${item.exact ? '' : '/fuzzy'}`).join(',')}`
                    : '';
                this._logger.warn(`[moderation] type=${violation.type} detail="${violation.detail}"${scoreInfo} deleted=${deleted} | ${this.sessionTag(session)}`);
                if (policy.sendViolationNotice) {
                    const notice = violation.type === 'banned-word'
                        ? `检测到违禁内容（评分 ${violation.assessment?.total ?? '-'}），消息已处理。`
                        : violation.type === 'card'
                            ? '卡片消息不被允许，消息已处理。'
                            : '合并转发消息不被允许，消息已处理。';
                    try {
                        await session.send(this.styleText(notice));
                    }
                    catch {
                        // ignore notice failures
                    }
                }
                // 自动管控：累计违规达到阈值后自动禁言/自动踢人
                if (policy.enableAutoMute || policy.enableAutoKick) {
                    try {
                        const punish = await this.autoModerationPunish(session, policy);
                        if (punish) {
                            this._logger.info(`[auto-moderation] action=${punish.action} ok=${punish.ok} count=${punish.count} | ${this.sessionTag(session)}`);
                            if (punish.action !== 'none') {
                                if (policy.sendViolationNotice) {
                                    try {
                                        await session.send(this.styleText(punish.message));
                                    }
                                    catch {
                                        // ignore notice failures
                                    }
                                }
                                else if (!punish.ok) {
                                    this._logger.warn(`[auto-moderation] ${punish.message} | ${this.sessionTag(session)}`);
                                }
                            }
                        }
                    }
                    catch (error) {
                        this._logger.warn(`[auto-moderation] failed: ${String(error)} | ${this.sessionTag(session)}`);
                    }
                }
                return;
            }
        }
        try {
            await this.handleRepeater(session);
        }
        catch (error) {
            this._logger.warn(`[repeater] failed: ${String(error)} | ${this.sessionTag(session)}`);
        }
        await this.maybeReplyWithAi(session);
    }
    cleanupPendingJoinRequests() {
        const ttlMs = Math.max(1, this.config.joinRequestReviewTtlMinutes || 30) * 60 * 1000;
        const now = Date.now();
        for (const [code, item] of this.pendingJoinRequests) {
            if (now - item.createdAt <= ttlMs)
                continue;
            this.pendingJoinRequests.delete(code);
            this.pendingJoinRequestFlags.delete(item.flag);
        }
    }
    generateJoinRequestCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for (let i = 0; i < 16; i += 1) {
            let code = '';
            for (let j = 0; j < 6; j += 1) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
            if (!this.pendingJoinRequests.has(code))
                return code;
        }
        return `${Date.now().toString(36).toUpperCase().slice(-6)}`;
    }
    parseJoinRequestReviewText(text) {
        let source = String(text).trim();
        if (!source)
            return null;
        // 去掉可能的命令前缀（如 [bot]）
        source = source.replace(/^\[[^\]]+\]\s*/, '').trim();
        // 支持 同意/拒绝 [编号] [理由]（编号可省略）
        const approveMatch = source.match(/^(同意|通过|放行|批准|approve|ok|yes)\s*(?:入群|申请)?\s*#?([A-Za-z0-9]{4,12})?\s*([\s\S]*)$/i);
        if (approveMatch) {
            return { approve: true, code: approveMatch[2] ? approveMatch[2].toUpperCase() : '', reason: (approveMatch[3] || '').trim() };
        }
        const rejectMatch = source.match(/^(拒绝|驳回|拒|deny|reject|no|refuse)\s*(?:入群|申请)?\s*#?([A-Za-z0-9]{4,12})?\s*([\s\S]*)$/i);
        if (rejectMatch) {
            return { approve: false, code: rejectMatch[2] ? rejectMatch[2].toUpperCase() : '', reason: (rejectMatch[3] || '').trim() };
        }
        return null;
    }
    async handleJoinRequestReviewMessage(session) {
        if (!this.resolveJoinReviewEnabled(session))
            return false;
        if (session.platform !== 'onebot' || !session.guildId)
            return false;
        const parsed = this.parseJoinRequestReviewText(this.getMessageText(session));
        if (!parsed)
            return false;
        const auth = await this.authorizeCommand('review-join-request', session);
        if (!auth.ok)
            return false;
        const result = await this.reviewJoinRequestDecision(session, parsed.code, parsed.approve, parsed.reason);
        this.logCommandResult('review-join-request', result, session, { code: parsed.code, approve: parsed.approve, from: 'message' });
        await session.send(this.styleText(result.message));
        return true;
    }
    resolveJoinReviewEnabled(session) {
        const guildId = this.normalizeGuildId(session?.guildId);
        const rule = this.config.groupRules?.find((item) => this.normalizeGuildId(item.guildId) === guildId);
        if (typeof rule?.enableJoinRequestReview === 'boolean')
            return rule.enableJoinRequestReview;
        return !!this.config.enableJoinRequestReview;
    }
    async fetchStrangerInfo(bot, userId) {
        if (!bot || !userId)
            return null;
        // 兼容不同 OneBot 适配器的方法命名
        try {
            if (typeof bot.getStrangerInfo === 'function')
                return await bot.getStrangerInfo(userId, true);
        }
        catch { /* ignore */ }
        try {
            if (typeof bot.get_stranger_info === 'function')
                return await bot.get_stranger_info(userId, true);
        }
        catch { /* ignore */ }
        return null;
    }
    buildJoinRequestPrompt(applicant, extra) {
        const lines = [
            '检测到新的入群申请，请管理员审核：',
            `QQ号：${applicant.userId}`,
        ];
        if (extra?.nickname)
            lines.push(`昵称：${extra.nickname}`);
        if (extra?.sex)
            lines.push(`性别：${extra.sex}`);
        if (extra?.age !== undefined && extra.age !== '')
            lines.push(`年龄：${extra.age}`);
        if (extra?.level)
            lines.push(`QQ等级：${extra.level}`);
        lines.push(`验证信息：${applicant.comment || '(无)'}`);
        lines.push(`同意：${this.config.command} 同意 [理由]`);
        lines.push(`拒绝：${this.config.command} 拒绝 [理由]`);
        return lines.join('\n');
    }
    async handleGuildMemberRequest(session) {
        if (!this.resolveJoinReviewEnabled(session))
            return;
        if (!this.isPlatformAllowed(session.platform))
            return;
        if (session.platform !== 'onebot')
            return;
        if (!session.guildId || !session.messageId || !session.userId)
            return;
        this.cleanupPendingJoinRequests();
        if (this.pendingJoinRequestFlags.has(session.messageId))
            return;
        const code = this.generateJoinRequestCode();
        const item = {
            code,
            flag: session.messageId,
            guildId: session.guildId,
            userId: session.userId,
            comment: (session.content || '').trim(),
            createdAt: Date.now(),
        };
        this.pendingJoinRequests.set(code, item);
        this.pendingJoinRequestFlags.set(item.flag, code);
        // 尽力获取申请者信息（昵称/性别/年龄/等级/头像）
        let extra = {};
        const bot = this.getOneBotApi(session);
        const info = await this.fetchStrangerInfo(bot, session.userId);
        if (info) {
            const nickname = info.nickname || info.card || info.name || '';
            let sex = info.sex || info.gender || '';
            if (sex === 'male')
                sex = '男';
            else if (sex === 'female')
                sex = '女';
            else if (sex === 'unknown' || sex === '')
                sex = '未知';
            const level = (info.level !== undefined && info.level !== null) ? String(info.level) : '';
            extra = {
                nickname,
                sex: sex || '',
                age: info.age,
                level,
                avatarUrl: `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(session.userId)}&s=640`,
            };
        }
        const prompt = this.buildJoinRequestPrompt(item, extra);
        try {
            if (extra?.avatarUrl) {
                // 直接把头像图片发到群里，而不是给链接
                await session.send([koishi_1.h.text(this.styleText(prompt)), koishi_1.h.image(extra.avatarUrl)]);
            }
            else {
                await session.send(this.styleText(prompt));
            }
            this.logCommandResult('join-request', { ok: true, message: 'join request notice sent' }, session, { target: item.userId });
        }
        catch (error) {
            this.logCommandResult('join-request', { ok: false, message: `join request notice failed: ${String(error)}` }, session, { target: item.userId });
        }
    }
    async reviewJoinRequestDecision(session, code, approve, reason) {
        this.cleanupPendingJoinRequests();
        let item;
        const key = (code || '').trim().toUpperCase();
        if (key) {
            item = this.pendingJoinRequests.get(key);
            if (!item)
                return { ok: false, message: `未找到审核编号 ${key}，可能已处理或已过期。` };
            if (session.guildId !== item.guildId)
                return { ok: false, message: `审核编号 ${key} 不属于当前群。` };
        }
        else {
            // 无编号：取当前群最近一条待审核申请
            const candidates = [...this.pendingJoinRequests.values()].filter((x) => x.guildId === session.guildId);
            if (!candidates.length)
                return { ok: false, message: '当前没有待审核的入群申请。' };
            item = candidates[candidates.length - 1];
        }
        const plan = {
            action: approve ? 'approve-join-request' : 'reject-join-request',
            groupId: item.guildId,
            targetId: item.userId,
            reason: `${reason || ''}`,
        };
        if (this.config.dryRun)
            return this.createDryRunResult(plan);
        const bot = session.bot;
        if (!bot?.handleGuildMemberRequest) {
            return { ok: false, message: '当前适配器不支持处理入群申请。', plan };
        }
        try {
            await bot.handleGuildMemberRequest(item.flag, approve, reason || '');
            this.pendingJoinRequests.delete(item.code);
            this.pendingJoinRequestFlags.delete(item.flag);
            return {
                ok: true,
                message: approve
                    ? `已放行入群申请：${item.userId}`
                    : `已拒绝入群申请：${item.userId}`,
                plan,
            };
        }
        catch (error) {
            return { ok: false, message: `处理入群申请失败: ${String(error)}`, plan };
        }
    }
    async formatTargetDisplay(session, targetId, rawTarget) {
        if (!targetId)
            return '';
        const fromAt = rawTarget?.match(/name="([^"]+)"/)?.[1]?.trim();
        if (!session?.guildId || session.platform !== 'onebot') {
            return fromAt ? `${fromAt}(${targetId})` : targetId;
        }
        const onebot = this.getOneBotApi(session);
        const groupId = this.toGroupId(session);
        const uid = Number(targetId);
        if (!onebot?.getGroupMemberInfo || groupId == null || !Number.isFinite(uid)) {
            return fromAt ? `${fromAt}(${targetId})` : targetId;
        }
        try {
            const info = await onebot.getGroupMemberInfo(groupId, uid, true);
            const name = info.card?.trim() || info.nickname?.trim() || fromAt;
            return name ? `${name}(${targetId})` : targetId;
        }
        catch {
            return fromAt ? `${fromAt}(${targetId})` : targetId;
        }
    }
    async getTargetRole(session, targetId) {
        const onebot = this.getOneBotApi(session);
        const groupId = this.toGroupId(session);
        if (!onebot?.getGroupMemberInfo || groupId == null)
            return null;
        try {
            const info = await onebot.getGroupMemberInfo(groupId, targetId, true);
            if (info.role === 'owner' || info.role === 'admin' || info.role === 'member')
                return info.role;
            return null;
        }
        catch {
            return null;
        }
    }
    createDryRunResult(plan) {
        return {
            ok: true,
            message: 'dry-run: no action executed',
            plan,
        };
    }
    async planDemoAction(groupId, reason) {
        const plan = {
            action: 'demo',
            groupId,
            reason,
        };
        return {
            ok: true,
            message: this.config.dryRun ? 'dry-run: no action executed' : 'action executor not implemented yet',
            plan,
        };
    }
    async kick(session, target, rejectAddRequest = false, reason) {
        const targetIdRaw = this.parseTargetId(target);
        const targetId = Number(targetIdRaw);
        const groupId = this.toGroupId(session);
        if (!targetIdRaw || !Number.isFinite(targetId)) {
            return { ok: false, message: '目标 QQ 号无效。' };
        }
        if (groupId == null) {
            return { ok: false, message: '请在群聊中执行该命令。' };
        }
        const plan = {
            action: 'kick',
            groupId: String(groupId),
            targetId: targetIdRaw,
            reason,
        };
        if (this.config.dryRun)
            return this.createDryRunResult(plan);
        const onebot = this.getOneBotApi(session);
        if (!onebot?.setGroupKick) {
            return { ok: false, message: '当前会话不支持 OneBot 踢人接口。' };
        }
        const role = await this.getTargetRole(session, targetId);
        if (role === 'owner') {
            return { ok: false, message: '不能对群主执行踢人操作。' };
        }
        try {
            await onebot.setGroupKick(groupId, targetId, rejectAddRequest);
            return { ok: true, message: `已执行踢人: ${targetIdRaw}`, plan };
        }
        catch (error) {
            return { ok: false, message: `踢人失败: ${String(error)}`, plan };
        }
    }
    async mute(session, target, minutes, reason) {
        const targetIdRaw = this.parseTargetId(target);
        const targetId = Number(targetIdRaw);
        const groupId = this.toGroupId(session);
        if (!targetIdRaw || !Number.isFinite(targetId)) {
            return { ok: false, message: '目标 QQ 号无效。' };
        }
        if (groupId == null) {
            return { ok: false, message: '请在群聊中执行该命令。' };
        }
        if (!Number.isFinite(minutes) || minutes <= 0) {
            return { ok: false, message: '禁言时长必须为正整数分钟（上限 30 天）。' };
        }
        const requestedMinutes = Math.floor(minutes);
        const capped = requestedMinutes > 43200;
        const effectiveMinutes = Math.min(requestedMinutes, 43200);
        const duration = effectiveMinutes * 60;
        const plan = {
            action: 'mute',
            groupId: String(groupId),
            targetId: targetIdRaw,
            reason: reason ? `${reason}; minutes=${requestedMinutes}` : `minutes=${requestedMinutes}`,
        };
        if (this.config.dryRun)
            return this.createDryRunResult(plan);
        const onebot = this.getOneBotApi(session);
        if (!onebot?.setGroupBan) {
            return { ok: false, message: '当前会话不支持 OneBot 禁言接口。' };
        }
        if (this.config.allowedUserIds.includes(targetIdRaw)) {
            const actorRole = await this.resolveMemberRole(session);
            const bypass = this.config.allowAdminBypassWhitelistMute && (actorRole === 'owner' || actorRole === 'admin');
            if (!bypass) {
                return { ok: false, message: '目标账号在白名单保护中，禁止禁言。' };
            }
        }
        const role = await this.getTargetRole(session, targetId);
        if (role === 'owner') {
            return { ok: false, message: '喵~ 群主无法被禁言。' };
        }
        if (role === 'admin' && !await this.isBotOwnerInGroup(session)) {
            return { ok: false, message: '喵~ bot 不是群主，不能对管理员禁言。' };
        }
        try {
            await onebot.setGroupBan(groupId, targetId, duration);
            const capNote = capped ? '（已按 30 天上限处理）' : '';
            return { ok: true, message: `已执行禁言: ${targetIdRaw}, ${effectiveMinutes} 分钟${capNote}`, plan };
        }
        catch (error) {
            return { ok: false, message: `禁言失败: ${String(error)}`, plan };
        }
    }
    async unmute(session, target, reason) {
        const targetIdRaw = this.parseTargetId(target);
        const targetId = Number(targetIdRaw);
        const groupId = this.toGroupId(session);
        if (!targetIdRaw || !Number.isFinite(targetId)) {
            return { ok: false, message: '目标 QQ 号无效。' };
        }
        if (groupId == null) {
            return { ok: false, message: '请在群聊中执行该命令。' };
        }
        const plan = {
            action: 'unmute',
            groupId: String(groupId),
            targetId: targetIdRaw,
            reason,
        };
        if (this.config.dryRun)
            return this.createDryRunResult(plan);
        const onebot = this.getOneBotApi(session);
        if (!onebot?.setGroupBan) {
            return { ok: false, message: '当前会话不支持 OneBot 禁言接口。' };
        }
        const role = await this.getTargetRole(session, targetId);
        if (role === 'owner') {
            return { ok: false, message: '不能对群主执行解禁言操作。' };
        }
        try {
            await onebot.setGroupBan(groupId, targetId, 0);
            return { ok: true, message: `已执行解禁言: ${targetIdRaw}`, plan };
        }
        catch (error) {
            return { ok: false, message: `解禁言失败: ${String(error)}`, plan };
        }
    }
    async setAdmin(session, target, enable, reason) {
        const targetIdRaw = this.parseTargetId(target);
        const targetId = Number(targetIdRaw);
        const groupId = this.toGroupId(session);
        if (!targetIdRaw || !Number.isFinite(targetId)) {
            return { ok: false, message: '目标 QQ 号无效。' };
        }
        if (groupId == null) {
            return { ok: false, message: '请在群聊中执行该命令。' };
        }
        const plan = {
            action: enable ? 'set-admin' : 'unset-admin',
            groupId: String(groupId),
            targetId: targetIdRaw,
            reason,
        };
        if (this.config.dryRun)
            return this.createDryRunResult(plan);
        const onebot = this.getOneBotApi(session);
        if (!onebot?.setGroupAdmin) {
            return { ok: false, message: '当前会话不支持 OneBot 设管理接口。' };
        }
        const role = await this.getTargetRole(session, targetId);
        if (role === 'owner') {
            return { ok: false, message: '群主不需要设置管理员。' };
        }
        try {
            await onebot.setGroupAdmin(groupId, targetId, enable);
            return { ok: true, message: enable ? `已设置管理员: ${targetIdRaw}` : `已取消管理员: ${targetIdRaw}`, plan };
        }
        catch (error) {
            return { ok: false, message: `设置管理员失败: ${String(error)}`, plan };
        }
    }
}
exports.QQGroupManagerService = QQGroupManagerService;
