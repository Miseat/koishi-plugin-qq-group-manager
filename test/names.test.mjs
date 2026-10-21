import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NameResolver } = require('../lib/core/names.js');

function makeHost({ card = '', nickname = 'QQ昵称', role = 'member', fail = false } = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    getOneBotApi: () => ({
      getGroupMemberInfo: async () => {
        calls += 1;
        if (fail) throw new Error('api down');
        return { card, nickname, role };
      },
    }),
    toGroupId: () => 1103369527,
    logger: console,
  };
}

function session(overrides = {}) {
  return {
    platform: 'onebot',
    guildId: '1103369527',
    userId: '320557068',
    author: { nick: '', name: 'QQ昵称', roles: [{ id: 'member' }] },
    ...overrides,
  };
}

test('群名片优先于 QQ 昵称', async () => {
  const resolver = new NameResolver(makeHost({ card: '冬木', nickname: 'qq-nick' }));
  const identity = await resolver.fromSession(session({ author: { nick: '冬木', name: 'qq-nick' } }));
  assert.equal(identity.name, '冬木');
});

test('群名片为空时通过 getGroupMemberInfo 补齐', async () => {
  const host = makeHost({ card: '段云翔', nickname: 'qq-nick' });
  const resolver = new NameResolver(host);
  const identity = await resolver.identify(session());
  assert.equal(identity.name, '段云翔');
  assert.equal(host.calls(), 1);
});

test('查询结果有缓存，不会每条消息都打 API', async () => {
  const host = makeHost({ card: '缓存名片' });
  const resolver = new NameResolver(host);
  await resolver.identify(session());
  await resolver.identify(session());
  await resolver.display(session(), '320557068');
  assert.equal(host.calls(), 1);
});

test('API 失败时退回 QQ 号，不抛错', async () => {
  const resolver = new NameResolver(makeHost({ fail: true }));
  const identity = await resolver.identify(session({ author: { nick: '', name: '' } }));
  assert.equal(identity.name, '320557068');
});
