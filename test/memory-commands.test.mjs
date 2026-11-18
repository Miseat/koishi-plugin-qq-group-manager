import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../lib/ai/engine.js');

const GROUP = '1103369527';
const SELF = '3080427057';

function makeConfig(overrides = {}) {
  return {
    platformFilter: ['onebot'],
    command: '[bot]',
    enableAiReply: false,
    aiAgentName: '大肥鱼',
    aiContextWindow: 20,
    enableMemory: true,
    memoryInAi: true,
    memoryAutoLearn: false,
    memoryLearnConsolidate: true,
    memoryLearnConsolidateEvery: 5,
    memoryLearnMaxEntries: 15,
    memoryLearnConsolidateMaxChars: 90,
    memoryLearnMaxChars: 150,
    memoryLearnDuplicateThreshold: 0.55,
    aiIdleTopicWebSearch: false,
    ...overrides,
  };
}

function makeHost(memory = '') {
  let current = memory;
  const commits = [];
  const host = {
    config: makeConfig(),
    logger: { info() {}, warn() {} },
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async () => {},
    readMemoryFile: async () => current,
    memoryScopeOf: () => ({ kind: 'group', id: GROUP }),
    saveMemoryToFile: async () => {},
    commitAutoMemory: async (scope, payload) => {
      commits.push(payload);
      const label = payload.label || '自动归纳';
      const block = `## 2026/11/18 12:00:00 · ${label}${payload.category ? ` · ${payload.category}` : ''}\n${payload.add}`;
      const blocks = current.trim()
        ? current.trim().split(/\n\s*---\s*\n/).map((item) => item.trim()).filter(Boolean)
        : [];
      const remove = new Set((payload.remove || []).map((item) => String(item).trim()));
      const kept = blocks.filter((item) => !remove.has(item));
      kept.push(block);
      current = `${kept.join('\n\n---\n\n')}\n`;
      return block;
    },
  };
  return { host, commits, getMemory: () => current };
}

function makeRecord(text, at = Date.now()) {
  return {
    id: `r-${text}`,
    userId: '320557068',
    name: '🐭',
    role: 'owner',
    text,
    images: [],
    mentions: [],
    atBot: false,
    self: false,
    at,
  };
}

function fakeProvider() {
  return {
    calls: [],
    async chat(request) {
      this.calls.push(request);
      if (String(request.system || '').includes('压缩')) {
        return { ok: true, text: '合并后的记忆' };
      }
      return { ok: true, text: '人物关系：测试关系' };
    },
  };
}

test('learnNow 优先消费待归纳桶，并写入分类', async () => {
  const { host, commits } = makeHost();
  const provider = fakeProvider();
  const engine = new AiEngine(host, { provider });
  try {
    const bucket = engine.learnStore.get('group', GROUP);
    bucket.push([makeRecord('甲和乙是同学')], 1, Date.now());
    const result = await engine.learnNow({ guildId: GROUP, userId: '1', platform: 'onebot' });
    assert.equal(result.ok, true);
    assert.equal(result.entries, 1);
    assert.equal(result.reason, 'bucket');
    assert.ok(result.text.includes('人物关系'));
    assert.equal(commits[0].category, '人物关系');
  } finally {
    engine.dispose();
  }
});

test('learnNow 没有待归纳桶时退化为最近上下文', async () => {
  const { host } = makeHost();
  const provider = fakeProvider();
  const engine = new AiEngine(host, { provider });
  try {
    const state = engine.state.get(`onebot:${GROUP}`);
    state.records.push(makeRecord('甲和乙是同学'));
    const result = await engine.learnNow({ guildId: GROUP, userId: '1', platform: 'onebot' });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'context');
    assert.equal(provider.calls.length, 1);
  } finally {
    engine.dispose();
  }
});

test('learnNow 完全没有消息时返回 empty', async () => {
  const { host } = makeHost();
  const engine = new AiEngine(host, { provider: fakeProvider() });
  try {
    const result = await engine.learnNow({ guildId: GROUP, userId: '1', platform: 'onebot' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'empty');
  } finally {
    engine.dispose();
  }
});

test('learnNow 模型失败时不丢待归纳消息', async () => {
  const { host } = makeHost();
  const provider = { chat: async () => ({ ok: false, error: 'model down' }) };
  const engine = new AiEngine(host, { provider });
  try {
    const bucket = engine.learnStore.get('group', GROUP);
    bucket.push([makeRecord('甲和乙是同学')], 1, Date.now());
    const result = await engine.learnNow({ guildId: GROUP, userId: '1', platform: 'onebot' });
    assert.equal(result.ok, false);
    assert.equal(bucket.records.length, 1, '失败后待归纳消息应保留');
  } finally {
    engine.dispose();
  }
});

test('organizeNow 只合并同分类的自动记忆，手动记忆保留', async () => {
  const memory = [
    '## 2026/11/17 10:00:00 · 自动归纳 · 人物关系',
    '大嫂玩绝区零',
    '',
    '---',
    '',
    '## 2026/11/17 11:00:00 · 自动归纳 · 人物关系',
    '大嫂抽卡常出双金',
    '',
    '---',
    '',
    '## 2026/11/17 12:00:00 · 用户 692400912',
    '手动记忆不要动',
  ].join('\n');
  const { host, commits, getMemory } = makeHost(memory);
  const provider = fakeProvider();
  const engine = new AiEngine(host, { provider });
  try {
    const result = await engine.organizeNow({ guildId: GROUP, userId: '1', platform: 'onebot' });
    assert.equal(result.ok, true);
    assert.equal(result.categories, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.after, 1);
    assert.equal(commits[0].category, '人物关系');
    assert.equal(commits[0].remove.length, 2);
    assert.ok(getMemory().includes('手动记忆不要动'), '手动记忆不能被删');
    assert.ok(getMemory().includes('合并后的记忆'));
  } finally {
    engine.dispose();
  }
});

test('organizeNow 没有同类可合并时返回 0 类', async () => {
  const memory = [
    '## 2026/11/17 10:00:00 · 自动归纳 · 人物关系',
    '只有一条',
  ].join('\n');
  const { host } = makeHost(memory);
  const engine = new AiEngine(host, { provider: fakeProvider() });
  try {
    const result = await engine.organizeNow({ guildId: GROUP, userId: '1', platform: 'onebot' });
    assert.equal(result.ok, true);
    assert.equal(result.categories, 0);
    assert.equal(result.after, 1);
  } finally {
    engine.dispose();
  }
});
