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
    aiMessageThreshold: 99,
    aiRandomReplyProbability: 1,
    aiMinReplyIntervalSeconds: 60,
    aiCooldownNotice: true,
    aiCooldownNoticeIntervalSeconds: 0,
    aiCooldownNoticeText: '还在冷却，{seconds} 秒后再叫我。',
    aiContextWindow: 20,
    aiAgentName: 'MeowBot',
    aiSystemPrompt: '你是群友。',
    aiActivePersona: '',
    aiPersonas: [],
    aiTemperature: 0.8,
    aiMaxOutputTokens: 200,
    aiMaxReplyChars: 80,
    aiEnableImageRecognition: false,
    aiImageMaxCount: 0,
    aiImageBudgetMs: 1000,
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.deepseek.com',
    aiWebSearchEnabled: false,
    aiEnableFollowupAfterMention: false,
    aiReplyDecision: 'single',
    aiDebugPrompt: false,
    enableMemory: false,
    ...overrides,
  };
}

function makeHost(config) {
  const sent = [];
  const notices = [];
  const host = {
    config,
    logger: { info() {}, warn() {} },
    sent,
    notices,
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async (session, text) => { sent.push(text); },
    sendNotice: async (session, text) => { notices.push(text); },
    readMemoryFile: async () => '',
  };
  return host;
}

let seq = 0;
function mention(clock, overrides = {}) {
  seq += 1;
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '320557068',
    messageId: `m-${seq}`,
    content: `<at id="${SELF}"/> 在吗`,
    elements: [
      { type: 'at', attrs: { id: SELF } },
      { type: 'text', attrs: { content: ' 在吗' } },
    ],
    bot: { selfId: SELF },
    timestamp: clock,
    author: { nick: '冬木', name: 'qq-nick', roles: [{ id: 'admin' }] },
    ...overrides,
  };
}

test('冷却中 @ 会提示剩余秒数，且不再调用模型', async () => {
  let clock = 1_000_000;
  const config = makeConfig();
  const host = makeHost(config);
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: '好的' }; } };
  const engine = new AiEngine(host, { provider, now: () => clock });
  try {
    await engine.handle(mention(clock));
    assert.equal(provider.calls, 1);
    assert.equal(host.sent.length, 1);

    clock += 5_000;
    await engine.handle(mention(clock));
    assert.equal(provider.calls, 1, '冷却内不得再次调用模型');
    assert.equal(host.notices.length, 1);
    assert.match(host.notices[0], /55 秒/);

    clock += 60_000;
    await engine.handle(mention(clock));
    assert.equal(provider.calls, 2, '冷却结束后恢复调用');
  } finally {
    engine.dispose();
  }
});

test('冷却提示按 aiCooldownNoticeIntervalSeconds 限流', async () => {
  let clock = 1_000_000;
  const config = makeConfig({ aiCooldownNoticeIntervalSeconds: 30 });
  const host = makeHost(config);
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: '好的' }; } };
  const engine = new AiEngine(host, { provider, now: () => clock });
  try {
    await engine.handle(mention(clock));
    clock += 3_000;
    await engine.handle(mention(clock));
    clock += 3_000;
    await engine.handle(mention(clock));
    assert.equal(host.notices.length, 1, '30 秒内只提示一次');
  } finally {
    engine.dispose();
  }
});

test('按群覆盖冷却：该群设为 0 时不受全局 60 秒限制', async () => {
  let clock = 1_000_000;
  const config = makeConfig({
    groupRules: [{ guildId: GROUP, enableAiReply: true, aiMinReplyIntervalSeconds: 0 }],
  });
  const host = makeHost(config);
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: '好的' }; } };
  const engine = new AiEngine(host, { provider, now: () => clock });
  try {
    await engine.handle(mention(clock));
    clock += 1_000;
    await engine.handle(mention(clock));
    assert.equal(provider.calls, 2);
    assert.equal(host.notices.length, 0);
  } finally {
    engine.dispose();
  }
});

test('按群覆盖阈值：该群阈值低于全局时按该群触发', async () => {
  let clock = 1_000_000;
  const config = makeConfig({
    aiMessageThreshold: 99,
    aiRandomReplyProbability: 1,
    aiMinReplyIntervalSeconds: 0,
    groupRules: [{ guildId: GROUP, enableAiReply: true, aiMessageThreshold: 2 }],
  });
  const host = makeHost(config);
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: '好的' }; } };
  const engine = new AiEngine(host, { provider, now: () => clock });
  try {
    const plain = (text) => {
      seq += 1;
      return {
        platform: 'onebot', guildId: GROUP, userId: '320557068', messageId: `m-${seq}`,
        content: text, elements: [{ type: 'text', attrs: { content: text } }],
        bot: { selfId: SELF }, timestamp: clock,
        author: { nick: '冬木', name: 'qq-nick', roles: [] },
      };
    };
    await engine.handle(plain('今天吃啥'));
    assert.equal(provider.calls, 0);
    clock += 1_000;
    await engine.handle(plain('随便聊聊'));
    assert.equal(provider.calls, 1, '该群阈值 2，第二条即触发');
  } finally {
    engine.dispose();
  }
});
