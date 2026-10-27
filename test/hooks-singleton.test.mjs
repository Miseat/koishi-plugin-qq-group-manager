import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HOOKS = require.resolve('../lib/ai/hooks.js');
const RUNTIME = require.resolve('../lib/ai/runtime.js');

test('钩子注册表跨模块重载保持同一对象（主插件单独重启不丢外部钩子）', async () => {
  const registry = require(HOOKS).getSharedAiHooks();
  let hits = 0;
  const off = registry.registerPromptSection(() => {
    hits += 1;
    return '测试风格段';
  });

  // 清 require 缓存后重新加载，模拟主插件单独重载
  delete require.cache[HOOKS];
  const reloaded = require(HOOKS);
  const again = reloaded.getSharedAiHooks();

  assert.equal(again, registry, '重载后必须是同一个注册表实例');
  assert.equal(again.version, 2);

  const sections = await again.collectSections({ groupId: '1' });
  assert.deepEqual(sections, ['测试风格段']);
  assert.equal(hits, 1);
  off();
});

test('运行时门面重载后始终指向最新服务', async () => {
  delete require.cache[RUNTIME];
  const { getAiRuntimeFacade } = require(RUNTIME);
  const facade = getAiRuntimeFacade();

  const hooks = require(HOOKS).getSharedAiHooks();
  const oldService = {
    config: { aiAgentName: '旧实例' },
    ai: { hooks, chat: async () => ({ ok: true, text: '旧' }) },
  };
  const newService = {
    config: { aiAgentName: '新实例' },
    ai: { hooks, chat: async () => ({ ok: true, text: '新' }) },
  };

  facade.bind(oldService);
  assert.equal(facade.config.aiAgentName, '旧实例');

  // 新实例先 bind，旧实例的 dispose 后到：不能把新指针清掉
  facade.bind(newService);
  facade.unbind(oldService);
  assert.equal(facade.current, newService);
  assert.equal(facade.config.aiAgentName, '新实例');
  assert.equal((await facade.chat({ system: '', user: '' })).text, '新');

  // 新实例真正卸载后才允许清空
  facade.unbind(newService);
  assert.equal(facade.current, null);
  assert.equal(facade.hooks, hooks, '服务不在时仍返回共享注册表而不是 null');
  assert.equal((await facade.chat({ system: '', user: '' })).ok, false);
});
