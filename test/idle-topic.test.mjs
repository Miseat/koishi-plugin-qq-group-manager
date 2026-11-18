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
    aiAgentName: '大肥鱼',
    aiSystemPrompt: '默认人设：群里的一条鱼。',
    aiContextWindow: 20,
    aiContextMaxChars: 0,
    aiMaxOutputChars: 120,
    aiMaxReplyChars: 80,
    aiMaxOutputTokens: 400,
    aiTemperature: 0.8,
    enableMemory: true,
    memoryInAi: true,
    memoryAutoLearn: false,
    aiIdleTopicWebSearch: false,
    aiWebSearchEnabled: false,
    ...overrides,
  };
}

function makeHost(config, memory = '') {
  return {
    config,
    logger: { info() {}, warn() {} },
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async () => {},
    readMemoryFile: async () => memory,
    memoryScopeOf: () => ({ kind: 'group', id: GROUP }),
  };
}

function record(text, at) {
  return {
    id: `r-${text}`,
    userId: '320557068',
    name: '🐭',
    role: 'owner',
    text,
    images: [],
    mentions: [],
    atBot: false,
    self: false,
    at,
  };
}

test('主动话题带当前时间/季节、最近上下文和相关记忆', async () => {
  const memory = [
    '## 2026/11/10 12:00:00 · 自动归纳 · 人物关系',
    '大嫂在玩绝区零，抽卡常出双金',
  ].join('\n');
  let captured = null;
  const provider = {
    chat: async (request) => {
      captured = request;
      return { ok: true, text: '绝区零新角色你们抽吗' };
    },
  };
  const engine = new AiEngine(makeHost(makeConfig(), memory), {
    provider,
    now: () => new Date('2026-01-15T10:00:00+08:00').getTime(),
  });
  try {
    const state = engine.state.get(`onebot:${GROUP}`);
    state.records.push(record('大嫂在玩绝区零，抽谁好', new Date('2026-01-15T09:58:00+08:00').getTime()));
    const text = await engine.idleTopic(GROUP);
    assert.equal(text, '绝区零新角色你们抽吗');
    assert.ok(captured, '应调用模型');
    assert.ok(captured.system.includes('2026年1月15日'), '应带日期');
    assert.ok(captured.system.includes('（冬）'), '应带季节');
    assert.ok(captured.system.includes('大嫂在玩绝区零，抽谁好'), '应带最近上下文');
    assert.ok(captured.system.includes('大嫂在玩绝区零'), '应带相关记忆');
    assert.ok(captured.system.includes('不要提与现在时间、季节不符'), '应有季节约束');
    assert.equal(captured.user, '现在发一条主动话题。');
  } finally {
    engine.dispose();
  }
});

test('没有上下文时主动话题不崩，并给出日期', async () => {
  let captured = null;
  const provider = {
    chat: async (request) => {
      captured = request;
      return { ok: true, text: '今天降温了，你们那边冷不冷' };
    },
  };
  const engine = new AiEngine(makeHost(makeConfig(), ''), {
    provider,
    now: () => new Date('2026-01-15T10:00:00+08:00').getTime(),
  });
  try {
    const text = await engine.idleTopic(GROUP);
    assert.ok(text);
    assert.ok(captured.system.includes('2026年1月15日'));
    assert.ok(!captured.system.includes('【最近聊天】'));
  } finally {
    engine.dispose();
  }
});
