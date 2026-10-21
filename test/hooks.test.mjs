import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiHookRegistry } = require('../lib/ai/hooks.js');

const ctx = { session: {}, groupId: '1', mode: 'reply' };

test('风格段按注册顺序收集，取消注册后不再出现', async () => {
  const hooks = new AiHookRegistry();
  const disposeA = hooks.registerPromptSection(() => 'A');
  hooks.registerPromptSection(async () => 'B');

  assert.deepEqual(await hooks.collectSections(ctx), ['A', 'B']);
  disposeA();
  assert.deepEqual(await hooks.collectSections(ctx), ['B']);
});

test('单个 provider 抛错不影响其它 provider', async () => {
  const hooks = new AiHookRegistry({ warn() {} });
  hooks.registerPromptSection(() => {
    throw new Error('boom');
  });
  hooks.registerPromptSection(() => 'ok');
  assert.deepEqual(await hooks.collectSections(ctx), ['ok']);
});

test('输出过滤器按顺序执行', async () => {
  const hooks = new AiHookRegistry();
  hooks.registerOutputFilter((text) => text.replace('a', 'b'));
  hooks.registerOutputFilter((text) => `${text}!`);
  assert.equal(await hooks.applyFilters('a', ctx), 'b!');
});

test('过滤器返回 null 表示丢弃本条', async () => {
  const hooks = new AiHookRegistry();
  hooks.registerOutputFilter(() => null);
  hooks.registerOutputFilter((text) => `${text}should-not-run`);
  assert.equal(await hooks.applyFilters('x', ctx), null);
});

test('过滤器抛错时保留当前文本并继续', async () => {
  const hooks = new AiHookRegistry({ warn() {} });
  hooks.registerOutputFilter(() => {
    throw new Error('boom');
  });
  hooks.registerOutputFilter((text) => `${text}~`);
  assert.equal(await hooks.applyFilters('x', ctx), 'x~');
});

test('接口版本为 1', () => {
  assert.equal(new AiHookRegistry().version, 1);
});

test('afterReply 按注册顺序执行，异常隔离', async () => {
  const hooks = new AiHookRegistry({ warn() {} });
  const calls = [];
  hooks.registerAfterReply((ctx) => { calls.push(`a:${ctx.text}`); });
  hooks.registerAfterReply(() => { throw new Error('boom'); });
  hooks.registerAfterReply(async (ctx) => { calls.push(`b:${ctx.text}`); });
  await hooks.runAfterReply({ session: {}, groupId: '1', mode: 'reply', text: 'hi' });
  assert.deepEqual(calls, ['a:hi', 'b:hi']);
});

test('afterReply 取消注册后不再执行', async () => {
  const hooks = new AiHookRegistry();
  let count = 0;
  const off = hooks.registerAfterReply(() => { count += 1; });
  await hooks.runAfterReply({ session: {}, groupId: '1', mode: 'reply', text: 'x' });
  off();
  await hooks.runAfterReply({ session: {}, groupId: '1', mode: 'reply', text: 'x' });
  assert.equal(count, 1);
});
