import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  LearnBucket,
  LearnStore,
  buildSummaryPrompt,
  cleanSummary,
  isDuplicate,
  similarityOf,
  MAX_SUMMARY_CHARS,
} = require('../lib/ai/learn.js');

test('累计到阈值触发', () => {
  const bucket = new LearnBucket();
  assert.equal(bucket.push([{ text: 'a' }], 3, 1000), false);
  assert.equal(bucket.push([{ text: 'b' }], 3, 1001), false);
  assert.equal(bucket.push([{ text: 'c' }], 3, 1002), true);
});

test('一次挤出多条也计入', () => {
  const bucket = new LearnBucket();
  assert.equal(bucket.push([{ text: 'a' }, { text: 'b' }, { text: 'c' }], 3, 1), true);
  assert.equal(bucket.size, 3);
});

test('drain 取走后清空', () => {
  const bucket = new LearnBucket();
  bucket.push([{ text: 'a' }], 99, 1);
  assert.equal(bucket.drain().length, 1);
  assert.equal(bucket.size, 0);
});

test('空闲判定：超时且有消息才触发', () => {
  const bucket = new LearnBucket();
  assert.equal(bucket.isIdle(99999, 1000), false, '没消息不触发');
  bucket.push([{ text: 'x' }], 99, 5000);
  assert.equal(bucket.isIdle(5500, 1000), false);
  assert.equal(bucket.isIdle(6500, 1000), true);
});

test('drain 后不再因空闲触发（8h 无新消息不空转）', () => {
  const bucket = new LearnBucket();
  bucket.push([{ text: 'x' }], 99, 1000);
  bucket.drain();
  assert.equal(bucket.isIdle(999999999, 1000), false);
});

test('LearnStore 按作用域隔离', () => {
  const store = new LearnStore();
  const g1 = store.get('group', '111');
  const g2 = store.get('group', '222');
  const p1 = store.get('private', '111');
  g1.push([{ text: 'a' }], 99, 1);
  assert.equal(g1.size, 1);
  assert.equal(g2.size, 0);
  assert.equal(p1.size, 0);
});

test('LearnStore.idleList 只返回超时的', () => {
  const store = new LearnStore();
  store.get('group', '111').push([{ text: 'a' }], 99, 1000);
  const list = store.idleList(3000, 1000);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'group');
  assert.equal(list[0].scopeId, '111');
});

test('提示词：群聊与私聊措辞不同，含字数与 NONE', () => {
  const g = buildSummaryPrompt([{ name: 'A', text: 'x' }], { kind: 'group' });
  const p = buildSummaryPrompt([{ name: 'A', text: 'x' }], { kind: 'private' });
  assert.match(g.system, /群聊记录/);
  assert.match(p.system, /私聊记录/);
  assert.match(g.system, new RegExp(`不超过 ${MAX_SUMMARY_CHARS} 字`));
  assert.match(g.system, /NONE/);
});

test('清洗：去引号、列表符号、代码块', () => {
  assert.equal(cleanSummary('「小明是群主」'), '小明是群主');
  assert.equal(cleanSummary('- 小明是群主'), '小明是群主');
  assert.equal(cleanSummary('1. 小明是群主'), '小明是群主');
  assert.equal(cleanSummary('```\n小明是群主\n```'), '小明是群主');
});

test('NONE 视为空', () => {
  assert.equal(cleanSummary('NONE'), '');
  assert.equal(cleanSummary('无'), '');
});

test('超长截断到上限内', () => {
  const long = '这是一个很长的记忆内容。'.repeat(30);
  const out = cleanSummary(long);
  assert.ok(out.length <= MAX_SUMMARY_CHARS + 1);
});

test('多行压平', () => {
  assert.equal(cleanSummary('小明是群主\n喜欢星野爱'), '小明是群主 喜欢星野爱');
});

test('去重：相同判重，不同不判重', () => {
  assert.equal(isDuplicate('小明是群主', ['小明是群主']), true);
  assert.equal(isDuplicate('小明是群主', ['群里在聊显卡']), false);
  assert.equal(isDuplicate('', ['x']), false);
});

test('相似度对称且 0~1', () => {
  const a = '你好世界';
  const b = '你好朋友';
  assert.equal(similarityOf(a, b).toFixed(4), similarityOf(b, a).toFixed(4));
});
