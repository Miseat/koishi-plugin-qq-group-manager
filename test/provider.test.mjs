import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ChatProvider } = require('../lib/ai/provider.js');

function config(overrides = {}) {
  return {
    aiProvider: 'openai-compatible',
    aiApiKey: 'sk-test',
    aiBaseUrl: 'https://api.example.com/v1',
    aiModel: 'test-model',
    aiTemperature: 0.8,
    aiMaxOutputTokens: 400,
    aiRequestTimeoutSeconds: 5,
    ...overrides,
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  };
}

test('图片被 400 拒绝时降级为纯文本，并记住模型不支持图片', async () => {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const hasImage = Array.isArray(body.messages[1].content);
    if (hasImage) {
      return response(400, { error: { message: 'image input is not supported by this model' } });
    }
    return response(200, { choices: [{ message: { content: '纯文本回复' }, finish_reason: 'stop' }] });
  };

  const provider = new ChatProvider(config(), { warn() {} });
  const first = await provider.chat({
    system: 's', user: 'u', images: ['data:image/png;base64,AAAA'],
  });
  assert.equal(first.ok, true);
  assert.equal(first.text, '纯文本回复');
  assert.equal(first.degradedToText, true);
  assert.equal(calls.length, 2);

  // 第二次请求应直接跳过图片
  const second = await provider.chat({
    system: 's', user: 'u', images: ['data:image/png;base64,AAAA'],
  });
  assert.equal(second.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(Array.isArray(calls[2].messages[1].content), false, '已确认不支持图片后应直接发纯文本');
});

test('推理模型输出被截断时自动放大预算重试', async () => {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.max_tokens < 1600) {
      return response(200, {
        choices: [{ message: { content: '', reasoning_content: '' }, finish_reason: 'length' }],
      });
    }
    return response(200, {
      choices: [{ message: { content: '终于出来了' }, finish_reason: 'stop' }],
    });
  };

  const provider = new ChatProvider(config(), { warn() {} });
  const result = await provider.chat({ system: 's', user: 'u', maxTokens: 400 });
  assert.equal(result.ok, true);
  assert.equal(result.text, '终于出来了');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].max_tokens >= 1600);

  // 之后再调用应该直接使用放大后的预算，不再重复"截断→重试"
  const again = await provider.chat({ system: 's', user: 'u', maxTokens: 400 });
  assert.equal(again.ok, true);
  assert.equal(calls.length, 3, '不应再产生一次额外的重试请求');
  assert.ok(calls[2].max_tokens >= 1600);
});

test('缺少 apiKey / model 时给出明确错误', async () => {
  const noKey = new ChatProvider(config({ aiApiKey: '' }), { warn() {} });
  assert.equal((await noKey.chat({ system: 's', user: 'u' })).ok, false);

  const noModel = new ChatProvider(config({ aiModel: '' }), { warn() {} });
  assert.equal((await noModel.chat({ system: 's', user: 'u' })).ok, false);
});

test('HTTP 错误信息会带回来', async () => {
  globalThis.fetch = async () => response(500, { error: { message: 'boom' } });
  const provider = new ChatProvider(config(), { warn() {} });
  const result = await provider.chat({ system: 's', user: 'u' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.match(result.error, /boom/);
});

test('透传 usage，并允许单次调用覆盖模型', async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return response(200, {
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 8, prompt_cache_hit_tokens: 100 },
    });
  };

  const provider = new ChatProvider(config(), { warn() {} });
  const overridden = await provider.chat({ system: 's', user: 'u', model: 'cheap-model' });
  assert.equal(overridden.ok, true);
  assert.equal(overridden.usage.prompt_tokens, 120);
  assert.equal(bodies[0].model, 'cheap-model');

  const fallback = await provider.chat({ system: 's', user: 'u' });
  assert.equal(bodies[1].model, 'test-model', '未指定时沿用 aiModel');
  assert.equal(fallback.usage.prompt_cache_hit_tokens, 100);
});

