import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Context } = require('koishi');
const { QQGroupManagerService } = require('../lib/service.js');

const GROUP = '1103369527';

const BASE = {
  platformFilter: ['onebot'],
  command: '[bot]',
  cmdMute: '[mute]',
  cmdUnmute: '[unmute]',
  cmdKick: '[kick]',
  cmdMemory: '[memory]',
  cmdBan: '[ban]',
  cmdUnban: '[unban]',
  cmdBanList: '[banlist]',
  cmdCustom: '[custom]',
  cmdVersion: '[Version]',
  groupRules: [],
  allowedUserIds: [],
  allowGroupOwner: true,
  allowGroupAdmin: true,
  requireBotOwnerForAdmin: false,
  bannedWords: [],
  strongKeywords: [],
  bannedWordScoreThreshold: 70,
  blockCardMessage: false,
  blockForwardMessage: false,
  autoDeleteViolation: false,
  sendViolationNotice: false,
  enableAutoMute: false,
  enableAutoKick: false,
  enableBlacklist: false,
  enableMemory: false,
  enableRepeater: false,
  enableAiReply: false,
  enableJoinRequestReview: false,
  customCommands: [],
  responseStyle: 'plain',
  logAuthCheck: false,
  logCommandResult: false,
};

function make(overrides = {}) {
  const app = new Context();
  return new QQGroupManagerService(app, { ...BASE, ...overrides });
}

function msg(content, overrides = {}) {
  const elements = overrides.elements ?? (content ? [{ type: 'text', attrs: { content } }] : []);
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '10001',
    messageId: `m-${Math.random().toString(36).slice(2)}`,
    content,
    elements,
    bot: { selfId: '3080427057' },
    author: { nick: '测试者', name: 'nick', roles: [{ id: 'member' }] },
    onebot: null,
    timestamp: Date.now(),
    send: async () => [],
    ...overrides,
  };
}

function flatten(value) {
  return JSON.stringify(value);
}

test('违禁词加权命中', async () => {
  const service = make({ bannedWords: ['加群|80'] });
  const session = msg('快来加群');
  const violation = await service.detectViolation(session, service.resolveModerationPolicy(session));
  assert.ok(violation);
  assert.equal(violation.type, 'banned-word');
  assert.ok(violation.assessment.total >= 70);
});

test('顺序子序列（模糊匹配）命中并标注非精确', async () => {
  const service = make({ bannedWords: ['领红包|100'] });
  const session = msg('领元红包');
  const violation = await service.detectViolation(session, service.resolveModerationPolicy(session));
  assert.ok(violation, '应命中模糊匹配');
  assert.equal(violation.assessment.evaluations[0].exact, false);
});

test('强关键词无视白名单，普通违禁词仍被白名单豁免', async () => {
  const service = make({
    groupRules: [{
      guildId: GROUP,
      bannedWords: ['加群|80'],
      whitelistKeywords: ['宣传部'],
      strongKeywords: ['有没有美女|70'],
      blockCardMessage: false,
      blockForwardMessage: false,
    }],
  });

  const strong = msg('宣传部 有没有美女');
  const strongViolation = await service.detectViolation(strong, service.resolveModerationPolicy(strong));
  assert.ok(strongViolation, '强关键词应无视白名单');
  assert.equal(strongViolation.strong, true);

  const normal = msg('宣传部 加群');
  assert.equal(await service.detectViolation(normal, service.resolveModerationPolicy(normal)), null);
});

test('卡片消息被拦截', async () => {
  const service = make({ blockCardMessage: true });
  const session = msg('<json data="{}"/>', { elements: [{ type: 'json', attrs: {} }] });
  const violation = await service.detectViolation(session, service.resolveModerationPolicy(session));
  assert.equal(violation.type, 'card');
});

test('纯表情消息不判违规', async () => {
  const service = make({ bannedWords: ['加群|80'] });
  const session = msg('<face id="0"/>', { elements: [{ type: 'face', attrs: { id: '0' } }] });
  assert.equal(await service.detectViolation(session, service.resolveModerationPolicy(session)), null);
});

test('授权：白名单账号直接通过', async () => {
  const service = make({ allowedUserIds: ['10001'] });
  const result = await service.authorize(msg('随便'));
  assert.equal(result.ok, true);
});

test('授权：群管理员通过，普通成员拒绝', async () => {
  const service = make({ allowGroupAdmin: true });
  const admin = await service.authorize(msg('x', { author: { nick: 'a', roles: [{ id: 'admin' }] } }));
  assert.equal(admin.ok, true);
  const member = await service.authorize(msg('x', { author: { nick: 'm', roles: [{ id: 'member' }] } }));
  assert.equal(member.ok, false);
});

test('指令路由：[bot] 菜单、[Version]、[custom]', async () => {
  const service = make();
  const menu = [];
  assert.equal(await service.routeBracketCommand(msg('[bot]', { send: async (f) => menu.push(f) })), true);
  assert.match(flatten(menu), /禁言/);

  const version = [];
  assert.equal(await service.routeBracketCommand(msg('[Version]', { send: async (f) => version.push(f) })), true);
  assert.match(flatten(version), /qq-group-manager/);

  const custom = [];
  assert.equal(await service.routeBracketCommand(msg('[custom]', { send: async (f) => custom.push(f) })), true);
  assert.match(flatten(custom), /目前还没有指令/);
});

test('复读：连续相同消息达到阈值后复读一次', async () => {
  const service = make({ enableRepeater: true, repeaterThreshold: 2, repeaterCooldownSeconds: 90 });
  const sent = [];
  const session = () => msg('哈哈哈', { send: async (f) => sent.push(f) });

  await service.handleRepeater(session());
  await service.handleRepeater(session());

  assert.equal(sent.length, 1, '第二次应触发复读');
  assert.match(flatten(sent[0]), /哈哈哈/);
});

test('黑名单 Markdown 序列化可往返', () => {
  const service = make();
  const text = service.serializeBlacklist([{ qq: '123456789', name: '捣乱的', at: '2026-10-17 20:00:00' }], GROUP);
  const parsed = service.parseBlacklist(text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].qq, '123456789');
  assert.equal(parsed[0].name, '捣乱的');
  assert.match(parsed[0].at, /2026-10-17/);
});
