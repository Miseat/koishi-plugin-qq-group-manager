"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.inject = exports.name = void 0;
exports.apply = apply;
const koishi_1 = require("koishi");
const service_1 = require("./service");
const commands_1 = require("./commands");
exports.name = 'nestim-qq-group-manager';
exports.inject = {
    optional: ['puppeteer'],
};
exports.Config = koishi_1.Schema.intersect([
    koishi_1.Schema.object({
        command: koishi_1.Schema.string().default('[bot]').description('菜单指令：单独发送该前缀即返回命令菜单（菜单内容仅英文与数字）。'),
        cmdMute: koishi_1.Schema.string().default('[mute]').description('禁言指令前缀，用法：[mute] qq|@某人 duration [reason]。时长必填，原因选填。'),
        cmdUnmute: koishi_1.Schema.string().default('[unmute]').description('解除禁言指令前缀，用法：[unmute] qq|@某人 [reason]。'),
        cmdKick: koishi_1.Schema.string().default('[kick]').description('踢人指令前缀，用法：[kick] qq|@某人 [reason]。'),
        cmdMemory: koishi_1.Schema.string().default('[memory]').description('记忆指令前缀，用法：[memory] content 保存 / [memory] list 列出 / [memory] search keyword 查询 / [memory] delete keyword 删除。'),
        cmdBan: koishi_1.Schema.string().default('[ban]').description('拉黑指令前缀，用法：[ban] qq|@某人 [reason]。'),
        cmdUnban: koishi_1.Schema.string().default('[unban]').description('解除拉黑指令前缀，用法：[unban] qq|@某人 [reason]。'),
        cmdBanList: koishi_1.Schema.string().default('[banlist]').description('黑名单查询指令前缀，单独发送即列出本群黑名单。'),
        cmdCustom: koishi_1.Schema.string().default('[custom]').description('自定义指令集前缀，用法：[custom]。未配置自定义指令时提示「目前还没有指令」。'),
        cmdVersion: koishi_1.Schema.string().default('[Version]').description('插件信息指令前缀，用法：[Version]。返回当前版本、作者、GitHub 与 npm 地址。'),
        platformFilter: koishi_1.Schema.array(String).default(['onebot']).description('允许启用管理功能的平台列表。'),
        responseStyle: koishi_1.Schema.union([
            koishi_1.Schema.const('plain').description('普通输出'),
            koishi_1.Schema.const('meow').description('Meow 风格输出'),
        ]).role('radio').default('plain').description('群聊中指令返回的文本风格。'),
        dryRun: koishi_1.Schema.boolean().default(false).description('演练模式：仅输出计划动作，不执行群管理操作。'),
    }).description('基础设置'),
    koishi_1.Schema.object({
        bannedWords: koishi_1.Schema.array(String).role('table').default([]).description('违禁词列表。支持顺序模糊匹配（如“领红包”可命中“领xxx元红包”）。可用“关键词|分值”自定义权重，分值越高越容易单独触发。'),
        bannedWordScoreThreshold: koishi_1.Schema.natural().min(1).max(100).default(70).description('违禁词评分触发阈值：整条消息累计得分达到该值才触发管控（默认 70）。'),
        strongKeywords: koishi_1.Schema.array(String).role('table').default([]).description('强关键词列表：命中即可触发管控，且【无视白名单豁免】。用于「有没有美女」这类与招新无关的骚扰/找对象话术——即使消息里带了「宣传部」等白名单词也照样命中，堵住「附一个白名单词即可绕过管控」的漏洞。支持“关键词|分值”语法，与违禁词共用同一评分阈值。'),
        blockCardMessage: koishi_1.Schema.boolean().default(true).description('是否禁止卡片消息（json/xml）。'),
        blockForwardMessage: koishi_1.Schema.boolean().default(true).description('是否禁止合并转发消息（forward）。'),
        autoDeleteViolation: koishi_1.Schema.boolean().default(true).description('违规消息是否自动撤回。'),
        sendViolationNotice: koishi_1.Schema.boolean().default(true).description('处理违规消息后是否在群内发送提示。'),
        groupRules: koishi_1.Schema.array(koishi_1.Schema.object({
            guildId: koishi_1.Schema.string().required().description('群号。'),
            enableAiReply: koishi_1.Schema.boolean().description('该群是否启用 AI 回复（留空则跟随全局设置）。'),
            bannedWords: koishi_1.Schema.array(String).role('table').default([]).description('该群专属违禁词列表（同样支持“关键词|分值”与顺序模糊匹配）。'),
            whitelistKeywords: koishi_1.Schema.array(String).role('table').default([]).description('该群违禁词白名单：消息只要命中其中任意一个关键词，就整条跳过违禁词评分（用于校学生会招新等允许的宣传场景）。'),
            strongKeywords: koishi_1.Schema.array(String).role('table').description('该群强关键词（留空则跟随全局设置）。命中后无视白名单豁免，用于堵住「附一个白名单词即可绕过管控」的漏洞。'),
            whitelistOnlyOwners: koishi_1.Schema.boolean().default(false).description('白名单是否仅对群主/管理员生效。关闭时所有群成员命中白名单均可豁免。'),
            blockCardMessage: koishi_1.Schema.boolean().default(true).description('该群是否禁止卡片消息（json/xml）。'),
            blockForwardMessage: koishi_1.Schema.boolean().default(true).description('该群是否禁止合并转发消息（forward）。'),
            autoDeleteViolation: koishi_1.Schema.boolean().default(true).description('该群违规消息是否自动撤回。'),
            sendViolationNotice: koishi_1.Schema.boolean().default(true).description('该群违规后是否发送群内提示。'),
            autoMuteEnabled: koishi_1.Schema.boolean().description('该群是否启用自动禁言（留空则跟随全局设置）。'),
            autoMuteThreshold: koishi_1.Schema.natural().description('该群触发自动禁言的违规次数（留空则跟随全局设置）。'),
            autoMuteMinutes: koishi_1.Schema.natural().description('该群自动禁言的时长（分钟，留空则跟随全局设置）。'),
            autoKickEnabled: koishi_1.Schema.boolean().description('该群是否启用自动踢人（留空则跟随全局设置）。'),
            autoKickThreshold: koishi_1.Schema.natural().description('该群触发自动踢人的违规次数（留空则跟随全局设置）。'),
            autoViolationWindowMinutes: koishi_1.Schema.natural().description('该群违规计数统计窗口（分钟，留空则跟随全局设置）。'),
            enableJoinRequestReview: koishi_1.Schema.boolean().description('该群是否启用入群审核（留空则跟随全局设置）。'),
            blacklistEnabled: koishi_1.Schema.boolean().description('该群是否启用黑名单（留空则跟随全局 enableBlacklist；即使全局关闭，此处设为 true 也能单独启用）。'),
        })).role('table').default([]).description('按群覆盖消息管控策略（未命中群号时使用全局默认）。'),
    }).description('消息管控'),
    koishi_1.Schema.object({
        enableAutoMute: koishi_1.Schema.boolean().default(false).description('启用自动禁言：成员在统计窗口内累计违规达到阈值后自动禁言。'),
        autoMuteViolationThreshold: koishi_1.Schema.natural().default(3).description('触发自动禁言所需的累计违规次数。'),
        autoMuteMinutes: koishi_1.Schema.natural().default(10).description('自动禁言的时长（分钟）。'),
        enableAutoKick: koishi_1.Schema.boolean().default(false).description('启用自动踢人：成员在统计窗口内累计违规达到阈值后自动移出群聊。'),
        autoKickViolationThreshold: koishi_1.Schema.natural().default(5).description('触发自动踢人所需的累计违规次数。'),
        autoViolationWindowMinutes: koishi_1.Schema.natural().default(60).description('违规计数统计窗口（分钟）：窗口内连续违规才累计，超时未违规则重新计数。'),
    }).description('自动管控'),
    koishi_1.Schema.object({
        enableMemory: koishi_1.Schema.boolean().default(true).description('启用记忆库：群内发送 [memory] 内容 保存到 Memory.md，[memory] search 关键词 查询、[memory] delete 关键词 删除，AI 回复可引用。'),
        memoryFileName: koishi_1.Schema.string().default('Memory.md').description('记忆库文件名（保存在 Koishi 数据目录）。请直接使用控制台左侧「探索器 Explorer」打开该文件查看/编辑记忆库内容。'),
        memoryInAi: koishi_1.Schema.boolean().default(true).description('AI 回复/识图时是否参考记忆库内容。'),
    }).description('记忆库'),
    koishi_1.Schema.object({
        enableBlacklist: koishi_1.Schema.boolean().default(true).description('全局黑名单系统开关。单个群未单独设置时跟随此值；单个群设置后以该群为准（全局关着也能为某群单独开启）。'),
        blacklistFileName: koishi_1.Schema.string().default('banMember.md').description('黑名单文件名（保存在 Koishi 数据目录，可用控制台左侧「探索器 Explorer」查看/编辑）。'),
        banCommand: koishi_1.Schema.string().default('[ban]').description('（兼容字段）黑名单指令前缀，等同 cmdBan。'),
        banKickOnJoin: koishi_1.Schema.boolean().default(true).description('有人入群时是否自动比对黑名单，命中则立即踢出并提示。'),
        banRecordOnKick: koishi_1.Schema.boolean().default(true).description('有人被移出群聊时是否自动把被踢者加入黑名单。只处理明确判定为「被踢」的事件（subtype=passive/kick），主动退群（leave/quit）与 subtype 缺失一律不记录；bot 自己永不记入。设为 false 则关闭该自动拉黑，只保留手动 [ban]。'),
    }).description('黑名单'),
    koishi_1.Schema.object({
        enableSelfGag: koishi_1.Schema.boolean().default(true).description('启用口球娱乐：普通成员对自己使用 mute/gag 时随机 1~60 分钟禁言。'),
        enableUnauthorizedMutePunish: koishi_1.Schema.boolean().default(true).description('启用违规惩罚：普通成员反复尝试禁言他人时禁言本人。'),
        unauthorizedMuteAttemptThreshold: koishi_1.Schema.natural().default(2).description('触发惩罚所需的违规禁言次数。'),
        unauthorizedMuteWindowMinutes: koishi_1.Schema.natural().default(10).description('违规计数统计窗口（分钟）。'),
        unauthorizedMutePunishMinMinutes: koishi_1.Schema.natural().default(1).description('惩罚禁言最小分钟数。'),
        unauthorizedMutePunishMaxMinutes: koishi_1.Schema.natural().default(10).description('惩罚禁言最大分钟数。'),
    }).description('娱乐设置'),
    koishi_1.Schema.object({
        enableRepeater: koishi_1.Schema.boolean().default(false).description('启用群聊复读：连续相同消息达到阈值时 bot 复读一次。'),
        repeaterThreshold: koishi_1.Schema.natural().default(3).description('触发复读所需连续相同消息次数。'),
        repeaterCooldownSeconds: koishi_1.Schema.natural().default(90).description('同一内容再次允许复读的冷却时间（秒）。'),
        repeaterEnableGetMsgRefetch: koishi_1.Schema.boolean().default(true).description('复读图片缺少可发送引用时，是否通过 get_msg 回查原消息提取图片引用。'),
        enableJoinRequestReview: koishi_1.Schema.boolean().default(true).description('收到新的入群申请时，自动在群内发起管理员审核。'),
        joinRequestReviewTtlMinutes: koishi_1.Schema.natural().default(30).description('入群申请审核编号的有效期（分钟）。'),
        pendingJoinFileName: koishi_1.Schema.string().default('JoinRequests.md').description('待审入群申请的落盘文件名（保存在 Koishi 数据目录）。插件会把待审单写入该文件，重启后自动恢复，超过有效期或已处理的会被清理。'),
    }).description('群聊互动'),
    koishi_1.Schema.object({
        customCommands: koishi_1.Schema.array(koishi_1.Schema.object({
            trigger: koishi_1.Schema.string().required().description('触发词，需用方括号包裹，如 [hello]。只有整条消息与之完全相同（忽略首尾空白）才会触发。无任何自定义指令时，[custom] 会提示「目前还没有指令」。'),
            replies: koishi_1.Schema.array(String).role('table').default([]).description('回复内容，可配置多条。每条支持 {user} 发送者昵称、{at} @发送者、{group} 群号。'),
            enabled: koishi_1.Schema.boolean().default(true).description('是否启用该命令。'),
            groups: koishi_1.Schema.array(String).role('table').default([]).description('限定生效的群号；留空表示所有群生效。'),
            randomReply: koishi_1.Schema.boolean().default(false).description('配置多条回复时：开启则随机选一条，关闭则按顺序轮换。'),
            quote: koishi_1.Schema.boolean().default(false).description('回复时是否引用触发的那条消息。'),
            cooldownSeconds: koishi_1.Schema.natural().default(0).description('同一群内该命令的冷却时间（秒，0 表示不限制）。'),
            logHit: koishi_1.Schema.boolean().default(true).description('命中时是否写入日志。'),
        })).role('table').default([]).description('自定义命令：检测到指定命令后输出预设消息（触发后不再走 AI 回复）。'),
    }).description('自定义命令'),
    koishi_1.Schema.object({
        enableAiReply: koishi_1.Schema.boolean().default(false).description('全局 AI 回复开关（当 aiReplyRequireGroupRule 关闭时，未单独配置的群会回落到此值）。'),
        aiReplyRequireGroupRule: koishi_1.Schema.boolean().default(true).description('AI 回复是否要求该群已单独配置：开启后，未出现在 groupRules 里的群一律不启用 AI 回复（推荐）。'),
        aiProvider: koishi_1.Schema.union([
            koishi_1.Schema.const('openai-compatible').description('OpenAI 兼容接口（OpenAI/火山引擎/Codex API/Auth 等）'),
            koishi_1.Schema.const('gemini').description('Gemini 原生接口（Google Generative Language API）'),
        ]).role('radio').default('openai-compatible').description('AI 服务提供方式。'),
        aiApiKey: koishi_1.Schema.string().role('secret').default('').description('AI 接口密钥（API Key）。'),
        aiBaseUrl: koishi_1.Schema.string().default('https://api.openai.com/v1').description('接口基础地址（OpenAI 兼容模式需以 /v1 结尾；Gemini 模式可留默认）。'),
        aiModel: koishi_1.Schema.string().default('gpt-4o-mini').description('模型名称，如 gpt-4o-mini / doubao-1.5-lite / gemini-2.0-flash。'),
        aiAgentName: koishi_1.Schema.string().default('MeowBot').description('默认智能体自称。'),
        aiSystemPrompt: koishi_1.Schema.string().role('textarea').default('你是群聊中的友好机器人，请简洁、自然、符合中文互联网语境地回复。').description('默认系统提示词。'),
        aiActivePersona: koishi_1.Schema.string().default('').description('启用的人格 ID（为空时使用默认自称与默认提示词）。'),
        aiPersonas: koishi_1.Schema.array(koishi_1.Schema.object({
            id: koishi_1.Schema.string().required().description('人格 ID（唯一）。'),
            selfName: koishi_1.Schema.string().default('').description('该人格的自称（留空则使用默认自称）。'),
            prompt: koishi_1.Schema.string().role('textarea').default('').description('该人格系统提示词（留空则使用默认提示词）。'),
        })).role('table').default([]).description('可保存多个人格配置，按 aiActivePersona 切换。'),
        aiReplyMode: koishi_1.Schema.union([
            koishi_1.Schema.const('threshold').description('只看消息数：累计达到阈值才触发（不看概率）'),
            koishi_1.Schema.const('random').description('只看概率：每条消息掷一次骰（不看消息数）'),
            koishi_1.Schema.const('hybrid').description('两者都要满足：先累计到阈值，再按概率掷中'),
        ]).role('radio').default('hybrid').description('AI 触发策略。三道闸门依序为：①消息阈值 ②随机概率 ③兴趣评分，任一不过都不回复；@点名与点名后跟随可越过全部三道。'),
        aiMessageThreshold: koishi_1.Schema.natural().default(16).description('阈值触发所需累计消息数。threshold / hybrid 模式下未达此数一律不触发；计数器在成功回复后清零，需重新累计。'),
        aiRandomReplyProbability: koishi_1.Schema.percent().default(0.08).description('随机触发概率（每条消息掷一次骰）。random / hybrid 模式下未掷中直接跳过，不会调用 AI 接口。填 0 等同于关闭随机触发。'),
        aiMinReplyIntervalSeconds: koishi_1.Schema.natural().default(45).description('同一群两次 AI 回复的最短间隔（秒）。'),
        aiContextWindow: koishi_1.Schema.natural().default(24).description('参与推理的最近消息条数。'),
        aiTemperature: koishi_1.Schema.number().min(0).max(2).step(0.1).default(0.8).description('生成温度（0~2）。'),
        aiMaxOutputTokens: koishi_1.Schema.natural().default(240).description('AI 最大输出 token 数。'),
        aiEnableImageRecognition: koishi_1.Schema.boolean().default(true).description('是否启用图片识别（支持时将图片一并发送给模型）。'),
        aiImageMaxCount: koishi_1.Schema.natural().default(2).description('每次最多发送给模型的图片数量。'),
        aiIgnoreCommandMessage: koishi_1.Schema.boolean().default(true).description('忽略看起来像命令的消息，避免干扰正常指令执行。'),
        aiEnableDirectMentionTrigger: koishi_1.Schema.boolean().default(true).description('消息命中智能体名字时是否忽略阈值直接触发回复。'),
        aiEnableFollowupAfterMention: koishi_1.Schema.boolean().default(true).description('点名触发后，是否跟随该用户一段时间继续对话。'),
        aiFollowupWindowSeconds: koishi_1.Schema.natural().default(120).description('点名后跟随该用户的持续时间（秒）。'),
        aiFollowupMaxTurns: koishi_1.Schema.natural().default(3).description('一次点名会话最多继续回复轮数。'),
        aiOwnerPlatform: koishi_1.Schema.string().default('onebot').description('主人平台标识（用于识别主人用户，如 onebot）。'),
        aiOwnerUserId: koishi_1.Schema.string().default('').description('主人平台用户 ID（如 QQ 号，用于记忆主人身份）。'),
        aiHomePlatform: koishi_1.Schema.string().default('onebot').description('兼容字段：主页平台标识（建议改用 aiOwnerPlatform）。'),
        aiHomeUserId: koishi_1.Schema.string().default('').description('兼容字段：主页平台用户 ID（建议改用 aiOwnerUserId）。'),
        aiInterestMinScore: koishi_1.Schema.number().min(0).max(100).step(1).default(82).description('AI 兴趣触发最低分（最后一道闸门）：非点名场景下，无论由阈值还是概率触发，都要再过一次兴趣评分，达到此分才真正回复。分值越高越不容易回复。'),
        aiInterestContextWindow: koishi_1.Schema.number().min(4).max(16).step(1).default(8).description('非阈值兴趣判定使用的上下文窗口条数。'),
        aiInterestModel: koishi_1.Schema.string().default('').description('兴趣判定专用模型（留空则沿用 aiModel）。兴趣判定只是二分类任务，指向非推理的轻量模型（如 deepseek-chat）可显著降低耗时与成本；若沿用推理模型，请确保 aiInterestMaxTokens 足够大。'),
        aiInterestMaxTokens: koishi_1.Schema.natural().min(256).max(16384).default(2048).description('兴趣判定的最大输出 token（默认 2048）。带思考的推理模型会先消耗 reasoning token，额度太小会导致正文为空、finish_reason=length，判定静默失效——表现为「该回的消息也不回」。'),
    }).description('AI 回复'),
    koishi_1.Schema.object({
        allowedUserIds: koishi_1.Schema.array(String).role('table').default([]).description('允许直接使用群管理命令的账号 ID 白名单。命中即通过，不再校验群内角色。'),
        allowGroupOwner: koishi_1.Schema.boolean().default(true).description('是否允许群主使用管理命令。'),
        allowGroupAdmin: koishi_1.Schema.boolean().default(true).description('是否允许群管理员使用管理命令。'),
        requireBotOwnerForAdmin: koishi_1.Schema.boolean().default(true).description('是否要求 bot 在当前群具备群主或管理员身份才放行群管指令（默认开启）。这是「执行能力」校验，与操作者身份无关；关闭后跳过该步。'),
        allowAdminBypassWhitelistMute: koishi_1.Schema.boolean().default(true).description('白名单目标禁言保护开关：开启后允许群主/管理员对其执行禁言。'),
    }).description('权限设置'),
    koishi_1.Schema.object({
        logCommandResult: koishi_1.Schema.boolean().default(true).description('记录所有群管指令的执行结果到日志。'),
        logAuthCheck: koishi_1.Schema.boolean().default(true).description('记录白名单/群主/管理员鉴权过程到日志。'),
    }).description('日志设置'),
]);
function apply(ctx, config) {
    const service = new service_1.QQGroupManagerService(ctx, config);
    const dispose = ctx.permissions.define('qqgm-admin', {
        check: async (_data, session) => {
            const result = await service.canUseAdminCommand(session);
            return result.ok;
        },
    });
    ctx.on('dispose', () => {
        dispose();
    });
    // 卸载/重启时先把待审入群申请刷盘，避免内存单丢失
    ctx.on('dispose', () => {
        service.flushPendingJoinRequests();
    });
    (0, commands_1.registerCommands)(ctx, service, config);
}
