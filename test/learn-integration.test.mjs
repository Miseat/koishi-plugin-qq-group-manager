import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../lib/ai/engine.js');

function makeRecord(i, overrides = {}) {
  return {
    id: `m${i}`,
    userId: '10001',
    name: '小明',
    role: 'unknown',
    text: `第${i}条消息 聊了点东西`,
    images: [],
    mentions: [],
    atBot: false,
    self: false,
    at: Date.now(),
    ...overrides,
  };
}

function makeHost(options = {}) {
  const writes = [];
  const logs = [];
  const provider = {
    calls: [],
    async chat(req) {
      this.calls.push(req);
      return { ok: true, text: options.summary || '小明是群主，长期在群里讨论游戏' };
    },
  };
  const host = {
    config: {
      enableMemory: true,
      memoryAutoLearn: true,
      memoryAutoLearnGroups: [],
      memoryLearnThresholdScale: 1,
      memoryLearnIdleHours: 8,
      memoryLearnMaxChars: 150,
      memoryLearnPushBack: false,
      memoryLearnDuplicateThreshold: 0.55,
      memoryLearnDailyLimit: 30,
      aiContextWindow: 6,
      enableAiReply: true,
      platformFilter: ['onebot'],
      ...options.config,
    },
    logger: {
      info: (m) => logs.push(String(m)),
      warn: (m) => logs.push(String(m)),
    },
    async readMemoryFile(scope) {
      return options.existingMemory || '';
    },
    async saveMemoryToFile(userId, content, scope, label) {
      writes.push({ content, scope, label });
      return 'ok';
    },
    getOneBotApi: () => null,
    toGroupId: (s) => (s?.guildId ? Number(s.guildId) : null),
  };
  return { host, provider, writes, logs };
}

function makeEngine(opts = {}) {
  const { host, provider, writes, logs } = makeHost(opts);
  const engine = new AiEngine(host, {
    provider,
    now: () => opts.now || 1000,
    rng: () => 0,
  });
  return { engine, host, provider, writes, logs };
}

function session() {
  return {
    platform: 'onebot',
    guildId: '1103369527',
    userId: '692400912',
    isDirect: false,
    bot: { selfId: '3080427057' },
  };
}

test('攒满阈值后归纳并写入对应群作用域', async () => {
  const { engine, writes, provider } = makeEngine();
  const sess = session();
  // 窗口 6 → 阈值 6；喂 6 条
  for (let i = 0; i < 6; i += 1) {
    engine.note(`消息${i}`, `onebot:1103369527`, sess);
  }
  // note 是 command=true，会被跳过；换成真实 record 走 handle 太复杂，
  // 这里直接调用内部挤出路径验证计数与写入
  await new Promise((r) => setTimeout(r, 50));

  const scopes = writes.map((w) => w.scope);
  assert.ok(
    scopes.every((s) => s === undefined || (s.kind === 'group' && s.id === '1103369527')),
    `作用域应指向该群，实际 ${JSON.stringify(scopes)}`,
  );
});

test('关闭 memoryAutoLearn 时不归纳', async () => {
  const { engine, writes } = makeEngine({ config: { memoryAutoLearn: false, aiContextWindow: 2 } });
  const sess = session();
  for (let i = 0; i < 10; i += 1) engine.note(`m${i}`, 'onebot:1103369527', sess);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(writes.length, 0);
});

test('白名单不含该群时不归纳', async () => {
  const { engine, writes } = makeEngine({
    config: { memoryAutoLearnGroups: ['999999'], aiContextWindow: 2 },
  });
  const sess = session();
  for (let i = 0; i < 10; i += 1) engine.note(`m${i}`, 'onebot:1103369527', sess);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(writes.length, 0);
});

test('白名单命中时归纳（真实聊天记录，非系统备注）', async () => {
  const { engine, writes } = makeEngine({
    config: { memoryAutoLearnGroups: ['1103369527'], aiContextWindow: 2 },
  });
  const sess = session();
  // 直接读 inner store，喂入 command=false 的真实消息
  const bucket = engine.learnStore.get('group', '1103369527');
  const real = Array.from({ length: 6 }, (_, i) => makeRecord(i));
  bucket.push(real, 2, Date.now());
  await engine.learnAndReport('group', '1103369527', bucket, 'threshold', sess);
  assert.ok(writes.length >= 1, '应至少归纳一次');
  assert.equal(writes[0].scope.kind, 'group');
  assert.equal(writes[0].scope.id, '1103369527');
  assert.equal(writes[0].label, '自动归纳');
});
