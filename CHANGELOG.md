# 更新日志

本文件记录所有值得注意的变更。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 1.1.0

### 新增

- **强关键词机制（无视白名单豁免）**：新增 `strongKeywords` 配置项，支持全局与按群配置。

  此前白名单（`whitelistKeywords`）是在违禁词评分**之前**判定的：消息只要命中
  「宣传部」等任意一个白名单词，就整条跳过违禁词管控。这留下一个可被利用的口子——
  在骚扰/找对象消息后面附一个白名单词即可完全绕过管控
  （例如「有没有美女，我是宣传部的」）。

  现在强关键词改为在**白名单豁免之前**判定：命中即可触发管控，白名单不豁免。
  强关键词与普通违禁词共用同一套顺序模糊匹配算法和 `bannedWordScoreThreshold`
  评分阈值，同样支持 `关键词|分值` 语法。

  解析顺序变为：**强关键词 → 白名单豁免 → 普通违禁词**。

  群级 `strongKeywords` 留空时跟随全局设置；填写后覆盖全局（与 `autoMuteThreshold`
  等字段的「留空跟随」语义一致）。

- 校验：新增单元测试覆盖强关键词绕过白名单、普通违禁词仍豁免、阈值约束、
  群级覆盖全局、未匹配群回落全局等 13 项断言，全部通过。

## 1.0.3

### 新增

- **`[Version]` 指令**：查看插件信息（当前版本、作者、GitHub 与 npm 地址）。
  版本号与仓库地址从 `package.json` 读取，避免发版时忘记同步；该指令已加入 `[bot]` 菜单。
  前缀可用 `cmdVersion` 配置修改，默认 `[Version]`（精确匹配，大小写敏感）。

## 1.0.2

### 修复

- **恢复被误删的 5 个权限与日志方法**：`authorize`、`authorizeCommand`、
  `canUseAdminCommand`、`logAuth`、`logCommandResult`。

  这些方法在早期清理旧菜单死代码时被连带删除，导致 **1.0.0 / 1.0.1 中执行管理指令
  或写日志时会抛 `TypeError: this.logCommandResult is not a function`**。
  `canUseAdminCommand` 有 6 处调用、`logCommandResult` 有 12 处调用，因此影响面覆盖
  权限校验与指令日志这些既有功能（新增功能测试未覆盖到，故此前未暴露）。

  现已从 0.1.7 原文恢复，并补做**全量方法完整性校验**：
  204 个方法定义 / 176 处 `this.xxx()` 调用，无缺失。

- 建议所有使用 1.0.0 / 1.0.1 的部署升级到本版本。

## 1.0.0

首个稳定版本。收敛此前所有群管能力，指令统一为方括号直连语法。

### 指令

- 全部指令改为 `[前缀] 参数` 形式，目标支持 QQ 号或 `@某人`：`[mute]` `[unmute]`
  `[kick]` `[memory]` `[ban]` `[unban]` `[banlist]` `[custom]`，单独发送 `[bot]` 查看菜单。
- 指令名称固定为英文；菜单行首保留中文功能名（例如 `禁言 [mute] qq time reason`）。
- 禁言时长只接受英文/数字单位：`10` / `10m` / `1h` / `1d` / `1w`。
- 记忆子命令：`list` / `search`（`query`、`find` 同义）/ `delete`（`del` 同义）。
- 入群审核：`approve [编号] [理由]` 与 `reject [编号] [理由]`，编号可省略。
- 自定义指令是唯一允许使用中文触发词的入口；一条未配时 `[custom]` 提示「目前还没有指令。」。

### 记忆库

- `saveMemoryToFile` / `deleteMemoryByKeyword` 增加写互斥（promise 队列），
  串行化「读整档 → 改 → 整写」，并发保存不再互相覆盖丢条目。

### 入群审核

- 待审申请落盘到 `JoinRequests.md`（可配 `pendingJoinFileName`），内容为人类可读表格
  加一段机器可读 JSON 区段。
- 新申请到达与审核完成后去抖落盘（500ms），插件 `dispose` 时同步刷盘兜底。
- 启动时自动恢复待审单，并按 `joinRequestReviewTtlMinutes` 清理已过期编号。

### 黑名单与退群判定

- **修复**：`handleMemberRemoved` 原先写成 `if (session.subtype && session.subtype !== 'passive') return`，
  `subtype` 缺失时会继续执行，导致**主动退群**的人被当成「被踢」记入黑名单。
  现改为白名单式判定，只认明确的被踢语义。
- 被踢者优先取 `targetId`；退用 `userId` 时必须与操作者不同才算被踢者。
- bot 自身永不入黑名单（原判断用 `session.selfId`，取不到值导致保护失效）。
- 无法确证被踢者时只记日志、不写黑名单——宁可漏记，也不误拉黑。
- 踢人后自动记录黑名单的行为由 `banRecordOnKick` 控制。

### 菜单

- 移除早期版本遗留的 Koishi 指令注册与图片菜单相关死代码，菜单改为纯文本输出，
  不再需要 `puppeteer`。

### AI 回复与识图

- AI 回复默认只对已在 `groupRules` 中单独配置的群生效（`aiReplyRequireGroupRule`，默认 `true`），
  避免未配置的群被意外接话。
- 违禁词改为整条消息**评分制**：顺序子序列匹配 + 置信度衰减 + 词长自适应门槛 + 可配权重
  （`关键词|分值`），累计得分达到 `bannedWordScoreThreshold` 才触发。
- 新增按群违禁词白名单 `whitelistKeywords`（用于招新等允许宣传的场景），
  可选 `whitelistOnlyOwners` 仅群主/管理员生效。
- 识图统一解析器：兼容 CQ 码、HTML `<img>`、消息元素三种形态，自动解码 HTML 实体，
  图片下载转 data URL 后送入模型。
- 兴趣判定输出配额提升，避免带思考的模型正文为空导致判定长期失效。

### 其他

- 复读支持图片引用，缺引用时可通过 `get_msg` 回查原消息。
- `dryRun` 开启后仅输出计划动作，不实际执行群管操作。

## 0.1.7

- AI 回复限定在「已单独配置的群」，修复未配置群回落全局开关的问题。
- 按群违禁词白名单 `whitelistKeywords` / `whitelistOnlyOwners`。
- 新增自定义命令 `customCommands`：触发词完全匹配（忽略首尾空白），支持
  多回复（随机或轮换）、引用、限定群、冷却、命中日志，命中后不走 AI。

## 0.1.6

- 识图修复：此前与 NapCat/Koishi 实际下发的消息结构不匹配，导致 AI 永远「看不到图」。
- 随机/阈值触发支持纯图片与表情包。
- 修复兴趣判定长期失效（`reason=empty`）。
- 违禁词改为整条消息评分制。

## 0.1.0

- 首个版本：群管命令、权限校验、图片菜单、状态卡片、复读、AI 群聊回复、记忆库、识图与自动管控。
