import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderMessage } = require('../lib/core/text.js');

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

test('渲染 @、图片、表情，并保留 @ 目标', async () => {
  const s = session({
    elements: [
      { type: 'at', attrs: { id: '320557068' } },
      { type: 'text', attrs: { content: ' 看这个' } },
      { type: 'image', attrs: { url: 'https://example.com/a.png', file: 'a.png' } },
      { type: 'face', attrs: { id: '0', name: '惊讶' } },
    ],
  });
  const out = await renderMessage(s, noNames);
  assert.match(out.text, /@名字320557068/);
  assert.match(out.text, /看这个/);
  assert.match(out.text, /\[图片\]/);
  assert.match(out.text, /\[表情\]/);
  assert.equal(out.images.length, 1);
  assert.deepEqual(out.mentions, ['320557068']);
  assert.equal(out.atBot, false);
});

test('@bot 渲染为 @你，且不进入 mentions', async () => {
  const s = session({
    elements: [
      { type: 'at', attrs: { id: '3080427057' } },
      { type: 'text', attrs: { content: ' 在吗' } },
    ],
  });
  const out = await renderMessage(s, noNames);
  assert.match(out.text, /@你/);
  assert.deepEqual(out.mentions, []);
  assert.equal(out.atBot, true);
});

test('引用消息会结构化返回', async () => {
  const s = session({
    elements: [{ type: 'text', attrs: { content: '这个呢' } }],
    quote: {
      content: '明天下午三点开会，别忘了',
      user: { id: '320557068', name: '小明' },
    },
  });
  const out = await renderMessage(s, noNames);
  assert.equal(out.text, '这个呢');
  assert.equal(out.quote.name, '小明');
  assert.match(out.quote.text, /明天下午三点开会/);
});

test('没有 elements 时从 CQ 码兜底', async () => {
  const s = session({
    content: '[CQ:at,qq=320557068] 看 [CQ:image,file=abc.jpg,url=https://example.com/b.jpg]',
    elements: [],
  });
  const out = await renderMessage(s, noNames);
  assert.match(out.text, /@名字320557068/);
  assert.match(out.text, /\[图片\]/);
  assert.equal(out.images.length, 1);
});

test('纯表情消息标记为 visualOnly', async () => {
  const s = session({ elements: [{ type: 'face', attrs: { id: '14' } }] });
  const out = await renderMessage(s, noNames);
  assert.equal(out.visualOnly, true);
  assert.match(out.text, /\[表情\]/);
});
