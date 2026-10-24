import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Context } = require('koishi');
const { QQGroupManagerService } = require('../lib/service.js');

const GROUP = '1103369527';

function config(overrides = {}) {
  return {
    platformFilter: ['onebot'],
    command: '[bot]',
    cmdMute: '[mute]',
    cmdBan: '[ban]',
    cmdMemory: '[memory]',
    enableAiReply: true,
    aiReplyRequireGroupRule: false,
    groupRules: [],
    aiReplyMode: 'threshold',
    aiMessageThreshold: 1,
    aiRandomReplyProbability: 1,
    aiMinReplyIntervalSeconds: 0,
    aiContextWindow: 20,
    aiAgentName: 'MeowBot',
    aiSystemPrompt: '你是群友。',
    aiTemperature: 0.8,
    aiMaxOutputTokens: 200,
    aiMaxReplyChars: 80,
    aiQuoteReplyMode: 'always',
    aiQuoteReplyProbability: 1,
    aiEnableImageRecognition: false,
    aiImageMaxCount: 0,
    aiEnableFollowupAfterMention: false,
    aiReplyDecision: 'single',
    enableMemory: false,
    memoryInAi: false,
    enableBlacklist: false,
    allowedUserIds: [],
    ...overrides,
  };
}

function makeSession(text, sent) {
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '320557068',
    messageId: `mid-${Math.random().toString(36).slice(2)}`,
    content: text,
    elements: [{ type: 'text', attrs: { content: text } }],
    bot: { selfId: '3080427057' },
    timestamp: Date.now(),
    author: { nick: '冬木', name: 'qq-nick', roles: [{ id: 'admin' }] },
    onebot: null,
    send: async (fragment) => {
      sent.push(fragment);
      return [];
    },
  };
}

function flatten(fragment) {
  return JSON.stringify(fragment);
}

test('handleGroupModeration 走通：记录 → 判定 → 调用模型 → 发送', async () => {
  const app = new Context();
  const service = new QQGroupManagerService(app, config());
  const calls = [];
  service.ai.provider = {
    async chat(request) {
      calls.push(request);
      return { ok: true, text: '我觉得可以' };
    },
  };

  const sent = [];
  await service.handleGroupModeration(makeSession('这个方案你们怎么看', sent));

  assert.equal(calls.length, 1, '应调用一次模型');
  assert.equal(sent.length, 1, '应发送一条消息');
  const payload = flatten(sent[0]);
  assert.match(payload, /我觉得可以/);
  assert.match(payload, /quote/, '应引用当前消息');
});

test('指令消息不会被记录进 AI 上下文', async () => {
  const app = new Context();
  const service = new QQGroupManagerService(app, config({ aiMessageThreshold: 5 }));
  const calls = [];
  service.ai.provider = { async chat() { calls.push(1); return { ok: true, text: 'x' }; } };

  const sent = [];
  await service.handleGroupModeration(makeSession('[bot]', sent));
  await service.handleGroupModeration(makeSession('[Version]', sent));

  const state = service.ai.state.get(`onebot:${GROUP}`);
  assert.equal(state?.records.length ?? 0, 0, '指令不应进入上下文');
});

test('普通聊天即使被后续管控拦截，也应先进入上下文', async () => {
  const app = new Context();
  const service = new QQGroupManagerService(
    app,
    config({ aiMessageThreshold: 99, bannedWords: ['加群'], autoDeleteViolation: false, sendViolationNotice: false }),
  );
  const sent = [];
  await service.handleGroupModeration(makeSession('来加群啊', sent));

  const state = service.ai.state.get(`onebot:${GROUP}`);
  assert.equal(state.records.length, 1, '违禁消息也应进入上下文（先记录后管控）');
});
