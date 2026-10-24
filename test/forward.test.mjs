import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderMessage } = require('../lib/core/text.js');
const { renderRecordLine } = require('../lib/ai/prompt.js');

function session(overrides = {}) {
  return {
    platform: 'onebot',
    guildId: '1103369527',
    userId: '320557068',
    messageId: 'm-1',
    content: '',
    elements: [],
    bot: { selfId: '3080427057' },
    timestamp: Date.now(),
    ...overrides,
  };
}

const noNames = async (qq) => `名字${qq}`;

test('合并转发元素会抽出 id', async () => {
  const out = await renderMessage(session({
    elements: [{ type: 'forward', attrs: { id: 'fw-123', summary: '群聊的聊天记录' } }],
  }), noNames);
  assert.match(out.text, /合并转发/);
  assert.equal(out.forwards.length, 1);
  assert.equal(out.forwards[0].id, 'fw-123');
});

test('CQ 码里的转发也能抽出 id', async () => {
  const out = await renderMessage(session({
    content: '[CQ:forward,id=fw-999]',
  }), noNames);
  assert.equal(out.forwards.length, 1);
  assert.equal(out.forwards[0].id, 'fw-999');
});

test('没有转发时 forwards 为空', async () => {
  const out = await renderMessage(session({
    elements: [{ type: 'text', attrs: { content: '普通消息' } }],
  }), noNames);
  assert.deepEqual(out.forwards, []);
});

test('prompt 里会渲染转发内容', () => {
  const line = renderRecordLine({
    id: 'm-1',
    userId: '1',
    name: '甲',
    text: ' [合并转发] ',
    images: [],
    mentions: [],
    atBot: false,
    self: false,
    at: Date.now(),
    forwardText: '乙: 第一条\n丙: 第二条',
  }, 'bot');
  assert.match(line, /转发内容/);
  assert.match(line, /乙: 第一条/);
});
