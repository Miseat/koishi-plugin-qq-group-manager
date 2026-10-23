import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  shouldWebSearch,
  buildSearchQuery,
  formatWebSearchSection,
  fetchWebSearch,
} = require('../lib/ai/websearch.js');

test('明显问题才触发搜索', () => {
  assert.equal(shouldWebSearch('搜一下今天的新闻'), true);
  assert.equal(shouldWebSearch('这人是谁'), true);
  assert.equal(shouldWebSearch('今天好累'), false);
  assert.equal(shouldWebSearch('在吗？'), false);
  assert.equal(shouldWebSearch('今天有什么新闻'), true);
});

test('off/always 模式', () => {
  assert.equal(shouldWebSearch('今天好累', 'off'), false);
  assert.equal(shouldWebSearch('今天好累', 'always'), true);
});

test('query 去掉搜索前缀并截断', () => {
  assert.equal(buildSearchQuery('搜一下今天的新闻'), '今天的新闻');
  assert.equal(buildSearchQuery('@bot 查一下 DeepSeek 最新消息').length <= 128, true);
});

test('搜索结果格式化为带编号的资料段', () => {
  const section = formatWebSearchSection([
    { title: '标题一', url: 'https://a.test/1', summary: '摘要一', siteName: '站点一', date: '2026-10-23T00:00:00Z' },
    { title: '标题二', url: 'https://a.test/2', summary: '摘要二', siteName: '站点二', date: '' },
  ], 5, 1800);
  assert.match(section, /【联网搜索结果】/);
  assert.match(section, /\[1\] 标题一/);
  assert.match(section, /\[2\] 标题二/);
  assert.match(section, /https:\/\/a\.test\/1/);
});

test('Search API 成功返回结果', async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          title: '测试标题',
          url: 'https://example.test/a',
          summary: '测试摘要',
          site_name: '测试站点',
          date: '2026-10-23T00:00:00Z',
        }],
      }),
    };
  };
  const out = await fetchWebSearch({
    query: '今天的新闻',
    apiKey: 'k',
    baseUrl: 'https://api.deepseek.com',
    maxResults: 3,
    timeoutMs: 1000,
  }, fakeFetch);
  assert.equal(out.ok, true);
  assert.match(out.section, /测试标题/);
  assert.match(seen.url, /\/v1\/tools\/search$/);
  assert.equal(JSON.parse(seen.init.body).count, 3);
});

test('404 时返回 ok:false，交给调用方回退', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const out = await fetchWebSearch({
    query: '今天新闻',
    apiKey: 'k',
    baseUrl: 'https://api.openai.com/v1',
    maxResults: 3,
    timeoutMs: 1000,
  }, fakeFetch);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'http-404');
});

test('没有 key 或没有结果都返回 ok:false', async () => {
  const noKey = await fetchWebSearch({
    query: 'q', apiKey: '', baseUrl: 'https://api.deepseek.com', maxResults: 3, timeoutMs: 1000,
  }, async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
  assert.equal(noKey.reason, 'no-key');

  const empty = await fetchWebSearch({
    query: 'q', apiKey: 'k', baseUrl: 'https://api.deepseek.com', maxResults: 3, timeoutMs: 1000,
  }, async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
  assert.equal(empty.reason, 'no-results');
});
