import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { selectMemoryBlocks, splitMemoryBlocks, tokenizeForMatch } = require('../lib/ai/memory.js');

const MEMORY = `## 2026/9/4 · 用户 692400912
小爱是骚鸡

---

## 2026/9/7 · 用户 692400912
星野爱的悲惨身世只是挡箭牌，并不能掩盖她的行径。

---

## 2026/10/1 · 用户 1
学生会例会每周一 19:00 在办公楼 302 开`;

test('无关话题不会注入星野爱记忆', () => {
  const blocks = splitMemoryBlocks(MEMORY);
  const selected = selectMemoryBlocks(blocks, ['明天几点开会？', '在哪个教室']);
  assert.equal(selected.length, 0);
});

test('相关话题可以命中对应记忆', () => {
  const blocks = splitMemoryBlocks(MEMORY);
  const selected = selectMemoryBlocks(blocks, ['星野爱那事你怎么看']);
  assert.equal(selected.length, 1);
  assert.match(selected[0].text, /星野爱/);
});

test('例会问题命中例会记忆', () => {
  const blocks = splitMemoryBlocks(MEMORY);
  const selected = selectMemoryBlocks(blocks, ['例会几点开？', '学生会例会']);
  assert.ok(selected.some((item) => /例会/.test(item.text)));
  assert.ok(!selected.some((item) => /星野爱/.test(item.text)));
});

test('中文按二元组切分', () => {
  const tokens = tokenizeForMatch('明天开会');
  assert.ok(tokens.has('明天'));
  assert.ok(tokens.has('天开'));
  assert.ok(tokens.has('开会'));
});

test('空记忆库返回空', () => {
  assert.deepEqual(selectMemoryBlocks([], ['随便聊聊']), []);
});
