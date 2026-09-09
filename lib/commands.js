"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;
function styleText(text, config) {
    if (config.responseStyle !== 'meow')
        return text;
    return `喵~ ${text}`;
}
function formatAction(result, config, displayTarget) {
    let text = result.message;
    if (displayTarget && result.plan?.targetId) {
        text = text.split(result.plan.targetId).join(displayTarget);
    }
    return styleText(text, config);
}
function registerCommands(ctx, service, config) {
    ctx.command(`${config.menuCommand} [keyword:text]`, '查看 Meow 图片菜单')
        .action(async ({ session }, keyword) => {
        if (!keyword)
            service.armMenuPairing(session, 30_000);
        const result = await service.renderMenu(keyword, session);
        service.logCommandResult('menu', { ok: true, message: 'menu rendered' }, session, { keyword });
        return result;
    });
    ctx.command(`${config.command}菜单`, `查看 ${config.command} 分类菜单`)
        .action(async ({ session }) => {
        const result = await service.renderMenu(`${config.command}菜单`, session);
        service.logCommandResult('menu-parent-shortcut', { ok: true, message: 'parent menu shortcut rendered' }, session, { parent: config.command });
        return result;
    });
    const root = ctx.command(config.command, 'QQ群管理命令入口');
    root
        .subcommand('查图', '识图调试：查看本条消息中被识别的图片信息')
        .action(async ({ session }) => {
        const auth = await service.authorizeCommand('img-debug', session);
        if (!auth.ok)
            return auth.userMessage ?? '权限不足或上下文不符合要求。';
        const info = service.describeImageMessage(session);
        const lines = [];
        lines.push(`图片元素数量: ${info.elementImages.length}`);
        lines.push(`CQ图片段: ${info.rawCq.length} 个`);
        lines.push(`可发送链接: ${info.extractableUrls.length} 个`);
        if (info.extractableUrls.length) {
            info.extractableUrls.forEach((u, i) => lines.push(`  ${i + 1}. ${u}`));
        }
        else if (info.rawCq.length) {
            lines.push('CQ图片原始片段:');
            info.rawCq.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
        }
        else if (info.elementImages.length) {
            lines.push('图片元素原始字段:');
            info.elementImages.forEach((im, i) => lines.push(`  ${i + 1}. ${JSON.stringify(im)}`));
        }
        else {
            lines.push('本条消息未检测到图片。请在群内发送一张图片（可同时附加该指令）后重试。');
        }
        return styleText('识图诊断：\n' + lines.join('\n'), config);
    });
    root
        .subcommand('kick <target:string>', '踢出群成员')
        .option('reject', '-r 拒绝再次加群请求')
        .option('reason', '-m <reason:string> 操作原因')
        .action(async ({ session, options }, target) => {
        if (!target)
            return '请提供目标 QQ 号或 @目标。';
        const auth = await service.authorizeCommand('kick', session);
        if (!auth.ok)
            return auth.userMessage ?? '权限不足或上下文不符合要求。';
        const result = await service.kick(session, target, options.reject, options.reason);
        service.logCommandResult('kick', result, session, { target, reject: options.reject });
        const displayTarget = await service.formatTargetDisplay(session, result.plan?.targetId, target);
        return formatAction(result, config, displayTarget);
    });
    root
        .subcommand('mute [target:string] [duration:string]', '禁言群成员（@用户或QQ号 + 时长，如 10分钟/1小时/1天）')
        .option('reason', '-r <reason:string> 操作原因')
        .action(async ({ session, options }) => {
        // 参数由 service 从原始消息中智能解析，避免把禁言时长误判为目标 QQ 号
        const parsed = await service.parseMuteArguments(session);
        if (!parsed.ok) {
            service.logCommandResult('mute', { ok: false, message: parsed.message }, session, { target: parsed.targetId });
            return styleText(parsed.message, config);
        }
        const targetId = parsed.targetId;
        const minutes = parsed.minutes;
        if (await service.shouldSelfGag(session, targetId)) {
            const result = await service.selfGag(session, 'mute-self-trigger');
            service.logCommandResult('self-gag', result, session, { source: 'mute', target: targetId, minutes });
            const displayTarget = await service.formatTargetDisplay(session, result.plan?.targetId, targetId);
            return formatAction(result, config, displayTarget);
        }
        const auth = await service.authorizeCommand('mute', session);
        if (!auth.ok) {
            const punished = await service.punishUnauthorizedMuteAttempt(session, targetId);
            if (punished) {
                service.logCommandResult('punish-unauthorized-mute', punished, session, { source: 'mute', target: targetId, minutes });
                const displayTarget = await service.formatTargetDisplay(session, punished.plan?.targetId, session?.userId);
                return formatAction(punished, config, displayTarget);
            }
            return auth.userMessage ?? '权限不足或上下文不符合要求。';
        }
        const result = await service.mute(session, targetId, minutes, options.reason);
        service.logCommandResult('mute', result, session, { target: targetId, minutes });
        const displayTarget = await service.formatTargetDisplay(session, result.plan?.targetId, targetId);
        return formatAction(result, config, displayTarget);
    });
    root
        .subcommand('gag [target:string]', '自我约束（随机 1~60 分钟禁言）')
        .alias('自我约束')
        .option('reason', '-r <reason:string> 操作原因')
        .action(async ({ session, options }, target) => {
        if (!config.enableSelfGag)
            return '自我约束功能未启用。';
        if (!session?.userId)
            return '无法识别当前账号。';
        if (config.allowedUserIds.includes(session.userId))
            return '喵~ 白名单用户不参与自我约束。';
        const resolvedTarget = target || session.userId;
        if (await service.shouldSelfGag(session, resolvedTarget)) {
            const result = await service.selfGag(session, 'gag-trigger');
            service.logCommandResult('self-gag', result, session, { source: 'gag', target: resolvedTarget });
            const displayTarget = await service.formatTargetDisplay(session, result.plan?.targetId, resolvedTarget);
            return formatAction(result, config, displayTarget);
        }
        const auth = await service.authorizeCommand('gag', session);
        if (!auth.ok)
            return auth.userMessage ?? '权限不足或上下文不符合要求。';
        const randomMinutes = Math.floor(Math.random() * 60) + 1;
        const result = await service.mute(session, resolvedTarget, randomMinutes, options.reason ?? 'gag');
        service.logCommandResult('gag', result, session, { target: resolvedTarget, randomMinutes });
        const displayTarget = await service.formatTargetDisplay(session, result.plan?.targetId, resolvedTarget);
        return formatAction(result, config, displayTarget);
    });
    root
        .subcommand('unmute <target:string>', '解除群成员禁言')
        .option('reason', '-r <reason:string> 操作原因')
        .action(async ({ session, options }, target) => {
        if (!target)
            return '请提供目标 QQ 号或 @目标。';
        const auth = await service.authorizeCommand('unmute', session);
        if (!auth.ok)
            return auth.userMessage ?? '权限不足或上下文不符合要求。';
        const result = await service.unmute(session, target, options.reason);
        service.logCommandResult('unmute', result, session, { target });
        const displayTarget = await service.formatTargetDisplay(session, result.plan?.targetId, target);
        return formatAction(result, config, displayTarget);
    });
    root
        .subcommand('admin <target:string> [state:string]', '设置或取消群管理员', {
        dependencies: ['qqgm-admin'],
        showWarning: false,
    })
        .option('reason', '-r <reason:string> 操作原因')
        .action(async ({ session, options }, target, state) => {
        if (!target)
            return '请提供目标 QQ 号或 @目标。';
        const auth = await service.authorizeCommand('admin', session);
        if (!auth.ok)
            return auth.userMessage ?? '权限不足或上下文不符合要求。';
        const available = await service.canUseAdminCommand(session);
        if (!available.ok)
            return available.userMessage ?? '当前场景不可用该子命令。';
        const normalized = (state ?? 'on').toLowerCase();
        const enable = !(normalized === 'off' || normalized === '0' || normalized === 'false');
        const result = await service.setAdmin(session, target, enable, options.reason);
        service.logCommandResult('admin', result, session, { target, state: normalized });
        const displayTarget = await service.formatTargetDisplay(session, result.plan?.targetId, target);
        return formatAction(result, config, displayTarget);
    });
}
