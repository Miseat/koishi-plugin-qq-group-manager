# 更新日志

本文件记录所有值得注意的变更。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 1.3.1

### 文档

- README 增加配套插件跳转：`@nestim/koishi-plugin-qqgm-chat-style`（聊天风格）与
  `@nestim/koishi-plugin-qqgm-meme`（表情包），以及两个可直接使用的聊天风格 skill
  （`northern-netizen-chat`、`naruto-mobile-chat`）。
- 明确标注**定时提醒内建在本插件**，无需额外安装。

## 1.3.0

### 新增

- **回复引用可随机化**：新增 `aiQuoteReplyMode`（`random` / `always` / `never`）与
  `aiQuoteReplyProbability`（默认 0.5）。不再强制每条回复都引用触发消息，
  更像正常群友插话。
- **读取合并转发**：`aiReadForwardMessage`（默认开）+ `aiForwardMaxNodes`（默认 20）。
  通过 OneBot `get_forward_msg` 拉取子消息，按“发言人: 内容”逐行注入上下文；
  适配器不支持或失败时降级为 `[合并转发]` 占位。

## 1.2.9

### 变更

- **移除 `puppeteer` 可选依赖**：插件自 1.0.0 起就是纯文本菜单，代码里没有任何浏览器调用，
  但 `inject.optional` 里一直留着 `puppeteer`，导致 Koishi 会连带加载 `koishi-plugin-puppeteer`
  及其 `puppeteer-core` / Chromium，白占内存。现已删除该声明。
- 升级后可以安全卸载 `koishi-plugin-puppeteer`（如果没有其他插件在用）。

## 1.2.8

### 修复

- 联网搜索 query 会去掉开头的 `@`、取真正的问题分句；`今天/最新` 类查询追加 `after:` 时间过滤，
  不再把“现在是几点几分，今天的大事件是什么”整句丢给搜索。
- “你会不会联网 / 你就不会搜索吗”这类能力询问不再触发搜索。
- 模型第一次回答说“不知道 / 记不清 / 搜不了”时，补一次搜索并重写最终回复
  （只在这种不确定的情况下多一次模型调用），解决“该搜却没搜”的问题。
- 修复聊天风格提示词里的“不要联网操作”与联网搜索冲突：模型不再说“我没法上网”。

## 1.2.7

### 新增

- **AI 联网搜索**：主插件在调用模型前按问题判断是否需要联网，调用 DeepSeek 原生 Search API
  （`/v1/tools/search`，复用现有 `aiApiKey` / `aiBaseUrl`），把结果以 `【联网搜索结果】` 注入提示词，
  模型一次回答。不需要第三方搜索 Key。
- 搜索失败、API 不支持（400/401/403/404）、超时、没结果时**自动回退**为普通模型调用，不影响回复。
- 新配置：`aiWebSearchEnabled`、`aiWebSearchMode`（auto/always/off）、`aiWebSearchMaxResults`、
  `aiWebSearchTimeoutMs`、`aiWebSearchMaxPerHour`、`aiWebSearchCacheMinutes`。

## 1.2.6

### 新增

- **定时提醒**：支持 `@bot 18:30提醒我吃饭`、`提醒我明天下午3点开会`、`10分钟后提醒我喝水`，
  也支持 `[bot] 提醒 18:30 吃饭`；到点会在群里 @ 对方。提醒落盘到
  `data/qqgm-reminders.json`，重启不丢；支持 `[bot] 提醒列表`、`[bot] 取消提醒 <id>`。
- **群空闲话题**：`aiIdleTopicMinutes`（默认 120，0=关闭）、`aiIdleTopicMinHour`、
  `aiIdleTopicMaxHour`、`aiIdleTopicCooldownMinutes`。群内长时间没人说话时主动抛一个话题，
  只在开启 AI 的群里生效。
- **被 @ 回复冷却**：`aiMentionCooldownSeconds`（默认 5 秒），连续 @ 不再每条都回。
- 默认自称改为 `bot`，删除 MeowBot 默认；`aiAgentName` 仍可在配置页修改。

### 修复

- **引用图片**：被引用的消息里有图时，图片会解析并送进视觉模型；引用消息只带
  `messageId` 时用 OneBot `get_msg` 回查，不再回“看不到图”。

## 1.2.5

### 新增

- **`aiHooks.registerAfterReply`**：文字回复发送并写入上下文后触发，参数带最终文本。
  用于追加表情包等“文字之后”的动作，保证先文字、后图片。
- **root 暴露 `qqgmAiRuntime`**：`{ config, hooks, chat }`。私聊等外部插件可以复用
  同一个模型 provider 与同一套 style/meme 扩展点，不必重复配置 API Key。

## 1.2.4

### 修复

- **识图：先发图、再单独 @ 机器人时图片丢失**。`collectImages` 原本只看当前消息和引用消息，
  当前消息只有文字时 `images=0`，机器人会回“图没刷出来”。
  现在当前消息没有图时，会回看最近 2 分钟内**同一用户**最近 1–2 条消息里的图
  （仍受 `aiImageMaxCount` 限制）；不回看其他用户的图，也不回看超过 2 分钟的图。
- 删除 1.2.3 诊断期临时加的 `[ai-image]` 日志。

## 1.2.3

### 修复

- **续聊（followup）触发过宽**：用户换话题后，像“操不会说话了”这种短句仍会被当成
  “接着上一轮说”，导致机器人追着自己的旧话题自说自话。
  现在必须满足“与上一轮有话题交集”或“明确追问词（展开/细说/然后/为什么…）”才续聊，
  否则直接清掉待续状态，按新消息重新判断。

## 1.2.2

### 修复

- **1.2.1 的 `aiHooks` 对兄弟插件不可达**：Koishi 的 `Service` 注册在插件 fork 作用域，
  外部插件 `inject: ['nestimQqGroupManager']` 拿不到，导致风格插件静默不生效。
  现在额外把扩展点挂到 root 的 `qqgmAiHooks`，外部插件 `inject: ['qqgmAiHooks']` 即可；
  `ctx.nestimQqGroupManager.aiHooks` 仍保留，供同进程直接访问。
- 配套的 `koishi-plugin-qqgm-chat-style` 改为注入 `qqgmAiHooks`。

## 1.2.1

> **本版新增外部插件接口 `aiHooks`。** 第三方 Koishi 插件可以给 AI 追加“说话风格”提示词，
> 并在发送前过滤/丢弃输出，不需要改主插件，也不需要发新版本。

### 新增

- **AI 扩展点 `aiHooks`（接口版本 1）**：外部 Koishi 插件可以在不改主插件代码的前提下
  追加“说话风格”提示词段，并在发送前过滤输出。
  - `registerPromptSection(fn)`：返回的文本会插入 system prompt 的【说话风格】段
    （位置在基础规则之后、`<pass/>` 规则之前），并声明“与系统规则冲突时以系统规则为准”。
  - `registerOutputFilter(fn)`：在清洗后、发送前依次执行；返回 `null` 表示丢弃这条回复
    （按 pass 处理）。
  - 钩子抛错会被隔离并记日志，不影响正常回复；取消注册函数在插件 dispose 时调用。
- 配套本地插件（不发布 npm）：`koishi-plugin-qqgm-chat-style`，用于加载
  `.skill/SKILL.md`（仅接受聊天风格类），并做限字数、限行数、删禁词等输出规范。

### 外部接口示例

```ts
export const inject = ['nestimQqGroupManager']

export function apply(ctx) {
  const hooks = ctx.nestimQqGroupManager.aiHooks
  if (!hooks) return

  const off1 = hooks.registerPromptSection(() => '说话短一点，别用“首先/其次”这类词')
  const off2 = hooks.registerOutputFilter((text) => text.replace(/首先/g, ''))

  ctx.on('dispose', () => {
    off1()
    off2()
  })
}
```

### 说明

- 无配置变更，旧版本行为不变；不安装风格插件时 `aiHooks` 只是空注册表。

## 1.2.0

### 重构：AI 回复管线

- **决策与生成合并为一次模型调用**。旧版先调一次「兴趣判定」决定值与不值，再调一次生成，
  两次判断的对象不同（前者看当前消息，后者让模型"从上下文里挑一条"），必然出现
  「判定说该回、生成却回了另一条」。现在由模型在回复时自行输出 `<pass/>` 放弃接话，
  「要不要回」和「回什么」是同一次判断。
- **上下文严格按时间顺序**。删除了按关键词重排上下文、`SELECTED_TARGET` 标记以及
  「不要优先回复最后一条」的指令——这三者是"答非所问"的直接来源。
- **引用与回答始终指向同一条**。旧版在阈值模式下回答的是某条旧消息，发送时却固定
  `quote` 当前最新消息，群里看到的是"引用了 A 却回答 B"。
- **机器人自己的发言进入上下文**。旧版直接过滤 self 消息，且 NapCat 默认不上报自己发的消息，
  导致它"说完就忘"。现在每次发送后把回复写回上下文，并以「你」标注。
- **引用消息正文进入上下文**。旧版只从引用里取图片，正文完全丢失；现在渲染为
  `「回复 张三：原文」` 前缀。
- **@ 目标不再被抹掉**。旧版用 `replace(/<[^>]+>/g,' ')` 把所有标签删掉，模型不知道"谁在叫谁"；
  现在 @ 渲染为群昵称，`@bot` 渲染为 `@你`。
- **群名片链路补全**：`sender.card` → `getGroupMemberInfo().card` → QQ 昵称 → QQ 号，
  按「群 + QQ」缓存 10 分钟；`author.nickname` 这个恒为 undefined 的死分支已移除。

### 修复：记忆污染

- **记忆只在真正相关时注入**。旧版用整句 `includes` 匹配，中文几乎永远匹配不到，
  于是每次 fallback 注入最近 6 条记忆，导致"不管聊什么都能扯回星野爱"。
  现在按中文二元组重叠打分，没有交集就一条都不给，并明确告诉模型"不相关必须忽略"。
- **删除把"自己上一条回复"当作"当前群话题"的逻辑**——它会让话题偏移后一路偏下去。

### 性能

- **图片并发解析 + 总预算**（`aiImageBudgetMs`，默认 6 秒）。旧版串行下载，每张图 12 秒超时、
  多候选依次尝试，实测出现过 **63 秒**的回复延迟。超时/失败直接跳过，不再阻塞回复。
- **推理模型空正文自动重试**：`finish_reason=length` 且正文为空时，自动放大输出预算重试一次，
  避免"该回的消息不回"。
- **模型不支持图片时自动降级**：400/422 命中后记住结论，后续直接发纯文本，不再每次白跑一趟。
- 单条回复不再拆成最多 4 条发，`aiMaxReplyChars` 统一截断。

### 工程

- **新增 `src/` 源码工程与 `tsconfig.json`**。此前仓库只有 `lib/*.js` 编译产物，
  历史提交都是直接改生成代码；现在 `npm run build` 从 `src/` 重新生成 `lib/`。
- **新增测试**：`npm test` 覆盖消息渲染、群名片解析、提示词顺序/引用/记忆、触发闸门、
  记忆检索、图片降级、推理重试与端到端引擎行为（57 项）。
- **删除死代码**：`parseMuteArguments` / `extractMuteTokens` / `extractAtIds`（其中
  `extractAtIds` 读的是 `el.id` 而非 `el.attrs.id`，从未生效）、`isStickerElement`、
  `describeImageMessage` / `logImageDebug` 等约 1200 行。
- `.d.ts` 由 tsc 统一生成，修复了 `handleMemoryCommand` 等与实际实现不一致的漂移。

### 新增配置

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `aiReplyDecision` | `single` | `single` 一次调用（推荐）/ `two-stage` 两次调用 |
| `aiMaxReplyChars` | `120` | 单条回复最大字符数 |
| `aiImageBudgetMs` | `6000` | 图片解析总预算（毫秒） |
| `aiRequestTimeoutSeconds` | `20` | 单次模型请求超时 |
| `aiDebugPrompt` | `false` | 把最终提示词写入日志 |

## 1.1.4

### 文档

- **README 新增完整英文段落**（Features / Install / Commands / Configuration /
  Data files / Permission model）。此前文档全为中文，英文检索词下覆盖不足；
  补齐后 `koishi qq group manager` 一类的英文查询也能读到插件能力说明。
- **README 底部新增文档入口**，指向 GitHub 仓库、Issues、npm 与 CHANGELOG，
  便于在 npm 详情页底部直接跳转查看完整文档。

### 元数据

- **新增 `koishi.category: "manage"`**。此前插件在 Koishi 插件市场没有分类，
  影响市场内按分类浏览时的可发现性；`manage` 是群管类插件的主流分类。

### 说明

本版本**不含任何代码变更**，功能与 1.1.3 完全一致，仅更新文档与元数据。

## 1.1.3

### 修复

- **群管指令缺失操作者鉴权（严重）**。`[mute]` `[unmute]` `[kick]` `[ban]` `[unban]`
  此前只调用了 `canUseAdminCommand`（检查 **bot 是不是群主**），
  完全没有调用 `authorize`（检查 **谁在操作**）。由此产生两个方向的错误：

  1. **该放行的被拒**：配置里 `allowGroupOwner` / `allowGroupAdmin` / `allowedUserIds`
     对这几条指令完全失效。只要 bot 在该群不是群主（绝大多数情况，bot 通常只是管理员），
     即使是真正的群主或白名单账号也会被拒，提示「你没有权限执行该操作」。
  2. **不该放行的被放行（越权）**：反过来，当 bot 恰好是该群群主时，
     `canUseAdminCommand` 直接通过，而操作者身份从未被校验——
     **任何普通群成员都能执行 `[kick]` `[mute]` `[ban]`**。

  现在改为**两步鉴权**：先按 `allowedUserIds` / 群主 / 群管理员校验操作者，
  再校验 bot 的执行能力，两步都通过才放行。

- **`canUseAdminCommand` 不再要求 bot 必须是群主**。原先要求 bot 角色为 `owner`，
  而 bot 具备管理员身份就足以执行禁言/踢人。这正是上面第 1 类的直接原因。
  改为要求 `owner` 或 `admin`；配置项 `requireBotOwnerForAdmin` 保留原有键名，
  语义更新为「是否要求 bot 具备群主或管理员身份」。

- **`[banlist]` 补上权限校验**。此前任何人都能查看本群黑名单，与其他指令不一致。

### 影响

- 升级后，配置允许的群主 / 群管理员 / 白名单账号即可正常使用群管指令，
  不再要求 bot 本身是群主。
- **同时修复了一个越权漏洞**：若你的 bot 在某个群是群主，升级前任何成员都能踢人，
  建议尽快升级。
- 新增 17 项单元测试覆盖操作者身份、bot 能力、各角色判定矩阵与越权场景。

## 1.1.2

### 修复

- **兴趣判定静默失效（`finish_reason=length`）**。兴趣判定调用的 `max_tokens` 原先硬编码为
  `512`，而带思考的推理模型（如 `deepseek-flash`）会先消耗 reasoning token：
  512 的额度可能被推理全部吃掉，导致 `content` 为空、`finish_reason=length`，
  判定直接返回 `score=0 / 不回复`。

  实测 12 小时内触发 **13 次**，连「学习部的介绍好用心，想练文案的同学可以冲」这类
  明显该接话的消息也被静默拒绝。由于失败被当成「不回复」，界面上完全看不出来。

  现在默认额度提升到 **2048**，并可通过 `aiInterestMaxTokens` 调整（范围 256~16384）。
  失败日志也会带上额度与模型名，便于定位：

  ```
  [ai-interest] 判定返回空内容 finish=length reasoningTokens=512/2048 model=deepseek-flash
  ```

### 新增

- **`aiInterestModel`**：可为兴趣判定单独指定模型，留空则沿用 `aiModel`。
  兴趣判定只是二分类任务，指向非推理的轻量模型（如 `deepseek-chat`）可显著降低
  耗时与成本——这是本问题的根因规避方案。
- **`aiInterestMaxTokens`**：兴趣判定的最大输出 token，默认 `2048`。
  OpenAI 兼容路径写入 `max_tokens`，Gemini 路径写入 `maxOutputTokens`，两条路径同时生效。

## 1.1.1

### 修复

- **`aiRandomReplyProbability` 此前完全未生效**。该配置项只出现在 Schema 定义与类型声明中，
  `service.js` 从未读取它——无论填 `0`、`0.15` 还是 `1`，触发结果完全一致。现已真正接入。

### 变更

- **AI 回复改为三道闸门逐层判定**，任一不过都不回复，且不会产生后续的模型调用：

  | 闸门 | 配置项 | 生效模式 | 作用 |
  | --- | --- | --- | --- |
  | ① 消息阈值 | `aiMessageThreshold` | `threshold` / `hybrid` | 累计消息数未达阈值一律不触发 |
  | ② 随机概率 | `aiRandomReplyProbability` | `random` / `hybrid` | 每条消息掷一次骰，未掷中直接跳过 |
  | ③ 兴趣评分 | `aiInterestMinScore` | 非点名场景 | 调模型打分，达标才真正回复 |

- **`hybrid` 语义由「任一满足」改为「两者都需满足」**：先累计到阈值，再按概率掷中。
  此前 `hybrid` 在未达阈值时会无条件放行（返回 `interest-check`），等于阈值形同虚设。

- **兴趣判定闸门统一**：此前只对「兴趣判定」与「阈值触发」两条路径生效，
  现改为所有非点名触发（阈值 / 概率）都要过兴趣评分。
  `@点名` 与点名后跟随（followup）仍可越过全部三道闸门。

- 触发原因日志更明确：`below-threshold(n/N)`、`random-miss(p)`、`random-disabled`、
  `threshold(n/N)+random(p)`、`random(p)`，便于排查「为什么没回复」。

### 影响与调参提示

- 升级后 AI 回复频率会明显下降，`hybrid` 模式下尤其明显。
- **若配置中未设置 `aiRandomReplyProbability`，将回落到 Schema 默认值 `0.08`。**
  该值原先不起作用，升级后会立即生效，建议据此重新调参。
  想让 AI 更活跃可切到 `random` 模式并调高概率，或降低 `aiMessageThreshold`。
- 附带收益：未通过前两道闸门的消息不再触发兴趣判定模型调用，**API 调用量大幅下降**。

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
