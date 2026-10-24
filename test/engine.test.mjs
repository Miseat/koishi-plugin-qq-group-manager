import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../lib/ai/engine.js');

const GROUP = '1103369527';

function makeConfig(overrides = {}) {
  return {
    platformFilter: ['onebot'],
    command: '[bot]',
    enableAiReply: true,
    aiReplyRequireGroupRule: false,
    groupRules: [],
    aiReplyMode: 'threshold',
    aiMessageThreshold: 3,
    aiRandomReplyProbability: 1,
    aiMinReplyIntervalSeconds: 0,
    aiContextWindow: 20,
    aiAgentName: 'MeowBot',
    aiSystemPrompt: '你是群友，说话自然。',
    aiActivePersona: '',
    aiPersonas: [],
    aiTemperature: 0.8,
    aiMaxOutputTokens: 200,
    aiMaxReplyChars: 80,
    aiEnableImageRecognition: false,
    aiImageMaxCount: 0,
    aiImageBudgetMs: 1000,
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.deepseek.com',
    aiWebSearchEnabled: false,
    aiWebSearchMode: 'auto',
    aiWebSearchMaxResults: 3,
    aiWebSearchTimeoutMs: 1000,
    aiWebSearchMaxPerHour: 10,
    aiWebSearchCacheMinutes: 10,
    aiEnableFollowupAfterMention: false,
    aiReplyDecision: 'single',
    aiDebugPrompt: false,
    enableMemory: true,
    memoryInAi: true,
    ...overrides,
  };
}

function makeHost(config, memoryText = '') {
  const sent = [];
  const host = {
    config,
    logger: { info() {}, warn() {} },
    sent,
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async (session, text) => {
      sent.push({ messageId: session.messageId, text });
    },
    readMemoryFile: async () => memoryText,
  };
  return host;
}

function makeProvider(reply = '好的') {
  return {
    calls: [],
    async chat(request) {
      this.calls.push(request);
      return { ok: true, text: typeof reply === 'function' ? reply(request) : reply };
    },
  };
}

let seq = 0;
function makeSession(overrides = {}) {
  seq += 1;
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '320557068',
    messageId: `m-${seq}`,
    content: '',
    elements: [],
    bot: { selfId: '3080427057' },
    timestamp: Date.now(),
    author: { nick: '冬木', name: 'qq-nick', roles: [{ id: 'admin' }] },
    ...overrides,
  };
}

function textSession(text, overrides = {}) {
  return makeSession({ content: text, elements: [{ type: 'text', attrs: { content: text } }], ...overrides });
}

function mentionSession(text, overrides = {}) {
  return makeSession({
    content: `<at id=\"3080427057\"/> ${text}`,
    elements: [
      { type: 'at', attrs: { id: '3080427057' } },
      { type: 'text', attrs: { content: ` ${text}` } },
    ],
    ...overrides,
  });
}

function imageSession(url = 'https://example.test/img.png', overrides = {}) {
  return makeSession({
    content: `<img src="${url}"/>`,
    elements: [{ type: 'img', attrs: { src: url } }],
    ...overrides,
  });
}

test('未达阈值时完全不调用模型', async () => {
  const config = makeConfig({ aiMessageThreshold: 5 });
  const provider = makeProvider();
  const engine = new AiEngine(makeHost(config), { provider });

  await engine.handle(textSession('随便聊聊'));
  assert.equal(provider.calls.length, 0);
});

test('达到阈值会调用模型，发送时引用当前消息，并把回复写回上下文', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('我投赞成票');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  const session = textSession('这个方案你们怎么看');
  await engine.handle(session);

  assert.equal(provider.calls.length, 1);
  assert.equal(host.sent.length, 1);
  assert.equal(host.sent[0].messageId, session.messageId);
  assert.equal(host.sent[0].text, '我投赞成票');

  const state = engine.state.get(`onebot:${GROUP}`);
  const self = state.records.find((item) => item.self);
  assert.ok(self, '应把自己的回复写回上下文');
  assert.equal(self.text, '我投赞成票');
});

test('模型输出 <pass/> 时不发消息，并重置计数', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('<pass/>');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  await engine.handle(textSession('哈哈'));
  assert.equal(host.sent.length, 0);
  assert.equal(engine.state.get(`onebot:${GROUP}`).counter, 0);
});

test('被点名时必须回复，提示词里不允许 pass', async () => {
  const config = makeConfig({ aiMessageThreshold: 99 });
  const provider = makeProvider('在的');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  await engine.handle(textSession('MeowBot 你在吗'));
  assert.equal(provider.calls.length, 1);
  assert.doesNotMatch(provider.calls[0].system, /只输出 <pass\/>/);
  assert.equal(host.sent.length, 1);
});

test('无关记忆不会进入提示词（星野爱污染回归测试）', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('明天下午三点');
  const host = makeHost(config, '## 记忆\n星野爱的悲惨身世只是挡箭牌，不能洗白。');
  const engine = new AiEngine(host, { provider });

  await engine.handle(textSession('明天几点开会？'));
  assert.equal(provider.calls.length, 1);
  assert.doesNotMatch(provider.calls[0].user, /星野爱/);
});

test('相关记忆会进入提示词', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('周一晚上七点');
  const host = makeHost(config, '## 记忆\n学生会例会每周一 19:00 在办公楼 302 开。');
  const engine = new AiEngine(host, { provider });

  await engine.handle(textSession('学生会例会几点开？'));
  assert.match(provider.calls[0].user, /例会/);
});

test('引用消息的正文会进入提示词', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('对啊');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  const session = makeSession({
    content: '这个呢',
    elements: [{ type: 'text', attrs: { content: '这个呢' } }],
    quote: { content: '账号还是自己养吧', user: { id: '1', name: '段云翔' } },
  });
  await engine.handle(session);
  assert.match(provider.calls[0].user, /「回复 段云翔：账号还是自己养吧」/);
});

test('群名片进入提示词而不是 QQ 号', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('好的');
  const engine = new AiEngine(makeHost(config), { provider });
  await engine.handle(textSession('说个事'));
  assert.match(provider.calls[0].user, /冬木\(管理员\)/);
  assert.doesNotMatch(provider.calls[0].user, /320557068/);
});

test('模型报错时不发送、不重置计数', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = { calls: [], chat: async () => ({ ok: false, error: 'timeout' }) };
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  await engine.handle(textSession('在吗'));
  assert.equal(host.sent.length, 0);
  assert.ok(engine.state.get(`onebot:${GROUP}`).counter >= 1);
});

test('外部钩子：风格段进入 system，输出过滤器生效', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('这是一条很长的回复');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  const offSection = engine.hooks.registerPromptSection(() => 'STYLE_MARKER');
  const offFilter = engine.hooks.registerOutputFilter((text) => text.replace('很长', '短') + '~');

  await engine.handle(textSession('在吗'));
  assert.match(provider.calls[0].system, /STYLE_MARKER/);
  assert.equal(host.sent[0].text, '这是一条短的回复~');
  // 写回上下文的应是过滤后的文本
  assert.ok(engine.state.get(`onebot:${GROUP}`).records.some((item) => item.self && item.text === '这是一条短的回复~'));

  offSection();
  offFilter();
});

test('外部钩子：过滤器返回 null 时不发消息且计数清零', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('这条会被丢弃');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  engine.hooks.registerOutputFilter(() => null);
  await engine.handle(textSession('在吗'));
  assert.equal(host.sent.length, 0);
  assert.equal(engine.state.get(`onebot:${GROUP}`).counter, 0);
});

test('用户换话题后不再追着上一轮说', async () => {
  const config = makeConfig({
    aiEnableFollowupAfterMention: true,
    aiMessageThreshold: 99,
    aiMinReplyIntervalSeconds: 0,
  });
  const provider = makeProvider('先锐评一句');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  await engine.handle(mentionSession('锐评ml'));
  assert.equal(provider.calls.length, 1);
  const state = engine.state.get(`onebot:${GROUP}`);
  assert.ok(state.followup, '点名后应记录待续话题');

  await engine.handle(textSession('操不会说话了'));
  assert.equal(provider.calls.length, 1, '无关短句不应触发续聊');
  assert.equal(state.followup, null, '换话题后应清掉待续状态');
});

test('相关追问仍可续聊', async () => {
  const config = makeConfig({
    aiEnableFollowupAfterMention: true,
    aiMessageThreshold: 99,
    aiMinReplyIntervalSeconds: 0,
  });
  const provider = makeProvider('接着锐评');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  await engine.handle(mentionSession('锐评ml'));
  await engine.handle(textSession('那 ml 仙人呢'));
  assert.equal(provider.calls.length, 2, '有话题交集时应允许续聊');
});

test('明确的追问词仍可续聊', async () => {
  const config = makeConfig({
    aiEnableFollowupAfterMention: true,
    aiMessageThreshold: 99,
    aiMinReplyIntervalSeconds: 0,
  });
  const provider = makeProvider('展开说');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });

  await engine.handle(mentionSession('锐评ml'));
  await engine.handle(textSession('展开说说'));
  assert.equal(provider.calls.length, 2);
});

test('先发图再单独 @ 时，回看同一用户最近消息里的图', async () => {
  const config = makeConfig({
    aiMessageThreshold: 99,
    aiEnableImageRecognition: true,
    aiImageMaxCount: 2,
    aiImageBudgetMs: 1000,
  });
  const provider = makeProvider('看到了');
  const host = makeHost(config);
  host.resolveImage = async () => 'data:image/png;base64,AAAA';
  const engine = new AiEngine(host, { provider });

  await engine.handle(imageSession());
  assert.equal(provider.calls.length, 0, '纯图片消息不应触发回复');
  await engine.handle(mentionSession('看看这图'));
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].images.length, 1, '应回看到上一条图片消息');
});

test('不回看别的用户发的图', async () => {
  const config = makeConfig({
    aiMessageThreshold: 99,
    aiEnableImageRecognition: true,
    aiImageMaxCount: 2,
    aiImageBudgetMs: 1000,
  });
  const provider = makeProvider('看到了');
  const host = makeHost(config);
  host.resolveImage = async () => 'data:image/png;base64,AAAA';
  const engine = new AiEngine(host, { provider });

  await engine.handle(imageSession('https://example.test/other.png', { userId: '999' }));
  await engine.handle(mentionSession('看看这图'));
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].images.length, 0);
});

test('超过 2 分钟的图不再回看', async () => {
  const config = makeConfig({
    aiMessageThreshold: 99,
    aiEnableImageRecognition: true,
    aiImageMaxCount: 2,
    aiImageBudgetMs: 1000,
  });
  const provider = makeProvider('看到了');
  const host = makeHost(config);
  host.resolveImage = async () => 'data:image/png;base64,AAAA';
  const engine = new AiEngine(host, { provider });

  const base = Date.now() - 10 * 60 * 1000;
  await engine.handle(imageSession('https://example.test/old.png', { timestamp: base }));
  await engine.handle(mentionSession('看看这图', { timestamp: base + 130000 }));
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].images.length, 0);
});

test('回复发送后触发 afterReply，并带上最终文本', async () => {
  const config = makeConfig({ aiMessageThreshold: 1 });
  const provider = makeProvider('收到');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });
  const seen = [];
  engine.hooks.registerAfterReply((ctx) => { seen.push(ctx.text); });
  await engine.handle(textSession('在吗'));
  assert.deepEqual(seen, ['收到']);
});

test('引用消息里的图片会送进模型', async () => {
  const config = makeConfig({
    aiMessageThreshold: 99,
    aiEnableImageRecognition: true,
    aiImageMaxCount: 2,
    aiImageBudgetMs: 1000,
  });
  const provider = makeProvider('看到了');
  const host = makeHost(config);
  host.resolveImage = async () => 'data:image/jpeg;base64,AAAA';
  const engine = new AiEngine(host, { provider });

  const session = mentionSession('看看这张', {
    quote: {
      id: 'q1',
      user: { id: '123', name: '甲' },
      content: '<img src="https://example.test/quoted.jpg"/>',
      elements: [{ type: 'img', attrs: { src: 'https://example.test/quoted.jpg' } }],
    },
  });
  await engine.handle(session);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].images.length, 1);
});

test('引用消息只带 id 时用 get_msg 回查图片', async () => {
  const config = makeConfig({
    aiMessageThreshold: 99,
    aiEnableImageRecognition: true,
    aiImageMaxCount: 2,
    aiImageBudgetMs: 1000,
  });
  const provider = makeProvider('看到了');
  const host = makeHost(config);
  host.resolveImage = async () => 'data:image/jpeg;base64,AAAA';
  host.fetchQuotedImages = async () => [{ url: 'https://example.test/quoted.jpg', ref: '', sticker: false }];
  const engine = new AiEngine(host, { provider });

  const session = mentionSession('看看这张', {
    quote: { id: 'q2', user: { id: '123', name: '甲' }, content: '[图片]', elements: [] },
  });
  await engine.handle(session);
  assert.equal(provider.calls[0].images.length, 1);
});

test('默认自称是 bot', async () => {
  const config = makeConfig({ aiAgentName: undefined, aiMessageThreshold: 1 });
  const provider = makeProvider('在');
  const engine = new AiEngine(makeHost(config), { provider });
  await engine.handle(textSession('在吗'));
  assert.match(provider.calls[0].system, /「bot」/);
});

test('空闲话题带风格段并返回清洗后的文本', async () => {
  const config = makeConfig({ aiAgentName: 'bot' });
  const provider = makeProvider('今天谁还在摸鱼');
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider });
  engine.hooks.registerPromptSection(() => 'STYLE_SECTION');
  const text = await engine.idleTopic('1103369527');
  assert.equal(text, '今天谁还在摸鱼');
  assert.match(provider.calls[0].system, /主动抛/);
  assert.match(provider.calls[0].system, /STYLE_SECTION/);
});

test('联网搜索：结果注入到当前消息之前', async () => {
  const config = makeConfig({
    aiMessageThreshold: 99,
    aiWebSearchEnabled: true,
    aiWebSearchMode: 'auto',
    aiWebSearchMaxResults: 3,
  });
  const provider = makeProvider('据测试站点，今天有新闻');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          title: '测试标题',
          url: 'https://example.test/a',
          summary: '测试摘要内容',
          site_name: '测试站点',
          date: '2026-10-23T00:00:00Z',
        }],
      }),
    };
  };
  const engine = new AiEngine(makeHost(config), { provider, fetchImpl });
  await engine.handle(mentionSession('搜一下今天的新闻'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/tools\/search$/);
  assert.match(provider.calls[0].user, /【联网搜索结果】/);
  assert.match(provider.calls[0].user, /测试标题/);
  assert.match(provider.calls[0].user, /\[1\]/);
});

test('搜索 API 不支持时回退普通回复', async () => {
  const config = makeConfig({ aiMessageThreshold: 99, aiWebSearchEnabled: true });
  const provider = makeProvider('正常回复');
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const engine = new AiEngine(makeHost(config), { provider, fetchImpl });
  await engine.handle(mentionSession('查一下今天的新闻'));
  assert.equal(called, 1);
  assert.equal(provider.calls.length, 1);
  assert.doesNotMatch(provider.calls[0].user, /【联网搜索结果】/);
});

test('普通聊天不触发搜索', async () => {
  const config = makeConfig({ aiMessageThreshold: 1, aiWebSearchEnabled: true });
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    throw new Error('should not be called');
  };
  const engine = new AiEngine(makeHost(config), { provider: makeProvider('嗯'), fetchImpl });
  await engine.handle(textSession('今天好累'));
  assert.equal(called, 0);
});

test('模型说不知道时补一次搜索并重写', async () => {
  const config = makeConfig({ aiMessageThreshold: 99, aiWebSearchEnabled: true });
  const provider = makeProvider(() => (
    provider.calls.length === 1 ? '这个我记不清了' : '查到了，白面具是带土。'
  ));
  let fetched = 0;
  const fetchImpl = async () => {
    fetched += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          title: '白面具',
          url: 'https://example.test/mask',
          summary: '白面具是带土',
          site_name: '测试站点',
          date: '',
        }],
      }),
    };
  };
  const host = makeHost(config);
  const engine = new AiEngine(host, { provider, fetchImpl });
  await engine.handle(mentionSession('白面具'));
  assert.equal(fetched, 1);
  assert.equal(provider.calls.length, 2);
  assert.match(host.sent[0].text, /查到了/);
  assert.doesNotMatch(host.sent[0].text, /记不清/);
});
