/**
 * 用线上真实群消息回放 AI 提示词，人工检查"模型到底看到了什么"。
 *
 * 用法：
 *   node scripts/replay.mjs <probe.log> <群号> [条数]
 *
 * 说明：探针日志里没有群名片，这里用「群友+QQ后四位」代替；重点看
 * 消息顺序、@、引用、图片占位、记忆注入是否符合预期。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../lib/ai/engine.js');

const [, , logPath, groupIdArg, countArg] = process.argv;
if (!logPath || !groupIdArg) {
  console.error('usage: node scripts/replay.mjs <probe.log> <group-id> [count]');
  process.exit(1);
}
const groupId = String(groupIdArg);
const count = Math.max(1, Number(countArg) || 10);

const lines = readFileSync(logPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((item) => item && item.tag === 'message' && String(item.guildId) === groupId);

const picked = lines.slice(-count);
if (!picked.length) {
  console.error('no messages for group', groupId);
  process.exit(1);
}

const config = {
  platformFilter: ['onebot'],
  command: '[bot]',
  enableAiReply: true,
  aiReplyRequireGroupRule: false,
  groupRules: [],
  aiReplyMode: 'threshold',
  aiMessageThreshold: 1,
  aiRandomReplyProbability: 1,
  aiMinReplyIntervalSeconds: 0,
  aiContextWindow: 30,
  aiAgentName: 'MeowBot',
  aiSystemPrompt: '你是群友，说话自然，不要硬扯旧话题。',
  aiTemperature: 0.8,
  aiMaxOutputTokens: 300,
  aiMaxReplyChars: 80,
  aiEnableImageRecognition: true,
  aiImageMaxCount: 1,
  aiImageBudgetMs: 3000,
  aiEnableFollowupAfterMention: false,
  aiReplyDecision: 'single',
  aiDebugPrompt: false,
  enableMemory: true,
  memoryInAi: true,
};

const host = {
  config,
  logger: { info() {}, warn() {} },
  getOneBotApi: () => null,
  toGroupId: () => Number(groupId),
  extractImages: () => [],
  resolveImage: async () => '',
  sendReply: async () => {},
  readMemoryFile: async () =>
    '## 记忆\n星野爱的悲惨身世只是挡箭牌，不能洗白。\n\n---\n\n## 记忆\n学生会例会每周一 19:00 在办公楼 302 开。',
};

let lastRequest = null;
const provider = {
  async chat(request) {
    lastRequest = request;
    return { ok: true, text: '<pass/>' };
  },
};

const engine = new AiEngine(host, { provider });
let seq = 0;

for (const item of picked) {
  seq += 1;
  const session = {
    platform: 'onebot',
    guildId: groupId,
    userId: String(item.userId ?? '0'),
    messageId: String(item.messageId ?? `replay-${seq}`),
    content: String(item.content ?? ''),
    elements: Array.isArray(item.elements) ? item.elements : [],
    quote: item.hasQuote ? { content: item.quoteContent || '' } : undefined,
    bot: { selfId: '3080427057' },
    timestamp: item.t ? Date.parse(item.t) : Date.now(),
    author: {
      nick: `群友${String(item.userId ?? '0').slice(-4)}`,
      name: `qq${String(item.userId ?? '0').slice(-4)}`,
      roles: [{ id: 'member' }],
    },
  };
  await engine.handle(session);
}

if (!lastRequest) {
  console.log('没有触发任何模型调用');
  process.exit(0);
}
console.log('================ SYSTEM ================');
console.log(lastRequest.system);
console.log('================ USER ==================');
console.log(lastRequest.user);
console.log('=======================================');
