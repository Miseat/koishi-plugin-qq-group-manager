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
        command: koishi_1.Schema.string().default('群管').description('管理命令前缀。'),
        menuCommand: koishi_1.Schema.string().default('菜单').description('图片菜单指令名。'),
        replaceHelpAsImageMenu: koishi_1.Schema.boolean().default(false).description('是否接管 help 指令并输出图片菜单。'),
        replaceStatusAsImage: koishi_1.Schema.boolean().default(true).description('是否接管 status 指令并输出 Meow 状态图片。'),
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
        blockCardMessage: koishi_1.Schema.boolean().default(true).description('是否禁止卡片消息（json/xml）。'),
        blockForwardMessage: koishi_1.Schema.boolean().default(true).description('是否禁止合并转发消息（forward）。'),
        autoDeleteViolation: koishi_1.Schema.boolean().default(true).description('违规消息是否自动撤回。'),
        sendViolationNotice: koishi_1.Schema.boolean().default(true).description('处理违规消息后是否在群内发送提示。'),
        groupRules: koishi_1.Schema.array(koishi_1.Schema.object({
            guildId: koishi_1.Schema.string().required().description('群号。'),
            enableAiReply: koishi_1.Schema.boolean().description('该群是否启用 AI 回复（留空则跟随全局设置）。'),
            bannedWords: koishi_1.Schema.array(String).role('table').default([]).description('该群专属违禁词列表（同样支持“关键词|分值”与顺序模糊匹配）。'),
            whitelistKeywords: koishi_1.Schema.array(String).role('table').default([]).description('该群违禁词白名单：消息只要命中其中任意一个关键词，就整条跳过违禁词评分（用于校学生会招新等允许的宣传场景）。'),
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
        enableMemory: koishi_1.Schema.boolean().default(true).description('启用记忆库：群内发送 [记忆]+内容 保存到 Memory.md，[记忆查询]/[记忆删除] 管理，AI 回复可引用。'),
        memoryFileName: koishi_1.Schema.string().default('Memory.md').description('记忆库文件名（保存在 Koishi 数据目录）。请直接使用控制台左侧「探索器 Explorer」打开该文件查看/编辑记忆库内容。'),
        memoryInAi: koishi_1.Schema.boolean().default(true).description('AI 回复/识图时是否参考记忆库内容。'),
    }).description('记忆库'),
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
    }).description('群聊互动'),
    koishi_1.Schema.object({
        customCommands: koishi_1.Schema.array(koishi_1.Schema.object({
            trigger: koishi_1.Schema.string().required().description('触发词，需用方括号包裹，如 [签到]。只有整条消息与之完全相同（忽略首尾空白）才会触发。'),
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
            koishi_1.Schema.const('threshold').description('达到消息阈值后回复'),
            koishi_1.Schema.const('random').description('按概率随机回复'),
            koishi_1.Schema.const('hybrid').description('阈值与随机同时生效'),
        ]).role('radio').default('hybrid').description('AI 触发策略。'),
        aiMessageThreshold: koishi_1.Schema.natural().default(16).description('阈值触发所需累计消息数。'),
        aiRandomReplyProbability: koishi_1.Schema.percent().default(0.08).description('随机触发概率（每条消息判定一次）。'),
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
        aiInterestMinScore: koishi_1.Schema.number().min(0).max(100).step(1).default(82).description('AI 兴趣触发最低分（非点名场景，分值越高越不容易回复）。'),
        aiInterestContextWindow: koishi_1.Schema.number().min(4).max(16).step(1).default(8).description('非阈值兴趣判定使用的上下文窗口条数。'),
    }).description('AI 回复'),
    koishi_1.Schema.object({
        allowedUserIds: koishi_1.Schema.array(String).role('table').default([]).description('允许直接使用群管理命令的账号 ID 白名单。'),
        allowGroupOwner: koishi_1.Schema.boolean().default(true).description('是否允许群主使用管理命令。'),
        allowGroupAdmin: koishi_1.Schema.boolean().default(true).description('是否允许群管理员使用管理命令。'),
        requireBotOwnerForAdmin: koishi_1.Schema.boolean().default(true).description('仅当 bot 在当前群是群主时开放 admin 子命令。'),
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
    (0, commands_1.registerCommands)(ctx, service, config);
    if (config.replaceHelpAsImageMenu) {
        let help;
        try {
            help = ctx.$commander.get('help');
        }
        catch {
            help = null;
        }
        if (help) {
            help.action(async (argv) => {
                const keyword = typeof argv.args?.[0] === 'string' ? argv.args[0] : '';
                if (!keyword)
                    service.armMenuPairing(argv.session, 30_000);
                return service.renderMenu(keyword, argv.session);
            }, true);
        }
        else {
            ctx.command('help [keyword:text]', '查看图片菜单（由 qq-group-manager 提供）')
                .action(async (argv, keyword) => {
                if (!keyword)
                    service.armMenuPairing(argv.session, 30_000);
                return service.renderMenu(keyword, argv.session);
            });
        }
    }
    if (config.replaceStatusAsImage) {
        let status;
        try {
            status = ctx.$commander.get('status');
        }
        catch {
            status = null;
        }
        if (status) {
            status.action(async (argv) => {
                return service.renderStatusCard(argv.session);
            }, true);
        }
        else {
            ctx.command('status', '查看系统状态（由 qq-group-manager 提供）')
                .action(async (argv) => {
                return service.renderStatusCard(argv.session);
            });
        }
    }
}
