import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../lib/ai/engine.js');

const GROUP = '1103369527';
const SELF = '3080427057';

function makeConfig(overrides = {}) {
  return {
    platformFilter: ['onebot'],
    command: '[bot]',
    enableAiReply: true,
    aiReplyRequireGroupRule: false,
    groupRules: [],
    aiReplyMode: 'threshold',
    aiMessageThreshold: 1,
    aiRandomReplyProbability: 1,
    aiPseudoRandom: false,
    aiMinReplyIntervalSeconds: 0,
    aiContextWindow: 20,
    aiAgentName: 'MeowBot',
    aiSystemPrompt: '你是群友。',
    aiActivePersona: '',
    aiPersonas: [],
    aiTemperature: 0.8,
    aiMaxOutputTokens: 1500,
    aiMaxReplyChars: 80,
    aiEnableImageRecognition: false,
    aiImageMaxCount: 0,
    aiImageBudgetMs: 1000,
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.deepseek.com',
    aiWebSearchEnabled: false,
    aiEnableFollowupAfterMention: false,
    aiDebugPrompt: false,
    enableMemory: false,
    ...overrides,
  };
}

function makeHost(config, logs) {
  return {
    config,
    logger: {
      info: (line) => logs.push(String(line)),
      warn: (line) => logs.push(`WARN ${String(line)}`),
    },
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async () => {},
    readMemoryFile: async () => '',
  };
}

let seq = 0;
function session() {
  seq += 1;
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '320557068',
    messageId: `m-${seq}`,
    content: '在吗',
    elements: [{ type: 'text', attrs: { content: '在吗' } }],
    bot: { selfId: SELF },
    timestamp: Date.now(),
    author: { nick: '冬木', name: 'qq-nick', roles: [] },
  };
}

test('日志里能区分 completion 总量与思考 token', async () => {
  const logs = [];
  const host = makeHost(makeConfig(), logs);
  const provider = {
    chat: async () => ({
      ok: true,
      text: '好的',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        prompt_cache_hit_tokens: 20,
        completion_tokens_details: { reasoning_tokens: 25 },
      },
    }),
  };
  const engine = new AiEngine(host, { provider, rng: () => 0 });
  try {
    await engine.handle(session());
    const line = logs.find((item) => item.includes('[ai-reply]') && item.includes('tokens='));
    assert.ok(line, '应输出带 tokens 的回复日志');
    assert.match(line, /in=100/);
    assert.match(line, /out=40/);
    assert.match(line, /cache=20/);
    assert.match(line, /reasoning=25/);
  } finally {
    engine.dispose();
  }
});

test('finish_reason=length 时输出截断告警', async () => {
  const logs = [];
  const host = makeHost(makeConfig({ aiMaxOutputTokens: 600 }), logs);
  const provider = {
    chat: async () => ({ ok: true, text: '被截断的回复', finishReason: 'length' }),
  };
  const engine = new AiEngine(host, { provider, rng: () => 0 });
  try {
    await engine.handle(session());
    const warning = logs.find((item) => item.includes('[ai-budget]'));
    assert.ok(warning, '触达 max_tokens 时应告警');
    assert.match(warning, /max_tokens=600/);
  } finally {
    engine.dispose();
  }
});
