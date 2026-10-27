import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const p = require('../lib/service.js');
const Service = p.QQGroupManagerService || p.default;

function makeService(config = {}) {
  const svc = Object.create(Service.prototype);
  svc.config = { bannedWordScoreThreshold: 70, ...config };
  svc._logger = { info() {}, warn() {}, debug() {} };
  svc.violationRecords = new Map();
  return svc;
}

test('分值允许任意位数（回归：10000 曾解析失败）', () => {
  const svc = makeService();
  const cases = [
    ['zp|10000', 'zp', 100],
    ['zp|1000', 'zp', 100],
    ['zp|999', 'zp', 100],
    ['zp|100', 'zp', 100],
    ['zp|70', 'zp', 70],
    ['zp|40', 'zp', 40],
    ['zp|0', 'zp', 0],
  ];
  for (const [entry, keyword, score] of cases) {
    const n = svc.normalizeBannedWordEntry(entry);
    assert.equal(n.keyword, keyword, entry);
    assert.equal(n.score, score, entry);
  }
});

test('分值超过 100 会被夹到 100', () => {
  const svc = makeService();
  assert.equal(svc.normalizeBannedWordEntry('zp|999999').score, 100);
});

test('无分值回落默认 40', () => {
  const svc = makeService();
  assert.equal(svc.normalizeBannedWordEntry('zp').score, 40);
});

test('分隔符兼容：竖线/全角/逗号/冒号', () => {
  const svc = makeService();
  for (const sep of ['|', '｜', ',', '，', ':', '：']) {
    const n = svc.normalizeBannedWordEntry(`abc${sep}90`);
    assert.equal(n.keyword, 'abc', sep);
    assert.equal(n.score, 90, sep);
  }
});

test('zp|10000 精确命中达到阈值', () => {
  const svc = makeService();
  const r = svc.evaluateBannedWords('zp', { bannedWords: ['zp|10000'] });
  assert.equal(r.total, 100);
  assert.ok(r.total >= 70, '应触发管控');
});

test('高分值不误伤无关文本', () => {
  const svc = makeService();
  const policy = { bannedWords: ['zp|10000'] };
  for (const text of ['测试', '照片', '支付宝', '作品', '正常聊天']) {
    const r = svc.evaluateBannedWords(text, policy);
    assert.ok(r.total < 70, `「${text}」不应触发，实际 ${r.total}`);
  }
});

test('低分值时不到阈值不触发', () => {
  const svc = makeService({ bannedWordScoreThreshold: 70 });
  const r = svc.evaluateBannedWords('zp', { bannedWords: ['zp|40'] });
  assert.equal(r.total, 40);
  assert.ok(r.total < 70);
});

test('违规计数按窗口累计', () => {
  const svc = makeService();
  const policy = { violationWindowMinutes: 60 };
  const session = { guildId: '1', userId: '2' };
  assert.equal(svc.recordViolation(session, policy), 1);
  assert.equal(svc.recordViolation(session, policy), 2);
  assert.equal(svc.recordViolation(session, policy), 3);
});

test('不同用户/群独立计数', () => {
  const svc = makeService();
  const policy = { violationWindowMinutes: 60 };
  svc.recordViolation({ guildId: '1', userId: 'a' }, policy);
  svc.recordViolation({ guildId: '1', userId: 'a' }, policy);
  assert.equal(svc.recordViolation({ guildId: '1', userId: 'b' }, policy), 1);
  assert.equal(svc.recordViolation({ guildId: '2', userId: 'a' }, policy), 1);
});
