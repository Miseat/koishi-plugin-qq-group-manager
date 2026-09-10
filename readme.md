# koishi-qq-group-manager

[![npm](https://img.shields.io/npm/v/%40nestim%2Fkoishi-qq-group-manager?style=flat-square)](https://www.npmjs.com/package/@nestim/koishi-plugin-qq-group-manager)

QQ群管理插件（OneBot/LLOneBot）：群管命令、权限校验、图片菜单、状态卡片、复读、AI群聊回复、记忆库、识图与自动管控（禁言/踢人）。

## v0.1.6 重点更新

### 1. 识图彻底修复（此前完全不可用）

早前版本的图片检测对 NapCat/Koishi 实际下发的消息结构**完全不匹配**，导致 AI 永远「看不到图」：

| 旧实现假设 | 实际情况 |
| --- | --- |
| `session.content` 含 `[CQ:image,...]` | 实际是 HTML 形态 `<img src="..." summary="[动画表情]" sub-type="1"/>` |
| 元素 `type === 'image'` | 实际是 `type === 'img'` |
| 图片地址在 `url` / `src` | 实际在 `attrs.src` |
| 表情包靠 `[CQ:face]` | 实际靠 `attrs.subType === 1` / `summary="[动画表情]"` |

此外 `<img src>` 中的 `&amp;` 是 HTML 实体，**未解码直接请求必然 404**。

修复后：
- 新增统一视觉解析器，同时兼容 CQ 码、HTML `<img>`、element 三种形态，并自动解码 HTML 实体；
- 图片会**下载并转为 base64 data URL** 再交给模型，不再依赖模型侧能否访问 QQ 图链（QQ 图链需 `rkey` 鉴权且有时效）；
- 支持**「回复某张图片再 @bot」**：适配器已把被回复消息放在 `session.quote`，现在会从中取图；
- 表情包（`subType=1`）同样会被识别与理解。

### 2. 修复随机/阈值触发对纯图片、表情包无效

- 纯图片/表情消息此前会被「无文本」守卫直接丢弃，现改为参与兴趣/阈值判定；
- 兴趣判定提示词不再把「没有文字」等同于「无价值」，表情包/图片可作为正常互动被接话。

### 3. 修复兴趣判定长期失效（`reason=empty`）

`deepseek-flash` 等**带思考的模型**会先消耗 reasoning tokens。原兴趣判定只给 `max_tokens: 48`，额度被思考过程耗尽后正文为空，导致判定恒为 `score=0 reason=empty`、随机回复形同虚设。

- 额度提升至 512（OpenAI 兼容与 Gemini 两条路径同步修复）；
- 正文仍为空时，回退从 `reasoning_content` 中提取 JSON。

### 4. 违禁词改为「整条消息评分」制

原实现是逐词 `includes` 精确包含，广告把词隔开即可绕过（如 `领红包` 无法命中 `领xxx元红包`）。

新机制：
- **顺序子序列匹配**：关键词字符按序出现即命中，允许中间隔词；
- **置信度**：按「词长归一化的间隔溢出」衰减，跨度超过词长 3 倍或溢出超过 8 字则判定为偶然凑齐、直接拒绝（可拦住 `领 导 强 调 红 色 包 装` 这类）；
- **词长自适应门槛**：短词（2~4 字）需要更高置信度，降低无关文本误伤；
- **可配置权重**：`"关键词|分值"` 形式，未指定时按内置分档表取值（显式广告词如 `扫码进群` 80 分，营销组合词如 `赚钱` 35 分）；
- **整条消息累计得分 ≥ `bannedWordScoreThreshold`（默认 70）** 才触发管控（撤回/禁言/踢人），日志会输出命中明细与得分。

> 局限说明：字符级匹配无法区分「字符顺序与间隔完全一致」的两个串。
> 例如 `领xxx元红包`（广告）与 `领导说把红色包装袋收好`（正常）跨度均为 7、置信度均为 0.667，属于原理性边界，可通过调整阈值与权重缓解。

## 禁言指令优化（v0.0.4）

`群管 mute` 不再依赖固定顺序解析参数，改为智能解析，避免「禁言时长被识别成 QQ 号」：

- 目标优先取 `@用户`（支持群内 @ 及 `[CQ:at]`），再考虑文本中的 QQ 号；
- 时长支持多种写法：`10`（分钟）、`10分钟` / `10分` / `10min` / `10m`、`1小时` / `1时` / `1h`、`1天` / `1d`、`1周` / `1w`；
- 兼容「先时长后 QQ」的输入（如 `群管 mute 30 123456`），会自动与群成员比对纠正目标；
- 缺少目标或时长时会给出明确提示与示例，不再静默把数字当 QQ 号处理；
- 时长上限 30 天（43200 分钟），超出部分按 30 天处理并在结果中提示。

示例：

```
群管 mute @用户 10            # 10 分钟
群管 mute 123456 30分钟        # QQ 123456 禁言 30 分钟
群管 mute @用户 1小时 -r 刷屏   # 1 小时，附原因
群管 unmute @用户              # 解除禁言
```

## 自动管控（v0.0.4 新增）

成员在群内触发违规（命中违禁词 / 卡片消息 / 合并转发，行为沿用「消息管控」既有配置）后，插件会按群统计违规次数，达到阈值自动处理：

- **自动禁言**：累计违规达到阈值 → 按设定时长禁言；
- **自动踢人**：累计违规达到更高阈值 → 自动移出群聊并清零计数；
- 计数采用滑动窗口（默认 60 分钟）：窗口内连续违规才累计，超时未违规则重新计数；
- 白名单账号、群主、群管理员、bot 自身不会触发自动禁言/踢人（消息撤回与提示仍按原逻辑执行）；
- 自动处理后若开启「违规群内提示」，会在群内公告处理结果；所有判定均写入插件日志。

全局默认设置（插件配置 →「自动管控」）：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enableAutoMute` | false | 是否启用自动禁言 |
| `autoMuteViolationThreshold` | 3 | 触发自动禁言的违规次数 |
| `autoMuteMinutes` | 10 | 自动禁言时长（分钟） |
| `enableAutoKick` | false | 是否启用自动踢人 |
| `autoKickViolationThreshold` | 5 | 触发自动踢人的违规次数 |
| `autoViolationWindowMinutes` | 60 | 违规计数统计窗口（分钟） |

按群单独设置：在插件配置 →「消息管控」→ `groupRules` 中为某个群新增一条记录并填写 `autoMuteEnabled` / `autoMuteThreshold` / `autoMuteMinutes` / `autoKickEnabled` / `autoKickThreshold` / `autoViolationWindowMinutes`，即可覆盖全局设置；留空则跟随全局。

## 记忆库（v0.0.4+）

通过群聊指令维护一份 `Memory.md`（默认存储在 Koishi 数据目录），充当长期记忆库；

- **保存**：`[记忆]+内容`（如 `[记忆] 小明的生日是2000年6月`），自动带上时间与用户写入 `Memory.md`，每条记忆之间用 `---` 分隔。
- **查询**：`[记忆查询] 关键词`（无关键词则列出最近几条）。
- **列表**：`[记忆列表]`（列出最近记忆）。
- **删除**：`[记忆删除] 关键词`（删除所有包含该关键词的记忆）。
- **供 AI 引用**：开启 `memoryInAi` 后，AI 回复与识图时会检索相关记忆并注入上下文（相关才引用，不编造）。
- **查看/编辑**：在 Koishi 控制台左侧「Explorer（探索器）」里打开 `Memory.md`，可直接查看和手动增删改。

全局开关：插件配置 →「记忆库」→ `enableMemory` / `memoryFileName` / `memoryInAi`。

## AI 识图（v0.0.4+）

- 识图走 OpenAI 兼容接口的 `image_url` 格式（`deepseek-v4-flash-vision-exp` 等支持视觉的模型可用）。
- 图片来源要求：`[CQ:image,url=http(s)://...]` 或图片元素中的 http(s)/`data:image/` 链接；若 LLOneBot 只给了 `file=`/`file_id` 本地路径（无 http 链接），则无法直接识别。
- 调试：
  - 群内发送 `群管 查图`（可附一张图），会显示这条消息里识别到的图片数量与链接/原始字段；
  - 发送图片并 `@bot` 时，若检测到图片但提取不到可发送链接，会写 `[img-debug]` 日志。
- 前提：`aiEnableImageRecognition` 为 true、`aiImageMaxCount > 0`，且所用模型支持视觉输入。

## 当前状态

已完成插件框架初始化，包含：

- `Config` 配置模型
- `QQGroupManagerService` 服务层
- `群管` 命令入口（`ping` / `plan`）
- 预留的群动作计划类型定义
- 权限校验框架（账号白名单 + 群主/群管理员）
- 基础群管理动作（踢人 / 禁言 / 设管理员）
- 指令日志输出（鉴权日志 + 执行结果日志）
- Meow 图片菜单（可选接管 help）

## 目录结构

```txt
src/
  index.ts      # 插件入口与配置
  service.ts    # 管理服务与未来业务逻辑入口
  commands.ts   # 命令注册
  types.ts      # 通用类型定义
```

## 权限模型

- `allowedUserIds`: 账号白名单，命中后直接通过。
- 非白名单账号：在群聊上下文里，若为群主或群管理员可通过（可配置开关）。
- `admin` 子命令可配置为仅在 bot 为当前群群主时可用（`requireBotOwnerForAdmin`）。

## 日志与输出

- 鉴权细节（白名单/群主/管理员判定）只写入日志，不回显到群聊。
- 指令执行结果会写入插件日志（可配置开关）。
- `dryRun` 默认关闭（`false`），开启后仅输出计划动作不实际执行。

## 菜单功能

- `menuCommand`: 菜单指令名（默认 `菜单`）。
- `replaceHelpAsImageMenu`: 开启后接管 `help`，返回全插件图片菜单。
- `replaceStatusAsImage`: 开启后接管 `status`，返回 Meow 风格状态图片（CPU/内存）。
- 在 OneBot 群聊上下文下，`status` 会额外尝试读取 LLOneBot/OneBot `getStatus()` 并展示在线与统计信息。
- 图片渲染依赖 `puppeteer`，未启用时会回退文本提示。
- 分级菜单：
  - `help` / `菜单`：仅显示父指令分类（如 `群管菜单`）。
  - `help <父指令菜单>` / `菜单 <父指令菜单>`：显示该分类下子指令。
  - 也可直接输入父指令（如 `群管`）直接查看该分类菜单。
  - 用户发送 `help`/`菜单` 后 30 秒内，下一条消息会自动作为菜单关键词配对解析（用于补偿直接发送 `群管菜单` 等触发不稳定场景）。
- 无父指令的命令会被归入 `其它菜单` 分类。

## 群消息管控

- `bannedWords`: 违禁词列表（可在配置页直接维护）。
- `blockCardMessage`: 是否禁止卡片消息（OneBot `json/xml`）。
- `blockForwardMessage`: 是否禁止合并转发消息（OneBot `forward`）。
- `autoDeleteViolation`: 违规后是否自动撤回消息。
- `sendViolationNotice`: 违规后是否在群内发送提示。
- `groupRules`: 按群聊覆盖上述策略（每个群可配置不同选项）。
- `groupRules.enableAiReply`: 可按群覆盖 AI 回复开关（留空则继承全局）。
- 自动禁言 / 自动踢人：见上方「自动管控」一节，支持全局与按群配置。

## 群聊互动

- `enableRepeater`: 启用复读功能。
- `repeaterThreshold`: 连续相同消息触发阈值（默认 3）。
- `repeaterCooldownSeconds`: 同一内容复读冷却（秒）。
- `repeaterEnableGetMsgRefetch`: 当图片消息缺少可发送引用时，通过 OneBot `get_msg` 回查原消息提取 `url/file/id` 后再发送（默认开启）。
- `enableJoinRequestReview`: 启用后自动监听新入群申请并在群内发起审核。
- `joinRequestReviewTtlMinutes`: 审核编号有效期（分钟，默认 30）。
- 触发后 bot 会复读文本与图片（如有），并将“复读触发事件”写入 AI 上下文供后续回复参考。
- 新入群申请会自动推送到群聊，管理员可通过命令或快捷文本进行放行/拒绝。

## AI 自动回复

- 支持两类接口：
  - `openai-compatible`：OpenAI 兼容 Chat Completions（可用于 OpenAI、火山引擎、Codex API/Auth 等兼容网关）。
  - `gemini`：Google Gemini 原生 `generateContent` 接口。
- 主要配置项：
  - `enableAiReply`：总开关。
  - `aiProvider` / `aiBaseUrl` / `aiApiKey` / `aiModel`：模型接入参数。
  - `aiAgentName`：默认智能体自称。
  - `aiSystemPrompt`：默认系统提示词。
  - `aiPersonas` / `aiActivePersona`：多人格配置与切换（可为每个人格设置独立自称与提示词）。
  - `aiReplyMode`：`threshold` / `random` / `hybrid`。
  - `aiMessageThreshold`：累计消息触发阈值。
  - `aiRandomReplyProbability`：随机触发概率。
  - `aiMinReplyIntervalSeconds`：同群最短回复间隔。
  - `aiContextWindow`：送入模型的最近消息窗口。
  - `aiTemperature` / `aiMaxOutputTokens`：生成参数。
  - `aiEnableImageRecognition` / `aiImageMaxCount`：图片识别开关与单次识别图片上限。
  - `aiIgnoreCommandMessage`：忽略命令样式消息，避免影响正常指令流程。
  - `aiEnableDirectMentionTrigger`：是否启用“点名智能体名即强制触发”。
  - `aiEnableFollowupAfterMention` / `aiFollowupWindowSeconds` / `aiFollowupMaxTurns`：点名后同用户跟随回复配置。
  - `aiOwnerPlatform` / `aiOwnerUserId`：主人身份标识（默认 `onebot + QQ号` 形式）。
  - `aiHomePlatform` / `aiHomeUserId`：兼容旧字段，建议迁移到 `aiOwner*`。
  - `aiInterestMinScore`：非点名场景 AI 兴趣触发最低分（越高越冷静）。
  - `aiInterestContextWindow`：非阈值兴趣判定读取的上下文条数（默认 8，范围 4~16）。
- 触发逻辑：
  - 达到阈值后触发；非阈值场景由 AI 兴趣判定触发（不再依赖概率随机）。
  - 非阈值兴趣判定会读取近期上下文，不再只看单条消息。
  - 当消息中命中当前生效的智能体自称（或直接 `@bot`）时，会忽略累计阈值直接触发，并基于该消息及近期上下文回复。
  - 点名触发不会重置阈值计数，阈值累计继续生效。
  - 点名触发时会优先只回应点名那条消息，不会转去回答其他上下文消息。
  - 点名后会进入“话题跟随窗口”，优先判断点名者后续消息；同时允许主人或上下文中的相关追问者对同话题接续提问。
  - 阈值触发时会先进行兴趣判定，若兴趣分不足可跳过发言（仅日志记录）。
  - 点名消息若包含图片，会尝试进行图片识别后再回复（OpenAI 兼容接口为原生图文输入；Gemini 模式回退为图片链接辅助识别）。
  - 点名触发时输出单条正常回复，不额外附加总结文本，减少 token 消耗。
  - 阈值模式会强调“优先回复选定目标消息”，并压缩上下文范围降低错位回复概率。
  - 发送结果与错误信息仅写入插件日志（`cmd:ai-reply`）。

## 命令（首版）

- `群管 ping`
- `菜单 [关键词]`
- `群管 plan <groupId>`
- `群管 kick <qq号|@用户> [-r] [-m 原因]`
- `群管 mute <qq号|@用户> <时长>`（时长支持 `10`、`10分钟`、`1小时`、`1天` 等写法，见上文）
- `群管 gag [qq号|@用户]` / `群管 口球 [qq号|@用户]`
- `群管 unmute <qq号|@用户> [-r 原因]`
- `群管 admin <qq号|@用户> [on|off] [-r 原因]`
- `群管 审核 <编号> <同意|拒绝> [-r 理由]`

收到新入群申请后，群内会收到审核提示，支持两种处理方式：

- 命令：`群管 审核 <编号> 同意` / `群管 审核 <编号> 拒绝`
- 快捷文本：`同意入群 <编号>` / `拒绝入群 <编号>`

普通成员在群聊中将 `mute`/`gag` 目标指向自己时，会忽略时长与规则，随机触发 1~60 分钟口球禁言。
该功能可在控制页「娱乐设置」通过 `enableSelfGag` 开关启停。

- 白名单用户不会触发口球娱乐逻辑。
- 白名单目标默认受禁言保护；可通过 `allowAdminBypassWhitelistMute` 控制是否允许群主/管理员绕过保护执行禁言。
- 普通成员反复尝试对他人执行禁言时，会触发惩罚：随机 1~10 分钟禁言本人。
  - 该行为可配置：`enableUnauthorizedMutePunish`、`unauthorizedMuteAttemptThreshold`、`unauthorizedMuteWindowMinutes`、`unauthorizedMutePunishMinMinutes`、`unauthorizedMutePunishMaxMinutes`。
