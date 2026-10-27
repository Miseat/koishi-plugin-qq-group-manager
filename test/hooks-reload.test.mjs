import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Context } = require('koishi');
const { QQGroupManagerService } = require('../lib/service.js');

const BASE = {
  platformFilter: ['onebot'],
  command: '[bot]',
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
  enableSelfGag: false,
  enableUnauthorizedMutePunish: false,
};

function buildService() {
  const app = new Context();
  const service = new QQGroupManagerService(app, { ...BASE });
  return { app, service };
}

test('主插件重载后，外部插件注册的钩子仍然生效', async () => {
  const first = buildService();
  const registry = first.service.aiHooks;
  let calls = 0;

  // 外部插件（meme / chat-style）在启动时注册一次，然后长期持有这个对象
  registry.registerPromptSection(() => {
    calls += 1;
    return '外部风格段';
  });
  assert.equal(first.app.root.get('qqgmAiHooks'), registry);

  // 模拟主插件在控制台单独重启：旧实例 dispose，新实例重新加载
  first.app.emit('dispose');
  const second = buildService();

  assert.equal(second.service.aiHooks, registry, '重载后必须复用同一个注册表');
  assert.equal(second.app.root.get('qqgmAiHooks'), registry, 'root 上暴露的仍是同一个对象');

  const sections = await second.service.aiHooks.collectSections({ groupId: '1', mode: 'reply' });
  assert.ok(sections.includes('外部风格段'), '外部钩子没有丢失');
  assert.equal(calls, 1);
});

test('旧实例晚于新实例 dispose 时，不会清掉新实例的运行时指针', async () => {
  const first = buildService();
  const facadeBefore = first.app.root.get('qqgmAiRuntime');
  assert.ok(facadeBefore, '运行时门面应已挂到 root');

  // 新实例先接管（真实重载中 dispose 与构造的先后顺序不固定）
  const second = buildService();
  const facadeAfter = second.app.root.get('qqgmAiRuntime');
  assert.equal(facadeAfter, facadeBefore, '门面对象本身必须稳定');

  first.app.emit('dispose');

  assert.equal(facadeAfter.current, second.service, '旧实例的 dispose 不能把指针清空');
  assert.equal(facadeAfter.config.enableAiReply, false);
  assert.equal(typeof facadeAfter.chat, 'function');
});
