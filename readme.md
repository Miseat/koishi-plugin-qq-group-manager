# @nestim/koishi-plugin-qq-group-manager

[![npm version](https://img.shields.io/npm/v/%40nestim%2Fkoishi-plugin-qq-group-manager?style=flat-square)](https://www.npmjs.com/package/@nestim/koishi-plugin-qq-group-manager)
[![license](https://img.shields.io/npm/l/%40nestim%2Fkoishi-plugin-qq-group-manager?style=flat-square)](./LICENSE)

Koishi 的 QQ 群管理插件（OneBot / NapCat / LLOneBot）。

一套方括号直连指令 + 分级配置，覆盖群管动作、消息管控、自动处罚、记忆库、黑名单、
入群审核、复读与 AI 群聊回复。**不依赖数据库**，状态以 Markdown 文件落盘，可直接在
Koishi 控制台「探索器 Explorer」里查看和手改。

- 指令统一为 `[前缀] 参数` 形式，目标支持 QQ 号或 `@某人`
- 所有指令名称为英文；菜单行首用中文标注功能名（如 `禁言 [mute] ...`）
- 菜单是纯文本，**不依赖 puppeteer / 图片渲染**
- 出问题可直接看 Koishi 数据目录里的 `.md` 文件，无需查库

---

## 功能

| 分组 | 能力 |
| --- | --- |
| **群管动作** | 禁言 / 解除禁言 / 踢人（可拒绝其再次加群）；时长支持 `10`、`10m`、`1h`、`1d`、`1w`，上限 30 天 |
| **权限校验** | 账号白名单 + 群主 / 群管理员；可要求 bot 为群主才放行管理动作 |
| **消息管控** | 违禁词**整条消息评分制**（顺序模糊匹配 + 置信度衰减 + 可配权重），卡片消息、合并转发拦截，可自动撤回并群内提示 |
| **强关键词** | `strongKeywords`：命中即可触发管控，且**无视白名单豁免**，堵住「附一个白名单词即可绕过管控」的口子；判定顺序为 强关键词 → 白名单 → 普通违禁词 |
| **按群覆盖** | `groupRules` 可为每个群单独设定违禁词、强关键词、白名单关键词与各类开关，未配置则跟随全局 |
| **自动处罚** | 统计窗口内累计违规达到阈值后自动禁言 / 自动踢人，阈值、时长、窗口均可配 |
| **黑名单** | 按群独立存储（`banMember_<群号>.md`）；入群自动比对并踢出，可选踢人时自动记录 |
| **入群审核** | 新申请推送到群内，管理员用 `approve` / `reject` 放行或拒绝；待审单落盘，**重启不丢** |
| **记忆库** | `[memory]` 保存 / 列出 / 查询 / 删除，落盘 `Memory.md`；开启后 AI 回复会检索并引用相关记忆 |
| **AI 群聊回复** | 三道闸门（阈值 / 概率 / 冷却）+ 模型自行 `<pass/>` 决定是否接话；群名片、引用、@ 目标、自己历史发言都进上下文；记忆按相关度注入；图片并发解析并限时。多人格、点名后话题跟随、温度与输出上限 |
| **AI 识图** | 图片下载转 data URL 后送入模型，兼容 CQ 码 / HTML `<img>` / 元素三种形态与表情包 |
| **AI 联网搜索** | 按问题自动判断是否联网，调用 DeepSeek 原生 Search API（复用现有 API Key），结果注入提示词；API 不支持 / 超时 / 无结果时自动回退普通回复 |
| **复读** | 连续相同消息达阈值复读，支持图片引用回查；复读事件会进入 AI 上下文 |
| **娱乐** | 自我约束（口球）与违规禁言惩罚，可开关与调节参数 |

## 安装

```sh
# npm
npm i @nestim/koishi-plugin-qq-group-manager

# 或在 Koishi 控制台「插件市场」搜索 qq-group-manager 安装
```

依赖 `koishi >= 4.18.7`，需要 OneBot 实现（NapCat / LLOneBot 等）提供
`setGroupBan` / `setGroupKick` / `getGroupMemberInfo` 等接口。

## 指令

所有指令都是 `[前缀] 参数`，目标既可以是 QQ 号，也可以是 `@某人`。
单独发送 `[bot]` 查看菜单。

| 指令 | 说明 |
| --- | --- |
| `[mute] QQ 时长 [原因]` | 禁言。时长 `10` / `10m` / `1h` / `1d` / `1w`，上限 30 天 |
| `[unmute] QQ [原因]` | 解除禁言 |
| `[kick] QQ [原因]` | 移出群聊（可拒绝其再次加群请求，并记入黑名单） |
| `[memory] 内容` | 保存一条记忆 |
| `[memory] list` | 列出最近 10 条记忆 |
| `[memory] search 关键词` | 查询记忆（`query` / `find` 同义） |
| `[memory] delete 关键词` | 删除含该关键词的记忆（`del` 同义） |
| `[ban] QQ [原因]` | 加入本群黑名单 |
| `[unban] QQ [原因]` | 移出本群黑名单 |
| `[banlist]` | 列出本群黑名单 |
| `[custom]` | 列出自定义指令；没有配置时提示「目前还没有指令。」 |
| `[bot]` | 查看指令菜单 |
| `[Version]` | 查看插件信息（当前版本、作者、GitHub 与 npm 地址）|

**入群审核**：新申请会在群里收到带 6 位编号的提示，管理员直接发文本处理：

- 放行：`approve [编号] [理由]`
- 拒绝：`reject [编号] [理由]`

编号可省略，省略时取当前群最近一条待审申请。

## 配置分组

插件配置页按以下分组组织（共 11 组）：

`基础设置` · `消息管控` · `自动管控` · `记忆库` · `黑名单` ·
`娱乐设置` · `群聊互动` · `自定义命令` · `AI 回复` · `权限设置` · `日志设置`

几个常用项：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `command` | `[bot]` | 菜单入口前缀 |
| `allowedUserIds` | `[]` | 可直接使用管理指令的账号白名单 |
| `bannedWords` | `[]` | 违禁词；支持 `关键词\|分值` 自定义权重 |
| `bannedWordScoreThreshold` | `70` | 违禁词评分触发阈值（强关键词共用） |
| `strongKeywords` | `[]` | 强关键词；命中即触发且**无视白名单豁免**，支持 `关键词\|分值` |
| `groupRules` | `[]` | 按群覆盖策略（违禁词、强关键词、白名单关键词、AI 开关、自动处罚阈值等） |
| `memoryFileName` | `Memory.md` | 记忆库文件名（存放在 Koishi 数据目录） |
| `blacklistFileName` | `banMember.md` | 黑名单文件名模板，实际为 `banMember_<群号>.md` |
| `pendingJoinFileName` | `JoinRequests.md` | 待审入群申请落盘文件名 |
| `enableJoinRequestReview` | `true` | 是否发起入群审核 |
| `enableAiReply` | `false` | AI 回复总开关（建议配合 `aiReplyRequireGroupRule` 逐群开启） |
| `aiReplyRequireGroupRule` | `true` | 仅对已在 `groupRules` 中单独配置的群启用 AI 回复 |
| `aiContextWindow` | `30` | 进入提示词的消息条数（建议 20~40） |
| `aiReplyDecision` | `single` | `single` 一次调用（推荐）/ `two-stage` 两次调用 |
| `aiMaxReplyChars` | `120` | 单条回复最大字符数 |
| `aiQuoteReplyMode` | `random` | 回复是否引用触发消息：`random` / `always` / `never` |
| `aiQuoteReplyProbability` | `0.5` | `random` 模式下的引用概率 |
| `aiReadForwardMessage` | `true` | 读取合并转发聊天记录作为上下文 |
| `aiForwardMaxNodes` | `20` | 单条合并转发最多读取多少条子消息 |
| `aiImageBudgetMs` | `6000` | 图片解析总预算（毫秒），超时跳过 |
| `aiWebSearchEnabled` | `true` | 启用联网搜索（DeepSeek Search API，复用 `aiApiKey`） |
| `aiWebSearchMode` | `auto` | `auto` 自动判断 / `always` 每次都搜 / `off` 关闭 |
| `aiWebSearchMaxResults` | `5` | 每次搜索取几条结果 |
| `aiWebSearchTimeoutMs` | `4000` | 搜索请求超时（毫秒） |
| `aiWebSearchMaxPerHour` | `10` | 每个群每小时最多搜索次数；0=不限 |
| `aiWebSearchCacheMinutes` | `10` | 相同 query 的结果缓存分钟数 |
| `aiDebugPrompt` | `false` | 把最终提示词写入日志，排查"答非所问" |
| `dryRun` | `false` | 演练模式：只输出计划动作，不真正执行 |

## AI 回复与识图

- **接口**：`openai-compatible`（OpenAI 兼容 Chat Completions）与 `gemini`（原生 `generateContent`）两类。
- **触发**：先过三道闸门，任一不过都不产生模型调用：
  1. `aiMessageThreshold` 消息阈值（`threshold` / `hybrid`）——累计未达阈值不触发；
  2. `aiRandomReplyProbability` 随机概率（`random` / `hybrid`）——每条消息掷一次骰，未掷中直接跳过；
  3. 冷却：同一群两次真正调用模型之间至少间隔 `aiMinReplyIntervalSeconds`。

  `hybrid` 表示**两者都需满足**（先够消息数，再掷中概率）。消息中命中智能体自称或直接 `@bot` 时，
  越过上述全部闸门直接触发。点名与点名后跟随不受冷却限制。
- **接话决策**：默认 `aiReplyDecision: single`——模型在回复时自行判断，不值得接话就只输出 `<pass/>`，
  此时不会发消息并重置计数。这样「要不要回」和「回什么」是同一次判断，不会出现
  「判定说该回、生成却回了另一条」的错位。设为 `two-stage` 则先判定再生成（多一次延迟）。
- **上下文**：`aiContextWindow` 条消息按**时间顺序**进入提示词，包含 @ 目标（渲染成群昵称）、
  引用消息原文、图片/表情/卡片占位，以及**机器人自己的历史发言**——不会"说完就忘"。
  只回应当前消息，引用与回答始终指向同一条。
- **群名片**：优先取群名片，为空时调用 `getGroupMemberInfo` 补齐并缓存，最后才退回 QQ 昵称/QQ 号。
- **记忆**：只有与当前消息（或最近三条）真正有词面交集的记忆才会注入，并且提示词明确允许忽略；
  旧版「搜不到就注入最近 6 条」的行为已移除，不会再出现"聊什么都能扯回某条旧记忆"。
- **多人格**：`aiPersonas` 保存多套「自称 + 系统提示词」，用 `aiActivePersona` 切换。
- **识图**：开启 `aiEnableImageRecognition` 后，图片并发下载并转为 data URL 再送入模型；
  总预算由 `aiImageBudgetMs` 控制（默认 6 秒），超时直接跳过，不再把回复拖到几十秒。
  模型不支持图片时会自动降级为纯文本并记住该结论，后续不再重复尝试。
- **联网搜索**：`aiWebSearchMode: auto` 时，只有明确的问题/时效性内容才会触发。
  调用当前 `aiBaseUrl` 的 DeepSeek Search API（`/v1/tools/search`），复用现有 `aiApiKey`，
  不需要第三方搜索 Key；结果以 `【联网搜索结果】` 注入，模型一次回答。
  API 不支持（400/401/403/404）、超时、没结果时会**自动放弃搜索**，继续普通模型调用。
  如果模型第一次回答表示“不知道/记不清/搜不了”，会补一次搜索并重写最终回复（仅此时多一次模型调用）。
  默认每群每小时最多 10 次，相同 query 缓存 10 分钟。
- **输出**：单条消息，`aiMaxReplyChars`（默认 120）限制长度；推荐 `aiTemperature` 0.7~0.9。
  `aiQuoteReplyMode` 控制是否引用触发消息：`random`（默认，按 `aiQuoteReplyProbability` 掷骰）、
  `always`、`never`。不引用时直接发到群里，不会出现"每条都挂一条引用"的机械感。
- **合并转发**：开启 `aiReadForwardMessage` 后，消息里的合并转发会通过 OneBot `get_forward_msg`
  拉取子消息，按“发言人: 内容”逐行注入上下文（最多 `aiForwardMaxNodes` 条）。
  适配器不支持或拉取失败时降级为 `[合并转发]` 占位，不影响正常回复。
- **调试**：`aiDebugPrompt` 打开后会把最终提示词写进日志，便于排查"到底看到了什么"。
- **扩展点**：`ctx.nestimQqGroupManager.aiHooks`（接口版本 1）。外部插件可
  `registerPromptSection()` 追加风格段、`registerOutputFilter()` 过滤或丢弃输出；
  钩子异常会被隔离，不影响正常回复。跨插件使用时请注入 root 上的 `qqgmAiHooks`。
  配套的本地风格插件 `koishi-plugin-qqgm-chat-style` 不随本包发布，按需单独部署。

## 外部插件接口（1.2.2+）

主插件暴露一个很小的扩展点，第三方插件可以给 AI 追加“说话风格”，或在发送前过滤输出，
不需要修改主插件源码：

```ts
export const inject = ['qqgmAiHooks']

export function apply(ctx) {
  const hooks = ctx.qqgmAiHooks
  if (!hooks) return

  // 追加到 system prompt 的【说话风格】段
  const off1 = hooks.registerPromptSection(() => '说话短一点，别用“首先/其次”这类词')

  // 发送前过滤；返回 null 表示这条不发（按 pass 处理）
  const off2 = hooks.registerOutputFilter((text) => text.replace(/首先/g, ''))

  ctx.on('dispose', () => {
    off1()
    off2()
  })
}
```

- 风格段插在基础规则之后、`<pass/>` 规则之前，并声明“与系统规则冲突时以系统规则为准”。
- 过滤器按注册顺序执行，异常会被隔离；过滤后的文本才会写回上下文。
- `hooks.version` 目前为 `1`，外部插件应先检查版本。


## 数据文件

均存放在 Koishi 数据目录（`ctx.baseDir`），可用控制台「探索器 Explorer」直接查看与编辑：

| 文件 | 内容 |
| --- | --- |
| `Memory.md` | 记忆库，条目之间以 `---` 分隔 |
| `banMember_<群号>.md` | 各群黑名单，`## QQ号 · 备注` + 加入时间 |
| `JoinRequests.md` | 待审入群申请（人类可读表格 + 机器可读区段），重启自动恢复、过期自动清理 |

## 权限模型

群管指令（`[mute]` `[unmute]` `[kick]` `[ban]` `[unban]` `[banlist]`）采用**两步鉴权**：

1. **操作者身份**：`allowedUserIds` 命中即通过；否则要求是群主（`allowGroupOwner`）或群管理员（`allowGroupAdmin`）。
2. **执行能力**：`requireBotOwnerForAdmin` 开启时，要求 bot 在该群是群主或管理员，否则无法执行。

- 两步都通过才放行。
- 白名单目标默认受禁言保护，`allowAdminBypassWhitelistMute` 决定群主/管理员能否绕过。

鉴权细节与指令执行结果只写日志，不回显到群聊。

---

## English

A QQ group-management plugin for [Koishi](https://koishi.chat) (OneBot / NapCat / LLOneBot).

Bracket-style commands plus layered per-group configuration. Covers moderation actions,
message filtering, automatic punishment, a memory store, blacklists, join-request review,
repeat (echo) and AI group-chat replies. **No database required** — all state is persisted
as Markdown files that you can read and edit directly in the Koishi console (Explorer).

- Commands use a uniform `[prefix] args` form; targets accept a QQ number or `@mention`
- Command names are English; menu lines are labelled in Chinese (e.g. `禁言 [mute] ...`)
- Menus are plain text — **no puppeteer / image rendering**
- Troubleshooting means opening the `.md` files in the Koishi data directory, no DB queries

### Features

| Group | Capability |
| --- | --- |
| **Moderation** | Mute / unmute / kick (optionally rejecting future join requests). Durations `10`, `10m`, `1h`, `1d`, `1w`, capped at 30 days |
| **Authorization** | Account allowlist plus group owner / admin checks; can require the bot itself to hold owner or admin rights |
| **Message filtering** | Whole-message scoring for banned words (fuzzy ordered matching, confidence decay, per-word weights); intercepts card messages and merged forwards; optional auto-recall with a group notice |
| **Strong keywords** | `strongKeywords` triggers moderation on match and **ignores allowlist exemptions**, closing the "append an allowlisted word to bypass" hole. Evaluation order: strong keyword → allowlist → banned word |
| **Per-group overrides** | `groupRules` sets banned words, strong keywords, allowlist keywords and toggles per group; unset values fall back to global |
| **Auto punishment** | Accumulated violations inside a window reaching a threshold trigger auto-mute / auto-kick; threshold, duration and window are all configurable |
| **Blacklist** | Stored per group (`banMember_<groupId>.md`); join requests are matched automatically and rejected |
| **Join review** | New requests are pushed to the group; admins use `approve` / `reject`. Pending requests are persisted and **survive restarts** |
| **Memory store** | `[memory]` save / list / search / delete into `Memory.md`; when enabled, AI replies retrieve and cite relevant memories |
| **AI replies** | Three gates (threshold / probability / cooldown) plus a model-decided `<pass/>` opt-out. Group cards, quoted text, @ targets and the bot's own history all enter the prompt; memories are injected only when relevant; images are resolved concurrently with a time budget. Multiple personas, follow-up window, temperature and output limits |
| **AI vision** | Images are downloaded concurrently and converted to data URLs before being sent to the model; handles CQ codes, HTML `<img>` and message elements, including stickers. Models without vision support degrade to text automatically |
| **Repeat (echo)** | Echoes a message once consecutive repeats reach a threshold; repeat events feed into the AI context |

### Install

```sh
npm i @nestim/koishi-plugin-qq-group-manager
```

Or search `qq-group-manager` in the Koishi console plugin market.

Requires `koishi >= 4.18.7` and a OneBot implementation (NapCat / LLOneBot, etc.) providing
`setGroupBan` / `setGroupKick` / `getGroupMemberInfo`.

### Commands

All commands use `[prefix] args`; targets accept a QQ number or `@mention`.
Send `[bot]` on its own to show the menu.

| Command | Description |
| --- | --- |
| `[mute] QQ duration [reason]` | Mute. Duration `10` / `10m` / `1h` / `1d` / `1w`, max 30 days |
| `[unmute] QQ [reason]` | Unmute |
| `[kick] QQ [reason]` | Remove from the group (optionally reject future join requests and record to the blacklist) |
| `[memory] content` | Save a memory |
| `[memory] list` | List the 10 most recent memories |
| `[memory] search keyword` | Search memories (`query` / `find` are synonyms) |
| `[memory] delete keyword` | Delete memories containing the keyword (`del` is a synonym) |
| `[ban] QQ [reason]` | Add to this group's blacklist |
| `[unban] QQ [reason]` | Remove from this group's blacklist |
| `[banlist]` | List this group's blacklist |
| `[custom]` | List custom commands |
| `[bot]` | Show the command menu |
| `[Version]` | Show plugin info (version, author, GitHub and npm links) |

**Join review**: a new request posts a 6-digit ID to the group. Admins reply with plain text —
`approve [id] [reason]` or `reject [id] [reason]`. The ID may be omitted, in which case the
most recent pending request in that group is used.

### Configuration groups

The plugin's config page is organised into 11 groups:
`基础设置` · `消息管控` · `自动管控` · `记忆库` · `黑名单` · `娱乐设置` · `群聊互动` ·
`自定义命令` · `AI 回复` · `权限设置` · `日志设置` (Basics · Message filtering · Auto
punishment · Memory · Blacklist · Entertainment · Group interaction · Custom commands ·
AI replies · Permissions · Logging).

A few commonly used options:

| Option | Default | Description |
| --- | --- | --- |
| `command` | `[bot]` | Menu entry prefix |
| `allowedUserIds` | `[]` | Accounts allowed to use moderation commands directly |
| `bannedWords` | `[]` | Banned words; supports `keyword\|score` for custom weights |
| `bannedWordScoreThreshold` | `70` | Score threshold for banned words (shared with strong keywords) |
| `strongKeywords` | `[]` | Strong keywords: match triggers moderation and **ignores allowlist exemptions**; supports `keyword\|score` |
| `groupRules` | `[]` | Per-group overrides (banned words, strong keywords, allowlist keywords, AI toggles, auto-punishment thresholds) |
| `enableJoinRequestReview` | `true` | Whether to enable join review |
| `enableAiReply` | `false` | Master switch for AI replies (pair with `aiReplyRequireGroupRule` to enable per group) |
| `dryRun` | `false` | Dry-run mode: log planned actions without executing them |

### Data files

All stored in the Koishi data directory (`ctx.baseDir`), readable and editable through the
console Explorer:

| File | Contents |
| --- | --- |
| `Memory.md` | Memory store, entries separated by `---` |
| `banMember_<groupId>.md` | Per-group blacklist, `## QQ · note` plus join time |
| `JoinRequests.md` | Pending join requests (human-readable table + machine-readable section); restored on restart, expired entries cleaned up automatically |

### Permission model

Moderation commands (`[mute]` `[unmute]` `[kick]` `[ban]` `[unban]` `[banlist]`) use
**two-step authorization**:

1. **Actor identity** — passes if the sender is in `allowedUserIds`; otherwise they must be
   the group owner (`allowGroupOwner`) or a group admin (`allowGroupAdmin`).
2. **Execution capability** — when `requireBotOwnerForAdmin` is on, the bot must itself be
   owner or admin in that group.

Both steps must pass. Authorization details and command results are written to logs only and
are never echoed into the group.

## License

MIT

---

📖 **完整文档请前往 GitHub / Full documentation on GitHub:**
<https://github.com/Miseat/koishi-plugin-qq-group-manager#readme>

- 🐛 Issues / 问题反馈：<https://github.com/Miseat/koishi-plugin-qq-group-manager/issues>
- 📦 npm：<https://www.npmjs.com/package/@nestim/koishi-plugin-qq-group-manager>
- 📝 更新日志 / Changelog：[CHANGELOG.md](https://github.com/Miseat/koishi-plugin-qq-group-manager/blob/master/CHANGELOG.md)
