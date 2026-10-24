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
    enableAiReply: true,
    aiReplyRequireGroupRule: false,
    groupRules: [],
    aiReplyMode: 'threshold',
    aiMessageThreshold: 1,
    aiRandomReplyProbability: 1,
    aiMinReplyIntervalSeconds: 0,
    aiContextWindow: 20,
    aiAgentName: 'bot',
    aiSystemPrompt: '你是群友。',
    aiTemperature: 0.8,
    aiMaxOutputTokens: 200,
    aiMaxReplyChars: 80,
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

function makeSession(sent, overrides = {}) {
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '320557068',
    messageId: `mid-${Math.random().toString(36).slice(2)}`,
    content: '在吗',
    elements: [{ type: 'text', attrs: { content: '在吗' } }],
    bot: { selfId: '3080427057' },
    timestamp: Date.now(),
    onebot: null,
    send: async (fragment) => {
      sent.push(JSON.stringify(fragment));
      return [];
    },
    ...overrides,
  };
}

test('always 模式一定带 quote', async () => {
  const service = new QQGroupManagerService(new Context(), config({ aiQuoteReplyMode: 'always' }));
  const sent = [];
  await service.sendReply(makeSession(sent), '好的');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /quote/);
});

test('never 模式不带 quote', async () => {
  const service = new QQGroupManagerService(new Context(), config({ aiQuoteReplyMode: 'never' }));
  const sent = [];
  await service.sendReply(makeSession(sent), '好的');
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /quote/);
});

test('random 模式在概率 0 时不引用，概率 1 时引用', async () => {
  for (const [probability, expectQuote] of [[0, false], [1, true]]) {
    const service = new QQGroupManagerService(new Context(), config({
      aiQuoteReplyMode: 'random',
      aiQuoteReplyProbability: probability,
    }));
    const sent = [];
    await service.sendReply(makeSession(sent), '好的');
    assert.equal(sent.length, 1);
    assert.equal(/quote/.test(sent[0]), expectQuote, `p=${probability}`);
  }
});
