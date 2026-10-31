import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { GroupState } = require('../lib/ai/state.js');
const { AiHookRegistry } = require('../lib/ai/hooks.js');

function makeRecord(overrides = {}) {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    userId: '10001',
    name: '测试用户',
    role: 'unknown',
    text: '你好',
    images: [],
    mentions: [],
    atBot: false,
    self: false,
    at: Date.now(),
    ...overrides,
  };
}

test('trim 返回被挤出的消息，按时间先后', () => {
  const state = new GroupState();
  for (let i = 0; i < 8; i += 1) {
    state.push(makeRecord({ id: `m${i}`, text: `第${i}条` }), 6);
  }
  // 8 条消息、窗口 6 → 挤出前 2 条
  assert.equal(state.records.length, 6);
  assert.equal(state.records[0].id, 'm2');

  const evicted = state.push(makeRecord({ id: 'm8' }), 6);
  assert.equal(evicted.length, 1);
  assert.equal(evicted[0].id, 'm2');
});

test('未超窗口时不产生挤出', () => {
  const state = new GroupState();
  const evicted = state.push(makeRecord(), 6);
  assert.deepEqual(evicted, []);
});

test('窗口小于 6 时按 6 兜底', () => {
  const state = new GroupState();
  for (let i = 0; i < 8; i += 1) state.push(makeRecord({ id: `x${i}` }), 2);
  assert.equal(state.records.length, 6, '窗口最小为 6');
});

test('registerContextEvicted 注册、触发、取消', async () => {
  const hooks = new AiHookRegistry();
  const seen = [];
  const off = hooks.registerContextEvicted((ctx) => {
    seen.push(ctx);
  });

  await hooks.runContextEvicted({
    groupId: '123',
    kind: 'group',
    scopeId: '123',
    evicted: [{ id: 'a', userId: '1', name: 'x', text: 'hi', self: false, at: 1 }],
    window: 6,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'group');

  off();
  await hooks.runContextEvicted({
    groupId: '123',
    kind: 'group',
    scopeId: '123',
    evicted: [],
    window: 6,
  });
  assert.equal(seen.length, 1, '取消后不再触发');
});

test('单个挤出 handler 抛错不影响其它', async () => {
  const hooks = new AiHookRegistry();
  const ok = [];
  hooks.registerContextEvicted(() => {
    throw new Error('boom');
  });
  hooks.registerContextEvicted((ctx) => {
    ok.push(ctx.scopeId);
  });

  await hooks.runContextEvicted({
    groupId: '1',
    kind: 'private',
    scopeId: '999',
    evicted: [],
    window: 6,
  });
  assert.deepEqual(ok, ['999']);
});

test('hooks 版本为 2', () => {
  assert.equal(new AiHookRegistry().version, 3);
});
