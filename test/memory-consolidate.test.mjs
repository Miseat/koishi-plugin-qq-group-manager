import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

const {
  isAutoMemoryBlock,
  memoryBlockBody,
  buildConsolidatePrompt,
} = require('../lib/ai/learn.js');
const { AiEngine } = require('../lib/ai/engine.js');

function block(time, text, label = '自动归纳') {
  return `## 2026/10/27 ${time} · ${label}\n${text}`;
}

function makeEngine({ memory, every = 5, maxEntries = 15, maxChars = 90 } = {}) {
  const commits = [];
  const prompts = [];
  const host = {
    config: {
      aiContextWindow: 60,
      aiMessageThreshold: 10,
      aiMinReplyIntervalSeconds: 0,
      memoryAutoLearn: false,
      enableMemory: true,
      memoryLearnConsolidate: true,
      memoryLearnConsolidateEvery: every,
      memoryLearnMaxEntries: maxEntries,
      memoryLearnConsolidateMaxChars: maxChars,
    },
    logger: { info() {}, warn() {}, debug() {} },
    readMemoryFile: async () => memory,
    commitAutoMemory: async (_scope, payload) => { commits.push(payload); },
    saveMemoryToFile: async () => {},
    sendReply: async () => {},
    getOneBotApi: () => null,
    toGroupId: () => 1,
    extractImages: () => [],
    resolveImage: async () => '',
  };
  const provider = {
    chat: async (request) => {
      prompts.push(request);
      return { ok: true, text: '压缩后的合并记忆' };
    },
  };
  const engine = new AiEngine(host, { provider });
  return { engine, commits, prompts };
}

test('识别自动归纳块并取正文', () => {
  const auto = block('10:00:00', '甲是群主');
  const manual = block('10:01:00', '手写记忆', '用户 123');
  assert.equal(isAutoMemoryBlock(auto), true);
  assert.equal(isAutoMemoryBlock(manual), false);
  assert.equal(memoryBlockBody(auto), '甲是群主');
});

test('压缩提示词包含每条记忆正文与字数上限', () => {
  const prompt = buildConsolidatePrompt(
    [block('10:00:00', '甲是群主'), block('10:01:00', '乙喜欢宝可梦')],
    { maxChars: 80, kind: 'group' },
  );
  assert.match(prompt.user, /甲是群主/);
  assert.match(prompt.user, /乙喜欢宝可梦/);
  assert.match(prompt.system, /80 字/);
  // 标题行不应重复出现在正文里
  assert.ok(!prompt.user.includes('· 自动归纳'));
});

test('累计到第 5 条时把旧 4 条 + 新 1 条压成 1 条', async () => {
  const memory = [
    block('10:00:00', '记忆A'),
    block('10:01:00', '记忆B'),
    block('10:02:00', '记忆C'),
    block('10:03:00', '记忆D'),
  ].join('\n\n---\n\n');
  const { engine, commits, prompts } = makeEngine({ memory });
  try {
    const result = await engine.saveLearnedMemory('group', { kind: 'group', id: '1' }, '记忆E');
    assert.equal(result.consolidated, true);
    assert.equal(result.removed, 4);
    assert.equal(result.text, '压缩后的合并记忆');

    assert.equal(prompts.length, 1);
    assert.match(prompts[0].user, /记忆A/);
    assert.match(prompts[0].user, /记忆E/);

    assert.equal(commits.length, 1);
    assert.equal(commits[0].add, '压缩后的合并记忆');
    assert.equal(commits[0].remove.length, 4);
  } finally {
    engine.dispose();
  }
});

test('不足 5 条时只追加，不调用模型', async () => {
  const memory = [block('10:00:00', '记忆A'), block('10:01:00', '记忆B')].join('\n\n---\n\n');
  const { engine, commits, prompts } = makeEngine({ memory });
  try {
    const result = await engine.saveLearnedMemory('group', { kind: 'group', id: '1' }, '记忆C');
    assert.equal(result.consolidated, false);
    assert.equal(prompts.length, 0);
    assert.equal(commits[0].add, '记忆C');
    assert.equal(commits[0].remove, undefined);
  } finally {
    engine.dispose();
  }
});

test('超过条数上限时强制压缩最早的若干条', async () => {
  const blocks = Array.from({ length: 15 }, (_, i) => block(`10:${String(i).padStart(2, '0')}:00`, `记忆${i}`));
  const memory = blocks.join('\n\n---\n\n');
  const { engine, commits } = makeEngine({ memory, every: 20, maxEntries: 15 });
  try {
    const result = await engine.saveLearnedMemory('group', { kind: 'group', id: '1' }, '新记忆');
    assert.equal(result.consolidated, true);
    assert.equal(result.removed, 15);
    assert.equal(commits[0].remove.length, 15);
    assert.equal(commits[0].add, '压缩后的合并记忆');
  } finally {
    engine.dispose();
  }
});

test('压缩失败时退回普通追加，不丢旧记忆', async () => {
  const memory = Array.from({ length: 4 }, (_, i) => block(`10:0${i}:00`, `记忆${i}`)).join('\n\n---\n\n');
  const commits = [];
  const host = {
    config: {
      aiContextWindow: 60,
      memoryAutoLearn: false,
      enableMemory: true,
      memoryLearnConsolidate: true,
      memoryLearnConsolidateEvery: 5,
      memoryLearnMaxEntries: 15,
    },
    logger: { info() {}, warn() {}, debug() {} },
    readMemoryFile: async () => memory,
    commitAutoMemory: async (_scope, payload) => { commits.push(payload); },
    saveMemoryToFile: async () => {},
    sendReply: async () => {},
    getOneBotApi: () => null,
    toGroupId: () => 1,
    extractImages: () => [],
    resolveImage: async () => '',
  };
  const engine = new AiEngine(host, { provider: { chat: async () => ({ ok: false, error: 'boom' }) } });
  try {
    const result = await engine.saveLearnedMemory('group', { kind: 'group', id: '1' }, '新记忆');
    assert.equal(result.consolidated, false);
    assert.equal(result.text, '新记忆');
    assert.equal(commits[0].add, '新记忆');
    assert.deepEqual(commits[0].remove, []);
  } finally {
    engine.dispose();
  }
});

test('service.commitAutoMemory 能替换旧条目并保留手动记忆', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqgm-mem-'));
  const { Context } = require('koishi');
  const { QQGroupManagerService } = require('../lib/service.js');
  const app = new Context();
  app.baseDir = dir;
  const service = new QQGroupManagerService(app, {
    platformFilter: ['onebot'], command: '[bot]', groupRules: [], allowedUserIds: [],
    allowGroupOwner: true, allowGroupAdmin: true, requireBotOwnerForAdmin: false,
    bannedWords: [], strongKeywords: [], blockCardMessage: false, blockForwardMessage: false,
    enableMemory: true, memoryPerScope: true, memoryFileName: 'Memory.md',
    enableAiReply: false, enableJoinRequestReview: false, customCommands: [],
    responseStyle: 'plain', logAuthCheck: false, logCommandResult: false,
    enableSelfGag: false, enableUnauthorizedMutePunish: false,
  });

  const scope = { kind: 'group', id: '123' };
  try {
    await service.saveMemoryToFile('', '手动记忆', scope, '用户 1');
    const first = await service.commitAutoMemory(scope, { add: '自动A', label: '自动归纳' });
    await service.commitAutoMemory(scope, { add: '自动B', label: '自动归纳' });

    const content = await service.readMemoryFile(scope);
    assert.match(content, /手动记忆/);
    assert.match(content, /自动A/);
    assert.match(content, /自动B/);

    // 用压缩结果替换掉自动A
    await service.commitAutoMemory(scope, {
      add: '压缩结果', remove: [first], label: '自动归纳',
    });
    const next = await service.readMemoryFile(scope);
    assert.ok(!next.includes('自动A'));
    assert.match(next, /手动记忆/);
    assert.match(next, /自动B/);
    assert.match(next, /压缩结果/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
