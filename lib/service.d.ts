export const __esModule: boolean;
export class QQGroupManagerService extends koishi_1.Service<any, koishi_1.Context> {
    /**
     * 违禁词分档默认分值（可通过配置用 "关键词|分值" 或 {keyword,score} 覆盖）
     * 设计原则：单独出现时属于强广告特征的词给高分（可独立触发），
     * 需要组合才能确认的弱特征词给低分（需多条累计）。
     */
    static DEFAULT_BANNED_WORD_SCORES: {
        加群: number;
        拉人: number;
        拉群: number;
        互推: number;
        引流: number;
        加微信: number;
        加v: number;
        加V: number;
        加qq: number;
        加QQ: number;
        扫码进群: number;
        进群领: number;
        加我好友: number;
        私信我: number;
        点击链接: number;
        刷单: number;
        躺赚: number;
        日结: number;
        邀请你: number;
        问卷: number;
        兼职: number;
        赚钱: number;
        赚米: number;
        返利: number;
        代理: number;
        招人: number;
        零成本: number;
        速来: number;
        福利群: number;
        红包群: number;
        活动群: number;
        转发群: number;
        免费领: number;
        免费送: number;
        领红包: number;
        抢红包: number;
        领福利: number;
        点击查看: number;
        名额有限: number;
    };
    static DEFAULT_BANNED_WORD_SCORE: number;
    constructor(ctx: any, config: any);
    ctx: any;
    _logger: any;
    unauthorizedMuteAttempts: Map<any, any>;
    repeatStates: Map<any, any>;
    pendingJoinRequests: Map<any, any>;
    pendingJoinRequestFlags: Map<any, any>;
    violationRecords: Map<any, any>;
    _imageDataUrlCache: Map<any, any>;
    /** 定时提醒：id -> reminder */
    _reminders: Map<any, any>;
    /** 定时提醒：id -> timer */
    _reminderTimers: Map<any, any>;
    /** 群空闲话题：groupId -> timer */
    _idleTimers: Map<any, any>;
    /** 上次主动话题时间：groupId -> ts */
    _lastIdleTopicAt: Map<any, any>;
    /** 记忆库写锁：串行化「读整档→改→整写」，防止并发写互相覆盖 */
    _memoryWriteLock: Promise<void>;
    /** 待审入群申请的落盘去抖定时器 */
    _pendingJoinSaveTimer: any;
    /** 待审单落盘串行化（防止 dispose 与去抖写同时进行） */
    _pendingJoinWriteChain: Promise<void>;
    /** 待审单落盘 helper */
    runPendingJoinWriteLocked(task: any): Promise<any>;
    /** 安全读取布尔配置（字段缺失/未定义时返回默认值） */
    cfgBool(key: any, def: any): any;
    /** 事件里的操作者 QQ（踢人事件用） */
    eventOperatorId(session: any): string;
    /**
     * 把任意形态的 ID 归一成纯数字 QQ 号，便于比较。
     * 兼容 'onebot:12345'、12345（number）、'12345'。
     * selfId 取自 session.bot.selfId（session.selfId 在 Koishi 里通常不存在）。
     */
    normalizeQqForCompare(value: any): string;
    /** bot 自身 QQ */
    selfQqForCompare(session: any): string;
    /**
     * 求「被移出群聊的人」的 QQ，并标记身份是否可确证。
     *
     * 字段语义（Koishi onebot）：
     * - `session.targetId` 存在时，就是被移出的人，最可信；
     * - `session.userId` 在移出事件里通常是**操作者**（bot 自己踢人时就是 bot），
     *   只有没有 targetId 时才退而用它，且仅当它与操作者不同（=当时是被踢者）才可采信；
     * - 永远排除 bot 自己。
     *
     * 返回 `{ id, certain }`。`certain=false` 表示只是猜测，宁可漏记也不误拉黑。
     */
    resolveRemovedMemberId(session: any): {
        id: string;
        certain: boolean;
    };
    /** 踢人后记入黑名单（供自动踢人/手动踢人复用） */
    recordKickToBlacklist(session: any, qq: any): Promise<void>;
    /**
     * 群成员被移出 → 记入本群黑名单。
     *
     * 只在「明确判定为被踢」时记录。历史 bug：原先写的是
     * `if (session.subtype && session.subtype !== 'passive') return;`，
     * subtype 缺失（undefined）时会继续往下走，把**主动退群**的人也当被踢记进黑名单，
     * 并且会误用 session.userId（可能是踢人者/事件消费者）。
     * 现在改为白名单式判定：只有 subtype === 'passive' 才处理。
     */
    handleMemberRemoved(session: any): Promise<void>;
    /**
     * 有人入群 → 比对黑名单，命中则踢出并提示。
     */
    handleMemberAdded(session: any): Promise<void>;
    ai: AiEngine;
    /** 外部插件扩展点：提示词风格段 + 输出过滤（接口版本见 AiHookRegistry.version） */
    get aiHooks(): import("./ai/hooks").AiHookRegistry;
    reminderFilePath(): any;
    loadReminders(): void;
    saveReminders(): void;
    clearReminderTimer(id: any): void;
    scheduleReminder(reminder: any): void;
    fireReminder(id: any): Promise<void>;
    addReminder(reminder: any): void;
    formatReminderTime(at: any): string;
    sendReminderList(session: any): Promise<void>;
    cancelReminder(session: any, id: any): Promise<void>;
    handleReminderCommand(session: any, rest: any): Promise<boolean>;
    handleReminderRequest(session: any): Promise<boolean>;
    touchIdleTopic(session: any): void;
    fireIdleTopic(groupId: any): Promise<void>;
    sendGroupText(groupId: any, text: any): Promise<void>;
    disposeSchedulers(): void;
    isPlatformAllowed(platform: any): any;
    sessionTag(session: any): string;
    styleText(text: any): any;
    getMessageText(session: any): any;
    aiGroupKey(session: any): string;
    /**
     * 统一的三态开关解析：单个群设置优先，未设置时跟随全局。
     *
     * 规则（这是本插件的核心约定）：
     *   1) 单个群**显式设置**了该值 → 无条件以它为准，**不受全局开关影响**
     *      （所以全局关着，某个群单独打开也能生效）
     *   2) 单个群**未设置**（undefined）→ 跟随全局
     *
     * 注意：用 `!== undefined` 判断，这样 `false` 也算"已设置"，
     * 不会被 `??` 或 `||` 误判为"未设置"。
     */
    resolveSwitch(rule: any, ruleKey: any, globalKey: any): any;
    extractAiMessageText(session: any): any;
    /**
     * 解析本群黑名单文件路径。
     * 文件名由模板推导：banMember.md -> banMember_<群号>.md
     * 这样每个群一份独立文件，可在 Explorer 中分别查看/编辑。
     */
    getBlacklistFilePath(session: any): any;
    readBlacklistFile(session: any): Promise<any>;
    writeBlacklistFile(session: any, content: any): Promise<void>;
    /** 解析 banMember.md -> [{qq, name, at}]，按 QQ 去重 */
    parseBlacklist(content: any): any[];
    /** 序列化（保持人类可读，便于在 Explorer 里直接改） */
    serializeBlacklist(entries: any, groupId: any): string;
    getBlacklist(session: any): Promise<any[]>;
    isBlacklisted(session: any, qq: any): Promise<boolean>;
    /** 加入本群黑名单。返回 { ok, message } */
    addToBlacklist(session: any, qq: any, name: any): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** 从本群黑名单移除。返回 { ok, message } */
    removeFromBlacklist(session: any, qq: any): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** 该群是否启用黑名单（单群设置优先，未设置跟随全局） */
    resolveBlacklistEnabled(session: any): any;
    /** 取群成员信息（用于校验"必须是群内人员"并拿到昵称） */
    /**
     * 提取本条消息中 @ 到的目标 QQ 号（@ 可代替 QQ 号作为指令目标）。
     * 支持三种来源：CQ 码 [CQ:at,qq=xxx]、Koishi 的 at 元素、content 里的 <at id="xxx"/>。
     * 排除 @全体成员 与 @机器人自身。
     */
    extractMentionedTargets(session: any): any[];
    fetchGroupMember(session: any, qq: any): Promise<{
        qq: string;
        name: string;
    }>;
    getMemoryFilePath(): any;
    readMemoryFile(): Promise<any>;
    writeMemoryFile(content: any): Promise<void>;
    extractMemoryBlocks(content: any): string[];
    /**
     * 记忆库写互斥：把「读整档 → 改 → 整写」串行化。
     * 并发保存时后一次读到的才是前一次写完的内容，不会互相覆盖丢条目。
     * 记忆属于低频写，一把 promise 队列足够，无需文件锁。
     */
    runMemoryWriteLocked(task: any): Promise<any>;
    saveMemoryToFile(userId: any, content: any): Promise<any>;
    searchMemory(keyword: any, limit?: number): Promise<string[]>;
    /** 按关键词删除记忆条目（含该关键词的整条记忆块）。返回 { ok, removed, message } */
    deleteMemoryByKeyword(keyword: any): Promise<any>;
    getDisplayName(session: any): any;
    splitAiReplyParts(text: any): any;
    waitHumanLikeDelay(minMs?: number, maxMs?: number): Promise<void>;
    extractImageUrls(session: any): any[];
    isImageReference(value: any): boolean;
    extractImageCandidates(session: any, maxCount?: number): any[];
    detectImageMime(buffer: any, fallback?: string): string;
    resolveImageReferenceToDataUrl(ref: any, session: any): Promise<any>;
    fetchImageAsDataUrl(url: any, extraHeaders?: {}): Promise<any>;
    rememberImageDataUrl(url: any, dataUrl: any): void;
    resolveImagesForModel(refs: any, session: any, maxCount: any): Promise<any[]>;
    /**
     * 把 extractImageElements 的结构化条目解析为可直接喂给模型的 data URL。
     * 每个条目会依次尝试：原始 URL -> 本地文件名（走 OneBot get_image）。
     */
    resolveVisualItemsForModel(items: any, session: any, maxCount: any): Promise<any[]>;
    isImageSendableUrl(value: any): boolean;
    decodeHtmlEntities(value: any): string;
    parseHtmlTagParams(tag: any): {};
    extractImageElements(session: any): any[];
    extractImageUrlsFromSession(session: any, maxCount?: number): any[];
    hasAnyImageElement(session: any): any;
    hasStickerContent(session: any): boolean;
    extractMessageImageUrls(session: any, maxCount?: number): any[];
    extractImageFingerprintKeys(session: any, maxCount?: number): any[];
    normalizeRepeatText(text: any): any;
    buildRepeatPayload(session: any): {
        signature: string;
        text: any;
        images: any[];
        imageKeys: any[];
        rawImageSegments: any;
        sendRefs: any[];
    };
    parseCqImageParams(chunk: any): {};
    extractImageRefsFromRawMessage(raw: any, maxCount?: number): any[];
    extractImageSegmentsFromRawMessage(raw: any, maxCount?: number): any[];
    extractImageSendRefs(session: any, maxCount?: number): any[];
    fetchMessageImagePayload(session: any, maxCount?: number): Promise<{
        segments: any[];
        refs: any[];
    }>;
    sendImageRef(session: any, ref: any): Promise<boolean>;
    handleRepeater(session: any): Promise<void>;
    logAuth(stage: any, result: any, session: any): void;
    logCommandResult(command: any, result: any, session: any, extra: any): void;
    authorizeCommand(command: any, session: any): Promise<{
        ok: boolean;
        message: string;
        userMessage: string;
    } | {
        ok: boolean;
        message: string;
        userMessage?: undefined;
    }>;
    authorize(session: any): Promise<{
        ok: boolean;
        message: string;
        userMessage: string;
    } | {
        ok: boolean;
        message: string;
        userMessage?: undefined;
    }>;
    canUseAdminCommand(session: any): Promise<{
        ok: boolean;
        message: string;
    }>;
    isBotOwnerInGroup(session: any): Promise<boolean>;
    resolveMemberRole(session: any): Promise<any>;
    normalizeRole(input: any): any;
    parseTargetId(input: any): any;
    randomMinutes(min?: number, max?: number): number;
    parseDurationToken(token: any): {
        raw: string;
        value: number;
        hasUnit: boolean;
        minutes: number;
    };
    looksLikeMemberInGroup(session: any, targetIdRaw: any): Promise<boolean>;
    isPrivilegedUser(session: any, role: any): boolean;
    recordUnauthorizedMuteAttempt(session: any): boolean;
    isRegularMember(session: any): Promise<boolean>;
    shouldSelfGag(session: any, target: any): Promise<boolean>;
    selfGag(session: any, reason: any): Promise<{
        ok: boolean;
        message: string;
        plan?: undefined;
    } | {
        ok: boolean;
        message: string;
        plan: {
            action: string;
            groupId: string;
            targetId: any;
            reason: string;
        };
    }>;
    punishUnauthorizedMuteAttempt(session: any, target: any): Promise<{
        ok: boolean;
        message: string;
        plan: {
            action: string;
            groupId: string;
            targetId: any;
            reason: string;
        };
    }>;
    toGroupId(session: any): number;
    getOneBotApi(session: any): any;
    /** 供 AI 引擎抽取图片结构 */
    extractImages(session: any): any[];
    /** 引用消息只带 messageId 时，用 OneBot get_msg 回查图片 */
    fetchQuotedImages(session: any, quote: any): Promise<any[]>;
    /** 供 AI 引擎把图片引用转成 data URL */
    resolveImage(ref: any, session: any): Promise<any>;
    /** AI 回复发送：按 aiQuoteReplyMode 决定是否引用触发消息，失败则退化为纯文本 */
    sendReply(session: any, text: any): Promise<void>;
    extractTextForFilter(session: any): any;
    hasTextContent(session: any): boolean;
    hasImageOrFace(session: any): any;
    hasCardMessage(session: any): any;
    hasForwardMessage(session: any): any;
    normalizeGuildId(guildId: any): any;
    resolveModerationPolicy(session: any): {
        bannedWords: any;
        strongKeywords: any;
        whitelistKeywords: any;
        whitelistOnlyOwners: boolean;
        blockCardMessage: any;
        blockForwardMessage: any;
        autoDeleteViolation: any;
        sendViolationNotice: any;
        enableAutoMute: any;
        autoMuteThreshold: any;
        autoMuteMinutes: any;
        enableAutoKick: any;
        autoKickThreshold: any;
        violationWindowMinutes: any;
    };
    normalizeBannedWordEntry(entry: any): {
        keyword: string;
        score: any;
    };
    normalizeBannedWordList(list: any): {
        keyword: string;
        score: any;
    }[];
    /**
     * 顺序子序列匹配：关键词的字符按顺序出现在文本中即命中，允许中间隔词。
     * 返回匹配跨度与紧凑度（跨度越接近词长，置信度越高）。
     */
    /**
     * 模糊命中的最低置信度门槛。
     * 短关键词（2~4 字）极易被无关文本凑齐（如「领导说…红色包装袋」凑出「领红包」），
     * 因此对短词要求更高的置信度；长词本身信息量足，门槛可放宽。
     */
    minBannedWordConfidence(keywordLength: any): 1 | 0.6 | 0.65 | 0.55 | 0.45;
    subsequenceMatch(text: any, keyword: any): {
        start: any;
        end: any;
        span: any;
        ratio: number;
        exact: boolean;
        overflow?: undefined;
        confidence?: undefined;
    } | {
        start: number;
        end: number;
        span: number;
        overflow: number;
        ratio: number;
        confidence: number;
        exact: boolean;
    };
    evaluateBannedWords(text: any, policy: any): {
        total: number;
        evaluations: {
            keyword: string;
            score: any;
            confidence: number;
            gained: number;
            span: any;
            exact: boolean;
        }[];
    };
    /**
     * 违禁词白名单豁免检查。
     *
     * 用于「校学生会招新」这类特殊场景：招新文案本身会包含“加群”“群号”等
     * 违禁词，但只要命中白名单关键词（如“宣传部”“纪检部”），就整条跳过违禁词评分。
     *
     * 返回 { keyword, reason } 表示命中并豁免；返回 null 表示未命中。
     */
    checkWhitelistBypass(session: any, policy: any, text: any): Promise<{
        keyword: any;
        reason: string;
    }>;
    detectViolation(session: any, policy: any, type?: string): Promise<{
        type: string;
        detail: string;
        assessment?: undefined;
        strong?: undefined;
    } | {
        type: string;
        detail: string;
        assessment: {
            total: number;
            evaluations: {
                keyword: string;
                score: any;
                confidence: number;
                gained: number;
                span: any;
                exact: boolean;
            }[];
        };
        strong: boolean;
    } | {
        type: string;
        detail: string;
        assessment: {
            total: number;
            evaluations: {
                keyword: string;
                score: any;
                confidence: number;
                gained: number;
                span: any;
                exact: boolean;
            }[];
        };
        strong?: undefined;
    }>;
    deleteMessage(session: any): Promise<boolean>;
    shouldExemptViolationPunish(session: any): Promise<boolean>;
    recordViolation(session: any, policy: any): number;
    clearViolationRecord(session: any): void;
    autoModerationPunish(session: any, policy: any): Promise<{
        ok: boolean;
        action: string;
        count: number;
        message: string;
        minutes?: undefined;
    } | {
        ok: boolean;
        action: string;
        count: number;
        minutes: number;
        message: string;
    }>;
    /**
     * 自定义命令处理器：整条消息与触发词完全一致（忽略首尾空白）即回复预设内容。
     * 触发词约定用方括号包裹（如 [签到]）。命中后返回 true，调用方据此跳过后续
     * 违禁词管控与 AI 回复（自定义命令完全不走 AI）。
     */
    handleCustomCommand(session: any): Promise<boolean>;
    _customCmdAt: Map<any, any>;
    _customCmdIdx: Map<any, any>;
    /**
     * 读取指令前缀配置（带默认值）。
     */
    cmdPrefix(key: any, def: any): any;
    /**
     * 统一指令路由器：所有指令均为「方括号直连」语法，如 [mute] 12345 10 广告。
     * 命中并处理返回 true（不再走后续管控与 AI）。
     */
    routeBracketCommand(session: any): Promise<boolean>;
    /**
     * 指令菜单：行首用中文介绍功能名称，指令本身保持英文（[记忆] 新规）。
     * 记忆查询紧跟在记忆保存之后；冒号后留一个空行，避免标题与条目挤在一起。
     */
    sendCommandMenu(session: any): Promise<void>;
    /** 自定义指令集：列出当前生效的自定义命令；没有配置时明确提示暂无指令 */
    sendCustomCommandList(session: any): Promise<void>;
    /**
     * [Version]：查看插件信息（当前版本、作者、仓库与 npm 地址）。
     * 版本号与仓库地址从 package.json 读取，避免发版时忘记同步。
     */
    sendVersionInfo(session: any): Promise<void>;
    /** 权限不足提示 */
    denyAdmin(session: any, message: any): Promise<boolean>;
    /**
     * 群管指令的统一鉴权（两步）：
     *   ① authorizeCommand —— 判定「谁在操作」：账号白名单 / 群主 / 群管理员；
     *   ② canUseAdminCommand —— 确认「bot 在该群是否具备管理能力」。
     *
     * 此前方括号指令只做了第②步，导致 allowedUserIds / allowGroupOwner /
     * allowGroupAdmin 对 mute/unmute/kick/ban/unban 完全失效：配置里允许群主操作，
     * 但只要 bot 不是群主就会被拒；反过来当 bot 是群主时，任何群成员都能踢人。
     */
    authorizeModerationAction(command: any, session: any): Promise<{
        ok: boolean;
        message: any;
    }>;
    /** [mute] qq号|@某人 时长 [原因] */
    execMute(session: any, rest: any, mentions?: any[]): Promise<boolean>;
    /** [unmute] qq号|@某人 [原因] */
    execUnmute(session: any, rest: any, mentions?: any[]): Promise<boolean>;
    /** [kick] qq号|@某人 [原因] */
    execKick(session: any, rest: any, mentions?: any[]): Promise<boolean>;
    /** [memory] content / [memory] list / [memory] search keyword / [memory] delete keyword */
    execMemory(session: any, rest: any): Promise<boolean>;
    /** [ban] qq号|@某人 [原因]（兼容旧的 [ban] add qq号） */
    execBanAdd(session: any, rest: any, mentions?: any[]): Promise<boolean>;
    /** [unban] qq号|@某人 [原因] */
    execUnban(session: any, rest: any, mentions?: any[]): Promise<boolean>;
    /** [banlist] */
    execBanList(session: any): Promise<void>;
    /**
     * 黑名单指令（旧式 [ban] list / add / delete 兼容入口）。
     */
    handleBanCommand(session: any): Promise<boolean>;
    handleGroupModeration(session: any): Promise<void>;
    /**
     * 待审入群申请的落盘文件路径。
     * 与 Memory.md 同目录（ctx.baseDir），可用 Koishi 控制台「探索器 Explorer」直接查看。
     */
    getPendingJoinFilePath(): any;
    buildPendingJoinFileContent(): string;
    /** 立即把待审单写入 MD（供 dispose / 去抖到期调用） */
    persistPendingJoinRequestsNow(): Promise<void>;
    /** 去抖落盘：入群申请是低频事件，合并多次写入避免频繁 I/O */
    schedulePendingJoinPersist(delayMs?: number): void;
    /** 卸载/重启前的同步兜底：写失败只记日志，不阻塞退出 */
    flushPendingJoinRequests(): void;
    /**
     * 启动时从 MD 恢复待审单，并顺手清掉已过期的编号。
     * 这样重启不再丢审核单；超过 TTL 的自然失效。
     */
    loadPendingJoinRequests(): void;
    cleanupPendingJoinRequests(): void;
    generateJoinRequestCode(): string;
    parseJoinRequestReviewText(text: any): {
        approve: boolean;
        code: string;
        reason: string;
    };
    handleJoinRequestReviewMessage(session: any): Promise<boolean>;
    resolveJoinReviewEnabled(session: any): any;
    fetchStrangerInfo(bot: any, userId: any): Promise<any>;
    buildJoinRequestPrompt(applicant: any, extra: any): string;
    handleGuildMemberRequest(session: any): Promise<void>;
    reviewJoinRequestDecision(session: any, code: any, approve: any, reason: any): Promise<{
        ok: boolean;
        message: string;
        plan: any;
    } | {
        ok: boolean;
        message: string;
    }>;
    formatTargetDisplay(session: any, targetId: any, rawTarget: any): Promise<any>;
    getTargetRole(session: any, targetId: any): Promise<any>;
    createDryRunResult(plan: any): {
        ok: boolean;
        message: string;
        plan: any;
    };
    planDemoAction(groupId: any, reason: any): Promise<{
        ok: boolean;
        message: string;
        plan: {
            action: string;
            groupId: any;
            reason: any;
        };
    }>;
    kick(session: any, target: any, rejectAddRequest: boolean, reason: any): Promise<{
        ok: boolean;
        message: string;
        plan: any;
    } | {
        ok: boolean;
        message: string;
    }>;
    mute(session: any, target: any, minutes: any, reason: any): Promise<{
        ok: boolean;
        message: string;
        plan: any;
    } | {
        ok: boolean;
        message: string;
    }>;
    unmute(session: any, target: any, reason: any): Promise<{
        ok: boolean;
        message: string;
        plan: any;
    } | {
        ok: boolean;
        message: string;
    }>;
    setAdmin(session: any, target: any, enable: any, reason: any): Promise<{
        ok: boolean;
        message: string;
        plan: any;
    } | {
        ok: boolean;
        message: string;
    }>;
}
/** 解析“提醒/定时”文本；返回 { at, content } 或 null。纯函数，便于测试。 */
export function parseReminderText(rawText: any, now?: number): {
    at: number;
    content: string;
};
import koishi_1 = require("koishi");
import { AiEngine } from "./ai/engine";
