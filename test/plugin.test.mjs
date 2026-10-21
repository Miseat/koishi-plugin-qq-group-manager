import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Context } = require('koishi');
const plugin = require('../lib/index.js');
const { QQGroupManagerService } = require('../lib/service.js');

const baseConfig = {
  platformFilter: ['onebot'],
  command: '[bot]',
  enableAiReply: false,
  groupRules: [],
  aiAgentName: 'MeowBot',
  enableMemory: true,
  memoryInAi: true,
};

test('服务可以实例化，AI 引擎已挂载', () => {
  const app = new Context();
  const service = new QQGroupManagerService(app, baseConfig);
  assert.ok(service.ai, 'AI 引擎应完成实例化');
  assert.equal(typeof service.ai.record, 'function');
  assert.equal(typeof service.ai.handle, 'function');
  assert.equal(typeof service.sendReply, 'function');
  assert.ok(service.aiHooks, '应暴露 aiHooks 扩展点');
  assert.equal(service.aiHooks.version, 1);
  assert.equal(typeof service.aiHooks.registerPromptSection, 'function');
  assert.equal(typeof service.aiHooks.registerOutputFilter, 'function');
  assert.ok(app.get('qqgmAiHooks'), '扩展点应挂到 root 供兄弟插件 inject');
  assert.equal(app.get('qqgmAiHooks'), service.aiHooks);
  assert.ok(app.get('qqgmAiRuntime'), '私聊插件所需的运行时应挂到 root');
  assert.equal(app.get('qqgmAiRuntime').hooks, service.aiHooks);
  assert.equal(typeof app.get('qqgmAiRuntime').chat, 'function');
  assert.ok(app.get('qqgmAiRuntime').config);
});

test('插件 apply 不抛错', () => {
  const app = new Context();
  assert.doesNotThrow(() => plugin.apply(app, baseConfig));
});

test('新配置项有合理默认值', () => {
  const config = plugin.Config(baseConfig);
  assert.equal(config.aiReplyDecision, 'single');
  assert.equal(config.aiMaxReplyChars, 120);
  assert.equal(config.aiContextWindow, 30);
  assert.equal(config.aiImageBudgetMs, 6000);
  assert.equal(config.aiRequestTimeoutSeconds, 20);
  assert.equal(config.aiDebugPrompt, false);
});

test('群名片优先于 QQ 昵称与 username', () => {
  const app = new Context();
  const service = new QQGroupManagerService(app, baseConfig);
  const name = service.getDisplayName({
    author: { nick: '群名片', name: 'QQ昵称' },
    username: 'qq-nick',
    userId: '10001',
  });
  assert.equal(name, '群名片');
});
