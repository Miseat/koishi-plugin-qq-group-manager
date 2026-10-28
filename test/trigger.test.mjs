import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decideTrigger } = require('../lib/ai/trigger.js');

const base = {
  mode: 'threshold',
  counter: 0,
  threshold: 3,
  probability: 0,
  now: 1_000_000,
  lastAttemptAt: 0,
  minIntervalMs: 30_000,
  lastReplyAt: 0,
  mentionCooldownMs: 0,
  inFlight: false,
  mention: false,
  followup: false,
  rng: () => 0,
};

test('未达阈值不触发', () => {
  assert.equal(decideTrigger({ ...base, counter: 2 }).fire, false);
});

test('达到阈值触发', () => {
  assert.equal(decideTrigger({ ...base, counter: 3 }).fire, true);
});

test('冷却期内不触发，并返回剩余时间', () => {
  const result = decideTrigger({ ...base, counter: 10, now: 1_010_000, lastAttemptAt: 1_000_000 });
  assert.equal(result.fire, false);
  assert.equal(result.reason, 'cooldown');
  assert.equal(result.remainingMs, 20_000);
});

test('点名越过阈值，但同样受模型调用冷却限制', () => {
  const result = decideTrigger({
    ...base, counter: 0, now: 1_000_000, lastAttemptAt: 0, mention: true,
  });
  assert.equal(result.fire, true);
  assert.equal(result.forced, true);
  assert.equal(result.reason, 'direct-mention');
});

test('点名冷却内不触发，返回 cooldown-mention 与剩余秒数', () => {
  const result = decideTrigger({
    ...base,
    counter: 0,
    now: 1_010_000,
    lastAttemptAt: 1_000_000,
    mention: true,
  });
  assert.equal(result.fire, false);
  assert.equal(result.reason, 'cooldown-mention');
  assert.equal(result.remainingMs, 20_000);
});

test('点名后跟随同样受冷却限制', () => {
  const result = decideTrigger({
    ...base,
    counter: 99,
    now: 1_010_000,
    lastAttemptAt: 1_000_000,
    followup: true,
  });
  assert.equal(result.fire, false);
  assert.equal(result.remainingMs, 20_000);
});

test('随机模式未掷中不触发', () => {
  const result = decideTrigger({
    ...base, mode: 'random', probability: 0.25, rng: () => 0.9,
  });
  assert.equal(result.fire, false);
  assert.match(result.reason, /random-miss/);
});

test('混合模式需要阈值和概率同时满足', () => {
  assert.equal(decideTrigger({ ...base, mode: 'hybrid', counter: 2, probability: 1, rng: () => 0 }).fire, false);
  assert.equal(decideTrigger({ ...base, mode: 'hybrid', counter: 3, probability: 1, rng: () => 0 }).fire, true);
});

test('in-flight 时不重复调用', () => {
  assert.equal(decideTrigger({ ...base, inFlight: true, counter: 99 }).fire, false);
});
