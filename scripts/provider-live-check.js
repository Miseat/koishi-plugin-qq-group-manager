/**
 * 线上连通性检查（在 koishi 容器内运行）：
 *   sudo docker cp scripts/provider-live-check.js koishi:/tmp/
 *   sudo docker exec -w /koishi koishi node /tmp/provider-live-check.js
 *
 * 注意：会真实调用一次模型（花费极少），用于确认 baseUrl / model / key / 请求体是否正常，
 * 以及当前 max_tokens 是否会因为 reasoning 被截断。不打印 apiKey，不发送群聊内容。
 */
// 一次性线上连通性检查：用线上配置发一条最小请求，验证 baseUrl / model / 请求体。
// 不打印 apiKey，不包含任何群聊内容。
const fs = require('node:fs');
const yaml = require('/koishi/node_modules/js-yaml');

const doc = yaml.load(fs.readFileSync('/koishi/koishi.yml', 'utf8'));
const pid = Object.keys(doc.plugins).find((key) => key.includes('qq-group-manager'));
const cfg = doc.plugins[pid];

(async () => {
  const started = Date.now();
  const response = await fetch(String(cfg.aiBaseUrl).replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.aiModel,
      temperature: cfg.aiTemperature,
      max_tokens: cfg.aiMaxOutputTokens,
      messages: [
        { role: 'system', content: '你是群聊里的一个普通成员，只输出回复正文。' },
        { role: 'user', content: '用一句话回应：今天食堂几点关门？' },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const choice = payload.choices && payload.choices[0];
  console.log(JSON.stringify({
    status: response.status,
    latencyMs: Date.now() - started,
    model: cfg.aiModel,
    maxTokens: cfg.aiMaxOutputTokens,
    finish: choice && choice.finish_reason,
    content: choice && String(choice.message && choice.message.content || '').slice(0, 120),
    reasoningTokens: payload.usage && payload.usage.completion_tokens_details && payload.usage.completion_tokens_details.reasoning_tokens,
    error: payload.error && payload.error.message,
  }, null, 1));
  process.exit(0);
})();
