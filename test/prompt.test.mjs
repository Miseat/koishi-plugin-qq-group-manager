import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildReplyPrompt, PASS_TOKEN } = require('../lib/ai/prompt.js');

function rec(overrides) {
  return {
    id: 'x',
    userId: '1',
    name: '群友',
    role: 'member',
    text: '内容',
    images: [],
    mentions: [],
    self: false,
    at: Date.now(),
    ...overrides,
  };
}

function input(overrides = {}) {
  const current = rec({ id: 'cur', userId: '2', name: '冬木', role: 'admin', text: '明天几点开会？', at: Date.now() });
  return {
    selfName: 'MeowBot',
    persona: '你是群友。',
    groupId: '1103369527',
    records: [
      rec({ id: 'a', userId: '3', name: '段云翔', text: '借号这种事', at: Date.now() - 60_000 }),
      rec({ id: 'b', userId: '4', name: '小明', text: '哈哈哈', at: Date.now() - 30_000 }),
      current,
    ],
    current,
    mention: false,
    followup: false,
    allowPass: true,
    memories: [],
    maxReplyChars: 80,
    ...overrides,
  };
}

test('上下文严格按时间顺序，当前消息只出现一次', () => {
  const { user } = buildReplyPrompt(input());
  const idxA = user.indexOf('借号这种事');
  const idxB = user.indexOf('哈哈哈');
  const idxCur = user.indexOf('明天几点开会');
  assert.ok(idxA >= 0 && idxB > idxA && idxCur > idxB, '消息顺序应保持时间序');
  assert.equal(user.split('明天几点开会').length - 1, 1, '当前消息不应重复出现');
  assert.match(user, /【当前消息】/);
  assert.doesNotMatch(user, /SELECTED_TARGET|不要优先回复最后一条|不要回复最后一条/);
});

test('群名片与角色会出现在提示词里', () => {
  const { user } = buildReplyPrompt(input());
  assert.match(user, /冬木\(管理员\)/);
  assert.match(user, /段云翔\(成员\)/);
});

test('引用内容以「回复 某某」形式出现', () => {
  const current = rec({
    id: 'cur2',
    name: '冬木',
    text: '这个呢',
    quote: { userId: '3', name: '段云翔', text: '账号还是自己养吧' },
  });
  const { user } = buildReplyPrompt(input({ current, records: [current] }));
  assert.match(user, /「回复 段云翔：账号还是自己养吧」/);
});

test('机器人自己的历史发言显示为「你」', () => {
  const current = rec({ id: 'cur3', text: '你刚才说什么？' });
  const self = rec({ id: 's1', name: 'MeowBot', self: true, text: '我说的是明天下午' });
  const { user } = buildReplyPrompt(input({ current, records: [self, current] }));
  assert.match(user, /MeowBot\(你\): 我说的是明天下午/);
});

test('允许 pass 时系统提示包含 pass 规则，点名时不包含', () => {
  const passPrompt = buildReplyPrompt(input({ allowPass: true }));
  assert.match(passPrompt.system, new RegExp(PASS_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(passPrompt.user, /不该接话/);

  const mentionPrompt = buildReplyPrompt(input({ allowPass: false, mention: true }));
  assert.match(mentionPrompt.system, /必须回应/);
  assert.doesNotMatch(mentionPrompt.system, /只输出 <pass\/>/);
});

test('记忆只在传入时出现，并明确允许忽略', () => {
  const without = buildReplyPrompt(input());
  assert.doesNotMatch(without.user, /记忆/);

  const withMemory = buildReplyPrompt(input({ memories: ['例会每周一 19:00'] }));
  assert.match(withMemory.user, /【可能相关的记忆】/);
  assert.match(withMemory.user, /不相关就必须忽略/);
});

test('外部风格段插在规则之后、pass 规则之前', () => {
  const { system } = buildReplyPrompt(input({ styleSections: ['STYLE_MARKER'] }));
  assert.match(system, /【说话风格】/);
  assert.match(system, /STYLE_MARKER/);
  assert.ok(system.indexOf('STYLE_MARKER') < system.indexOf('<pass/>'), 'pass 规则应在风格段之后');
  assert.match(system, /与上面的规则冲突时，以上面的规则为准/);
});
