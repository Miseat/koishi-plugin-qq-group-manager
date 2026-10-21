/**
 * 在 koishi 容器内用「线上构建 + 线上配置 + 真实群消息」跑一遍 AI 提示词。
 * 只读 + 假 provider，不产生任何模型费用，也不会发消息到群里。
 */
const fs = require('node:fs');
const yaml = require('/koishi/node_modules/js-yaml');
const { Context } = require('/koishi/node_modules/koishi');
const { QQGroupManagerService } = require('/koishi/node_modules/@nestim/koishi-plugin-qq-group-manager/lib/service.js');

const GROUP = '1103369527';

// 1. 读线上配置
const doc = yaml.load(fs.readFileSync('/koishi/koishi.yml', 'utf8'));
const pid = Object.keys(doc.plugins).find((key) => key.includes('qq-group-manager'));
const config = doc.plugins[pid];

// 2. 实例化服务
const app = new Context();
const service = new QQGroupManagerService(app, config);

// 3. 假 provider：截获提示词，返回固定回复
let captured = null;
service.ai.provider = {
  async chat(request) {
    captured = request;
    return { ok: true, text: '这不等会儿再说嘛' };
  },
};

// 4. 图片不下载（真实图链早已过期）
service.resolveImage = async () => '';

// 5. 从真实探针日志取最近消息
const lines = fs.readFileSync('/koishi/qq-event-probe.log', 'utf8').split('\n').filter(Boolean);
const records = [];
for (const line of lines) {
  let item;
  try {
    item = JSON.parse(line);
  } catch {
    continue;
  }
  if (item.tag === 'message' && String(item.guildId) === GROUP) records.push(item);
}
const picked = records.slice(-14);
console.log(`history=${picked.length} from probe`);

let seq = 0;
const makeSession = (item, override = {}) => {
  seq += 1;
  const qq = String(item.userId || `1000${seq}`);
  return {
    platform: 'onebot',
    guildId: GROUP,
    userId: qq,
    messageId: String(item.messageId || `sim-${seq}`),
    content: String(item.content || ''),
    elements: Array.isArray(item.elements) ? item.elements : [],
    quote: item.hasQuote ? { content: item.quoteContent || '' } : undefined,
    bot: { selfId: '3080427057' },
    timestamp: item.t ? Date.parse(item.t) : Date.now(),
    author: {
      nick: `群名片${qq.slice(-3)}`,
      name: `qq${qq.slice(-3)}`,
      roles: [{ id: seq % 5 === 0 ? 'admin' : 'member' }],
    },
    onebot: null,
    send: async () => [],
    ...override,
  };
};

(async () => {
  for (const item of picked) {
    await service.ai.record(makeSession(item));
  }

  // 最后一条改成"点名"，强制触发并带上引用，验证完整提示词
  const last = makeSession(picked[picked.length - 1], {
    content: 'MeowBot 我们刚才在聊什么？',
    elements: [
      { type: 'at', attrs: { id: '3080427057' } },
      { type: 'text', attrs: { content: ' 我们刚才在聊什么？' } },
    ],
    quote: { content: '借号这种事还是自己养号吧', user: { id: '320557068', name: '冬木' } },
    messageId: 'sim-final',
  });
  await service.ai.record(last);
  await service.ai.handle(last);

  console.log('\n================ SYSTEM ================');
  console.log(captured ? captured.system : '(no call)');
  console.log('================ USER ==================');
  console.log(captured ? captured.user : '(no call)');
  console.log('=======================================');
  console.log('images:', captured ? (captured.images || []).length : 0);
  process.exit(0);
})();
