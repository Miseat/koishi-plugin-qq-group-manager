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
| **AI 群聊回复** | 三道闸门逐层收敛：①消息阈值 ②随机概率 ③兴趣评分，任一不过都不回复、也不调用模型；`@点名` 可越过全部闸门。多人格、点名后话题跟随、上下文窗口、温度与输出上限 |
| **AI 识图** | 图片下载转 data URL 后送入模型，兼容 CQ 码 / HTML `<img>` / 元素三种形态与表情包 |
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
| `dryRun` | `false` | 演练模式：只输出计划动作，不真正执行 |

## AI 回复与识图

- **接口**：`openai-compatible`（OpenAI 兼容 Chat Completions）与 `gemini`（原生 `generateContent`）两类。
- **触发**：三道闸门依序判定，任一不过都不回复，也不会产生模型调用：
  1. `aiMessageThreshold` 消息阈值（`threshold` / `hybrid`）——累计未达阈值不触发，计数器在成功回复后清零；
  2. `aiRandomReplyProbability` 随机概率（`random` / `hybrid`）——每条消息掷一次骰，未掷中直接跳过；
  3. `aiInterestMinScore` 兴趣评分——调模型给消息打分，达标才回复。

  `hybrid` 表示**两者都需满足**（先够消息数，再掷中概率）。消息中命中智能体自称或直接 `@bot` 时，
  越过上述全部闸门直接触发。
- **多人格**：`aiPersonas` 保存多套「自称 + 系统提示词」，用 `aiActivePersona` 切换。
- **兴趣判定**：`aiInterestModel` 可为这一步单独指定模型（留空沿用 `aiModel`）。
  兴趣判定只是二分类，用非推理的轻量模型可显著降低耗时与成本。
  `aiInterestMaxTokens`（默认 2048）控制其最大输出 token——**带思考的推理模型会先消耗
  reasoning token，额度太小会让正文为空、判定静默失效**。
- **识图**：开启 `aiEnableImageRecognition` 后，图片会下载并转为 data URL 再送入模型，
  不依赖模型侧访问 QQ 图链；兼容 CQ 码、HTML `<img>`、消息元素与表情包。

## 数据文件

均存放在 Koishi 数据目录（`ctx.baseDir`），可用控制台「探索器 Explorer」直接查看与编辑：

| 文件 | 内容 |
| --- | --- |
| `Memory.md` | 记忆库，条目之间以 `---` 分隔 |
| `banMember_<群号>.md` | 各群黑名单，`## QQ号 · 备注` + 加入时间 |
| `JoinRequests.md` | 待审入群申请（人类可读表格 + 机器可读区段），重启自动恢复、过期自动清理 |

## 权限模型

- `allowedUserIds` 命中即通过；
- 非白名单账号：在群聊中若为群主或群管理员可通过（可用 `allowGroupOwner` / `allowGroupAdmin` 关闭）；
- `requireBotOwnerForAdmin` 可要求 bot 本身是该群群主才放行管理动作；
- 白名单目标默认受禁言保护，`allowAdminBypassWhitelistMute` 决定群主/管理员能否绕过。

鉴权细节与指令执行结果只写日志，不回显到群聊。

## License

MIT
