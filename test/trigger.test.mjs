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

test('冷却期内不触发', () => {
  const result = decideTrigger({ ...base, counter: 10, now: 1_010_000, lastAttemptAt: 1_000_000 });
  assert.equal(result.fire, false);
  assert.equal(result.reason, 'cooldown');
});

test('点名无视冷却与阈值', () => {
  const result = decideTrigger({
    ...base, counter: 0, now: 1_000, lastAttemptAt: 999_000, mention: true,
  });
  assert.equal(result.fire, true);
  assert.equal(result.forced, true);
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
