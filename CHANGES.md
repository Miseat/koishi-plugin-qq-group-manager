# 变更说明（v0.1.0）

`@nestim/koishi-qq-group-manager` 群管插件：群管命令、权限校验、图片菜单、状态卡片、复读、AI 群聊回复、记忆库、识图与自动管控（禁言/踢人）。

## 1. 禁言（mute）指令解析优化

**修复的问题**：输入禁言时长时，时长经常被误判为“目标 QQ 号”。

原实现依赖 Koishi 参数顺序与 `number` 类型转换：`群管 mute <target:string> <minutes:number>`。
当 `@用户` 以独立消息元素到达（不进文本）、或时长带“分钟/小时/天”等单位、或用户把时长写在 QQ 前面时，数字会被塞进 `target` 槽位，导致把时长当成 QQ 号去禁言。

**新实现**（`service.parseMuteArguments`）从原始消息中智能解析，不再信任 Koishi 的位置参数：

- 目标优先取 `@`（同时兼容 `session.elements` 的 at 元素与文本中的 `[CQ:at,qq=...]`），其次取文本中的 QQ 号；
- 时长支持：`10`、`10分钟/10分/10min/10m`、`1小时/1时/1h`、`1天/1d`、`1周/1w`，也支持 `1.5小时` 等小数；
- 兼容“先时长后 QQ”的写法（`群管 mute 30 123456`），会通过群成员信息比对自动纠正目标；
- 目标缺失 / 时长缺失 / 时长无法识别时，返回带示例的明确提示，不再静默猜测；
- 时长上限 30 天（43200 分钟），超出按 30 天执行并在结果中注明（与原 OneBot 上限一致）。

命令子命令仍为 `群管 mute`，只是参数不再需要严格按 `<target> <分钟数>` 顺序与纯数字格式。

## 2. 新增自动管控：自动禁言 + 自动踢人（按违规次数）

**触发源**：沿用原有“消息管控”的违规判定——命中违禁词、卡片消息（json/xml）、合并转发（forward）。

**全局设置**（插件配置页新增「自动管控」分组）：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `enableAutoMute` | false | 启用自动禁言 |
| `autoMuteViolationThreshold` | 3 | 累计违规多少次触发禁言 |
| `autoMuteMinutes` | 10 | 自动禁言时长（分钟） |
| `enableAutoKick` | false | 启用自动踢人 |
| `autoKickViolationThreshold` | 5 | 累计违规多少次触发踢出 |
| `autoViolationWindowMinutes` | 60 | 违规计数滑动窗口（分钟） |

**按群单独设置**：在「消息管控」→ `groupRules` 为该群新增记录，填 `autoMuteEnabled` / `autoMuteThreshold` / `autoMuteMinutes` / `autoKickEnabled` / `autoKickThreshold` / `autoViolationWindowMinutes` 即可覆盖全局；留空则跟随全局。开启/关闭（是否启用）、违规几次禁言、禁言多久、违规几次踢出均可逐群配置。

**行为细节**：

- 窗口期内连续违规才累计，超时未违规则重新从 1 计数；
- 达到踢人线时优先执行自动踢出并清零计数（避免再触发禁言）；
- 白名单账号、群主、群管理员、bot 自身不计入违规计数、不会被自动禁言/踢出（消息撤回与违规提示仍按原逻辑执行）；
- 自动处理后若开启“违规群内提示”，会公告处理结果；所有判定写入插件日志（`[auto-moderation]`）；
- 自动禁言同样受 30 天上限约束；需要 OneBot `setGroupBan` / `setGroupKick` 接口（LLOneBot/NapCat 等均支持）。

## 3. 其他说明

- 包名保持 `@meowhuan/koishi-plugin-qq-group-manager` 不变（避免插件市场重复安装时冲突，且保留你在 Koishi 里已有的全部配置）；版本号升级为 `0.0.4`。
- 编译产物为 CommonJS（`lib/*.js`），与原版加载方式完全一致，无需安装额外依赖（peerDependencies 仍为 `koishi ^4.18.7`）。

## 安装方式（本地插件）

1. 在 Koishi 桌面端 / Web 控制台 →「插件配置」→ 添加插件 →「本地插件」；
2. 填写本插件文件夹路径：`D:\agent项目\qq-group-manager-enhanced`；
3. 启用后到插件配置页确认新增的「自动管控」分组，并在需要管控的群里配置 `groupRules` 覆盖项。

> 提示：Koishi 控制台要求本地插件目录中的 `package.json` 存在且 `main` 指向 `lib/index.js`（已满足）。

## 4. 记忆库功能（v0.0.4+，2026-09）

- 群内指令：`[记忆]+内容` 保存、`[记忆查询] 关键词`、`[记忆列表]`、`[记忆删除] 关键词`。
- 数据落盘到 `Memory.md`（默认在 Koishi 数据目录），每条记忆间用 `---` 分隔，带时间与用户。
- 可通过 Koishi 控制台「Explorer」直接查看/编辑 `Memory.md`。
- 开启 `memoryInAi` 后，AI 回复与识图时会注入相关记忆（关键词优先，未命中时退化为注入最近记忆，由模型判断相关性）。
- 配置项：`enableMemory` / `memoryFileName` / `memoryInAi`。

## 5. 识图增强与诊断（v0.0.4+，2026-09）

- 增强 `extractMessageImageUrls`：除 `http(s)` 外，也接受 `data:image/` 链接；多来源（CQ url/src、元素 url/src/attrs）。
- 新增 `群管 查图` 调试命令：显示当前消息识别到的图片数量、链接与原始字段。
- 发送图片并 `@bot`、但提取不到可发送链接时，写 `[img-debug]` 日志（含原始 CQ 与元素字段），便于排查 LLOneBot 是否只给 `file=`/`file_id`。

