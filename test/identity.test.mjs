import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildReplyPrompt } = require('../lib/ai/prompt.js');

function rec(overrides = {}) {
  return {
    id: 'r',
    userId: '1',
    name: '某人',
    role: 'unknown',
    text: '内容',
    images: [],
    mentions: [],
    atBot: false,
    self: false,
    at: Date.now(),
    ...overrides,
  };
}

function input(overrides = {}) {
  const current = rec({ id: 'cur', userId: '2', name: '冬木', role: 'admin', text: '在吗' });
  return {
    selfName: 'MeowBot',
    persona: '',
    groupId: '1103369527',
    records: [current],
    current,
    mention: false,
    followup: false,
    allowPass: true,
    memories: [],
    maxReplyChars: 80,
    ...overrides,
  };
}

test('发言者的 QQ 号出现在提示词里', () => {
  const { user } = buildReplyPrompt(input({
    records: [
      rec({ id: 'a', userId: '10001', name: '小明', text: '你好' }),
      rec({ id: 'cur', userId: '2', name: '冬木', role: 'admin', text: '在吗' }),
    ],
  }));
  assert.match(user, /小明\(成员#10001\)/);
  assert.match(user, /冬木\(管理员#2\)/);
});

test('昵称相同的两个用户靠 QQ 号区分', () => {
  const { user } = buildReplyPrompt(input({
    records: [
      rec({ id: 'a', userId: '111', name: '小明', text: '我是第一个小明' }),
      rec({ id: 'b', userId: '222', name: '小明', text: '我是第二个小明' }),
      rec({ id: 'cur', userId: '2', name: '冬木', text: '在吗' }),
    ],
  }));
  assert.match(user, /小明\(成员#111\)/, '第一个小明');
  assert.match(user, /小明\(成员#222\)/, '第二个小明');
});

test('机器人自己的发言带（你）和自己的 QQ 号', () => {
  const { user } = buildReplyPrompt(input({
    records: [
      rec({ id: 's', userId: '9999', name: 'MeowBot', self: true, text: '我说过' }),
      rec({ id: 'cur', userId: '2', name: '冬木', text: '在吗' }),
    ],
  }));
  assert.match(user, /MeowBot\(你#9999\)/);
});

test('另一个机器人不会被标成（你）', () => {
  const { user } = buildReplyPrompt(input({
    records: [
      rec({ id: 'other', userId: '8888', name: '别的bot', self: false, text: '我是另一个机器人' }),
      rec({ id: 'cur', userId: '2', name: '冬木', text: '在吗' }),
    ],
  }));
  assert.doesNotMatch(user, /别的bot\(你/);
  assert.match(user, /别的bot\(成员#8888\)/);
});

test('引用消息也带被引用者的 QQ 号', () => {
  const current = rec({
    id: 'cur',
    userId: '2',
    name: '冬木',
    text: '这个呢',
    quote: { userId: '333', name: '小明', text: '原话' },
  });
  const { user } = buildReplyPrompt(input({ current, records: [current] }));
  assert.match(user, /「回复 小明#333：原话」/);
});

test('系统提示明确要求不把 QQ 号写进回复', () => {
  const { system } = buildReplyPrompt(input());
  assert.match(system, /不要把 QQ 号写进你的回复/, '必须禁止输出 QQ 号');
  assert.match(system, /唯一身份标识/, '必须说明 #号 的作用');
});

test('系统提示要求区分自己和别人', () => {
  const { system } = buildReplyPrompt(input());
  assert.match(system, /标着（你）/, '应说明（你）的含义');
  assert.match(system, /不要把他们的发言当成自己说的/);
});

test('上下文抬头说明格式含义', () => {
  const { user } = buildReplyPrompt(input());
  assert.match(user, /昵称\(角色#QQ号\)/);
  assert.match(user, /昵称重复时靠 #号区分/);
});

test('缺少 userId 时不产生空 #号', () => {
  const { user } = buildReplyPrompt(input({
    records: [
      rec({ id: 'a', userId: '', name: '无号用户', text: '你好' }),
      rec({ id: 'cur', userId: '2', name: '冬木', text: '在吗' }),
    ],
  }));
  assert.doesNotMatch(user, /无号用户\([^)]*#\)/, '不应出现空的 #');
});
