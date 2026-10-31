import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../lib/ai/engine.js');

const GROUP = '1103369527';
const SELF = '3080427057';
const CLOCK = 1_700_000_000_000;

function makeConfig(overrides = {}) {
  return {
    platformFilter: ['onebot'],
    command: '[bot]',
    enableAiReply: false,
    groupRules: [],
    aiApiKey: 'sk-test',
    aiBaseUrl: 'https://api.deepseek.com',
    aiWebSearchEnabled: true,
    aiWebSearchMode: 'auto',
    aiWebSearchMaxResults: 3,
    aiWebSearchTimeoutMs: 1000,
    aiWebSearchMaxPerHour: 1,
    aiWebSearchCacheMinutes: 10,
    aiEnableImageRecognition: false,
    enableMemory: false,
    memoryAutoLearn: false,
    ...overrides,
  };
}

function makeHost(config) {
  return {
    config,
    logger: { info() {}, warn() {} },
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async () => {},
    readMemoryFile: async () => '',
  };
}

function record(text) {
  return {
    id: `r-${text}`,
    userId: '320557068',
    name: '冬木',
    role: 'member',
    text,
    images: [],
    mentions: [],
    atBot: false,
    self: false,
    at: CLOCK,
  };
}

function makeFetch(counter) {
  return async () => {
    counter.count += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: '标题', url: 'https://example.test/a', summary: '摘要', site_name: '站点', date: '2026-10-31' }],
      }),
    };
  };
}

test('同一 query 命中缓存时不消耗搜索配额（回归）', async () => {
  const counter = { count: 0 };
  const engine = new AiEngine(makeHost(makeConfig()), {
    now: () => CLOCK,
    fetchImpl: makeFetch(counter),
  });
  try {
    const session = { platform: 'onebot', guildId: GROUP, userId: '1' };
    const first = await engine.webSearch(record('今天有什么新闻'), session);
    assert.ok(first.includes('https://example.test/a'));

    // 同一 query 第二次：命中缓存，不应发请求、也不应被配额挡住
    const second = await engine.webSearch(record('今天有什么新闻'), session);
    assert.equal(second, first);
    assert.equal(counter.count, 1, '缓存命中不应再次请求搜索 API');

    // 换一个 query：配额 1 已经用完，应被限流
    const third = await engine.webSearch(record('最近有什么新闻'), session);
    assert.equal(third, '');
    assert.equal(counter.count, 1);
  } finally {
    engine.dispose();
  }
});
