import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decideTrigger } = require('../lib/ai/trigger.js');
const { AiEngine } = require('../lib/ai/engine.js');

const GROUP = '1103369527';
const SELF = '3080427057';

const base = {
  mode: 'random',
  counter: 99,
  threshold: 1,
  probability: 0.1,
  now: 1_000_000,
  lastAttemptAt: 0,
  minIntervalMs: 0,
  inFlight: false,
  mention: false,
  followup: false,
  rng: () => 0.99,
  pseudoRandom: true,
  randomBoost: 0,
  pseudoRandomStep: 0.01,
};

test('未命中时按步长累加，命中后归零', () => {
  const miss = decideTrigger({ ...base });
  assert.equal(miss.fire, false);
  assert.equal(miss.effectiveProbability, 0.1);
  assert.equal(miss.nextBoost, 0.01);

  const hit = decideTrigger({ ...base, rng: () => 0.0 });
  assert.equal(hit.fire, true);
  assert.equal(hit.nextBoost, 0);
  assert.equal(hit.effectiveProbability, 0.1);
});

test('概率加成到 1 时必定触发，不再掷骰', () => {
  const result = decideTrigger({
    ...base,
    randomBoost: 0.95,
    rng: () => { throw new Error('不应再调用 rng'); },
  });
  assert.equal(result.fire, true);
  assert.equal(result.effectiveProbability, 1);
  assert.equal(result.nextBoost, 0);
});

test('关闭伪随机时加成不变，也不会逼近必定触发', () => {
  const result = decideTrigger({ ...base, pseudoRandom: false, randomBoost: 0.4 });
  assert.equal(result.fire, false);
  assert.equal(result.nextBoost, 0.4);
  assert.equal(result.effectiveProbability, 0.5);
});

test('概率为 0 但已有加成时仍可继续累计', () => {
  const result = decideTrigger({ ...base, probability: 0, randomBoost: 0.2, pseudoRandomStep: 0.1 });
  assert.equal(result.fire, false);
  assert.equal(result.effectiveProbability, 0.2);
  assert.equal(result.nextBoost, 0.3);
});

// ---------------------------------------------------------------- 引擎集成

function makeConfig(overrides = {}) {
  return {
    platformFilter: ['onebot'],
    command: '[bot]',
    enableAiReply: true,
    aiReplyRequireGroupRule: false,
    groupRules: [],
    aiReplyMode: 'random',
    aiMessageThreshold: 1,
    aiRandomReplyProbability: 0.1,
    aiPseudoRandom: true,
    aiPseudoRandomStep: 0.3,
    aiMinReplyIntervalSeconds: 0,
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
  return {
    config,
    logger: { info() {}, warn() {} },
    sent,
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async (_session, text) => { sent.push(text); },
    readMemoryFile: async () => '',
  };
}

let seq = 0;
function plain(clock, overrides = {}) {
  seq += 1;
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '320557068',
    messageId: `m-${seq}`,
    content: '随便聊聊',
    elements: [{ type: 'text', attrs: { content: '随便聊聊' } }],
    bot: { selfId: SELF },
    timestamp: clock,
    author: { nick: '冬木', name: 'qq-nick', roles: [] },
    ...overrides,
  };
}

test('引擎：连续未命中逐步抬升，到 1 时必定回复，之后归零', async () => {
  const config = makeConfig();
  const host = makeHost(config);
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: '好的' }; } };
  let clock = 1_000_000;
  const engine = new AiEngine(host, { provider, rng: () => 0.99, now: () => clock });
  try {
    // 0.1 → 0.4 → 0.7 都掷不中（rng 恒为 0.99）
    for (let i = 0; i < 3; i += 1) {
      await engine.handle(plain(clock));
      clock += 1_000;
    }
    assert.equal(provider.calls, 0, '前三次都不该调用模型');

    // 0.1 + 0.9 = 1.0，必定触发
    await engine.handle(plain(clock));
    assert.equal(provider.calls, 1, '加成到 1 时必定回复');

    // 命中后归零：下一条回到 0.1，仍然掷不中
    clock += 1_000;
    await engine.handle(plain(clock));
    assert.equal(provider.calls, 1, '触发后加成应归零');
  } finally {
    engine.dispose();
  }
});

test('引擎：按群覆盖伪随机步长', async () => {
  const config = makeConfig({
    aiPseudoRandomStep: 0.01,
    groupRules: [{ guildId: GROUP, enableAiReply: true, aiPseudoRandomStep: 0.5 }],
  });
  const host = makeHost(config);
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: '好的' }; } };
  let clock = 1_000_000;
  const engine = new AiEngine(host, { provider, rng: () => 0.99, now: () => clock });
  try {
    // 0.1 → 0.6 → 1.0
    await engine.handle(plain(clock));
    clock += 1_000;
    await engine.handle(plain(clock));
    assert.equal(provider.calls, 0);
    clock += 1_000;
    await engine.handle(plain(clock));
    assert.equal(provider.calls, 1, '该群步长 0.5，第三条即必定触发');
  } finally {
    engine.dispose();
  }
});

test('引擎：按群关闭伪随机后，长期摇不中也不会必定触发', async () => {
  const config = makeConfig({
    aiPseudoRandom: true,
    groupRules: [{ guildId: GROUP, enableAiReply: true, aiPseudoRandom: false }],
  });
  const host = makeHost(config);
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: '好的' }; } };
  let clock = 1_000_000;
  const engine = new AiEngine(host, { provider, rng: () => 0.99, now: () => clock });
  try {
    for (let i = 0; i < 20; i += 1) {
      await engine.handle(plain(clock));
      clock += 1_000;
    }
    assert.equal(provider.calls, 0);
  } finally {
    engine.dispose();
  }
});
