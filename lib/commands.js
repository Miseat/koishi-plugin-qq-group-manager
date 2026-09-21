"use strict";
/**
 * 指令注册层。
 *
 * 说明：所有群管指令均为「方括号直连」语法（如 [mute] 12345 10 广告），
 * 由 service.routeBracketCommand 在消息监听中直接处理。
 *
 * 这里**不再**用 ctx.command 注册 [bot]：一旦注册，Koishi 会在 [bot] 消息下
 * 自动追加一份它自己生成的子指令列表（旧菜单），与插件自己的英文菜单同时
 * 出现，导致发一次 [bot] 冒出新旧两个菜单。现在 [bot] 完全由 routeBracketCommand
 * 处理，只输出一份菜单。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;

function registerCommands(_ctx, _service, _config) {
    // 无需注册任何 Koishi 指令，保留此导出以兼容既有调用方。
}
