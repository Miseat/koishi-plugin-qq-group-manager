import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseSummaryEntries,
  memoryBlockCategory,
  normalizeMemoryCategory,
  buildSummaryPrompt,
} = require('../lib/ai/learn.js');

test('归纳输出按「类别：内容」拆成多条', () => {
  const raw = [
    '人物关系：大嫂是群主，玩绝区零',
    '偏好立场：Demon 喜欢原神，常和 Nestim 争',
    '群内黑话：zmd 指终末地',
  ].join('\n');
  const entries = parseSummaryEntries(raw, 150);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((item) => item.category), ['人物关系', '偏好立场', '群内黑话']);
  assert.equal(entries[0].text, '大嫂是群主，玩绝区零');
});

test('没有类别前缀时归入其他，NONE 不产出', () => {
  const entries = parseSummaryEntries('群里最近在聊绝区零', 150);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].category, '其他');
  assert.deepEqual(parseSummaryEntries('NONE'), []);
});

test('旧记忆块没有分类时按其他处理，新块能读出分类', () => {
  const oldBlock = '## 2026/10/28 12:00:00 · 自动归纳\n旧内容';
  assert.equal(memoryBlockCategory(oldBlock), '其他');
  const newBlock = '## 2026/11/18 12:00:00 · 自动归纳 · 人物关系\n大嫂是群主';
  assert.equal(memoryBlockCategory(newBlock), '人物关系');
  assert.equal(normalizeMemoryCategory('黑话'), '群内黑话');
  assert.equal(normalizeMemoryCategory('不知道什么类'), '其他');
});

test('归纳提示词要求一条只写一类', () => {
  const prompt = buildSummaryPrompt([{ text: '聊天内容', name: '甲', self: false, at: 0 }], { kind: 'group' });
  assert.ok(prompt.system.includes('类别：内容'));
  assert.ok(prompt.system.includes('人物关系'));
  assert.ok(prompt.system.includes('一条记忆只写一个类别'));
});
