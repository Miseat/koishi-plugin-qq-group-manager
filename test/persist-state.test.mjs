import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../lib/ai/engine.js');

const GROUP = '1103369527';
const SELF = '3080427057';

function makeConfig(overrides = {}) {
  return {
    platformFilter: ['onebot'],
    command: '[bot]',
    enableAiReply: true,
    aiReplyRequireGroupRule: false,
    groupRules: [],
    aiReplyMode: 'threshold',
    aiMessageThreshold: 99,
    aiRandomReplyProbability: 0,
    aiPseudoRandom: false,
    aiMinReplyIntervalSeconds: 0,
    aiContextWindow: 6,
    aiAgentName: 'MeowBot',
    aiSystemPrompt: '你是群友。',
    aiActivePersona: '',
    aiPersonas: [],
    aiTemperature: 0.8,
    aiMaxOutputTokens: 1500,
    aiMaxReplyChars: 80,
    aiEnableImageRecognition: false,
    aiImageMaxCount: 0,
    aiImageBudgetMs: 1000,
    aiApiKey: 'test-key',
    aiBaseUrl: 'https://api.deepseek.com',
    aiWebSearchEnabled: false,
    aiEnableFollowupAfterMention: false,
    aiDebugPrompt: false,
    enableMemory: true,
    memoryAutoLearn: true,
    memoryAutoLearnGroups: [],
    persistAiState: true,
    ...overrides,
  };
}

function makeHost(config, baseDir, logs = []) {
  return {
    config,
    ctx: { baseDir },
    logger: {
      info: (line) => logs.push(String(line)),
      warn: (line) => logs.push(`WARN ${String(line)}`),
    },
    getOneBotApi: () => null,
    toGroupId: () => Number(GROUP),
    extractImages: () => [],
    resolveImage: async () => '',
    sendReply: async () => {},
    readMemoryFile: async () => '',
  };
}

let seq = 0;
function message(clock, text) {
  seq += 1;
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: '320557068',
    messageId: `m-${seq}`,
    content: text,
    elements: [{ type: 'text', attrs: { content: text } }],
    bot: { selfId: SELF },
    timestamp: clock,
    author: { nick: '冬木', name: 'qq-nick', roles: [] },
  };
}

test('重启后恢复上下文、计数、伪随机加成与未归纳消息桶', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqgm-state-'));
  const clock = 1_700_000_000_000;
  const config = makeConfig();
  const provider = { calls: 0, chat: async () => { provider.calls += 1; return { ok: true, text: 'x' }; } };

  const engine1 = new AiEngine(makeHost(config, dir), { provider, now: () => clock });
  try {
    for (let i = 0; i < 8; i += 1) {
      await engine1.handle(message(clock + i, `第${i}条`));
    }
    const st = engine1.state.peek(`onebot:${GROUP}`);
    assert.equal(st.records.length, 6);
    assert.equal(st.counter, 8);
    assert.equal(engine1.learnStore.entries().length, 1, '被挤出的 2 条应进入待归纳桶');
    assert.equal(engine1.learnStore.entries()[0].bucket.records.length, 2);

    st.randomBoost = 0.42;
    st.lastAttemptAt = clock - 1000;
    st.lastCooldownNoticeAt = clock - 500;
  } finally {
    engine1.dispose();
  }

  const file = join(dir, 'data', 'qqgm-ai-state.json');
  assert.ok(existsSync(file), 'dispose 时应落盘');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.version, 1);
  assert.ok(raw.groups[`onebot:${GROUP}`]);
  assert.ok(raw.learn[`group:${GROUP}`]);

  const logs = [];
  const engine2 = new AiEngine(makeHost(config, dir, logs), { provider, now: () => clock });
  try {
    const st = engine2.state.peek(`onebot:${GROUP}`);
    assert.ok(st, '应恢复会话状态');
    assert.equal(st.records.length, 6);
    assert.equal(st.counter, 8);
    assert.equal(st.randomBoost, 0.42);
    assert.equal(st.lastAttemptAt, clock - 1000);
    assert.equal(st.lastCooldownNoticeAt, clock - 500);

    const buckets = engine2.learnStore.entries();
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].bucket.records.length, 2, '未归纳的消息不能丢');
    assert.ok(logs.some((line) => line.includes('[ai-state] 已恢复')));

    // 重启不触发模型调用
    assert.equal(provider.calls, 0);
  } finally {
    engine2.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persistAiState=false 时不落盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqgm-state-off-'));
  const clock = 1_700_000_000_000;
  const config = makeConfig({ persistAiState: false });
  const engine = new AiEngine(makeHost(config, dir), { now: () => clock });
  try {
    await engine.handle(message(clock, '在吗'));
  } finally {
    engine.dispose();
  }
  assert.equal(existsSync(join(dir, 'data', 'qqgm-ai-state.json')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('超过 6 小时的旧上下文不恢复，但未归纳桶保留', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqgm-state-ttl-'));
  const clock = 1_700_000_000_000;
  const config = makeConfig();
  const engine1 = new AiEngine(makeHost(config, dir), { now: () => clock });
  try {
    for (let i = 0; i < 8; i += 1) {
      await engine1.handle(message(clock + i, `第${i}条`));
    }
  } finally {
    engine1.dispose();
  }

  const later = clock + 7 * 60 * 60 * 1000;
  const engine2 = new AiEngine(makeHost(config, dir), { now: () => later });
  try {
    const st = engine2.state.peek(`onebot:${GROUP}`);
    assert.equal(st, undefined, '过期上下文应丢弃');
    assert.equal(engine2.learnStore.entries()[0].bucket.records.length, 2, '待归纳消息仍保留');
  } finally {
    engine2.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
