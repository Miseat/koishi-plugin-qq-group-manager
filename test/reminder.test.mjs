import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseReminderText } = require('../lib/service.js');

const NOW = new Date('2026-10-23T12:00:00+08:00').getTime();
const at = (iso) => new Date(iso).getTime();

test('绝对时间：18:30 提醒我吃饭', () => {
  const parsed = parseReminderText('18:30提醒我吃饭', NOW);
  assert.ok(parsed);
  assert.equal(parsed.at, at('2026-10-23T18:30:00+08:00'));
  assert.equal(parsed.content, '吃饭');
});

test('绝对时间：明天下午3点开会', () => {
  const parsed = parseReminderText('提醒我明天下午3点开会', NOW);
  assert.ok(parsed);
  assert.equal(parsed.at, at('2026-10-24T15:00:00+08:00'));
  assert.equal(parsed.content, '开会');
});

test('相对时间：10分钟后喝水', () => {
  const parsed = parseReminderText('10分钟后提醒我喝水', NOW);
  assert.ok(parsed);
  assert.equal(parsed.at, NOW + 10 * 60000);
  assert.equal(parsed.content, '喝水');
});

test('相对时间：半小时后叫我', () => {
  const parsed = parseReminderText('半小时后叫我', NOW);
  assert.ok(parsed);
  assert.equal(parsed.at, NOW + 30 * 60000);
});

test('没有时间不拦截', () => {
  assert.equal(parseReminderText('提醒我一下', NOW), null);
});

test('今天已过的时间不安排', () => {
  const later = at('2026-10-23T19:00:00+08:00');
  assert.equal(parseReminderText('今天18:00提醒我', later), null);
});

test('[bot] 提醒 18:30 吃饭', () => {
  const parsed = parseReminderText('[bot] 提醒 18:30 吃饭', NOW);
  assert.ok(parsed);
  assert.equal(parsed.content, '吃饭');
});

test('明天早上8点，未写内容用默认文案', () => {
  const parsed = parseReminderText('提醒我明天早上8点', NOW);
  assert.ok(parsed);
  assert.equal(parsed.at, at('2026-10-24T08:00:00+08:00'));
  assert.match(parsed.content, /该做你之前说的事了/);
});
