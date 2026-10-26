import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 只测纯逻辑：文件名生成与作用域归一。
// 依赖 service 的实现，通过最小替身拿到方法。
function makeService(config = {}) {
  const baseDir = '/data';
  const svc = {
    ctx: { baseDir },
    config: { memoryFileName: 'Memory.md', memoryPerScope: true, ...config },
  };
  // 直接借用真实实现，避免复制逻辑导致漂移
  const proto = require('../lib/service.js');
  const ClassRef = proto.QQGroupManagerService || proto.default;
  return { svc, ClassRef };
}

test('群聊记忆文件名：Memory_<群号>_群聊.md', () => {
  const { svc, ClassRef } = makeService();
  const file = ClassRef.prototype.getMemoryFilePath.call(svc, { kind: 'group', id: '1103369527' });
  assert.equal(path.basename(file), 'Memory_1103369527_群聊.md');
});

test('私聊记忆文件名：Memory_<QQ号>_私聊.md', () => {
  const { svc, ClassRef } = makeService();
  const file = ClassRef.prototype.getMemoryFilePath.call(svc, { kind: 'private', id: '692400912' });
  assert.equal(path.basename(file), 'Memory_692400912_私聊.md');
});

test('关闭 memoryPerScope 时回落到单文件', () => {
  const { svc, ClassRef } = makeService({ memoryPerScope: false });
  const file = ClassRef.prototype.getMemoryFilePath.call(svc, { kind: 'group', id: '1' });
  assert.equal(path.basename(file), 'Memory.md');
});

test('无作用域时用旧单文件', () => {
  const { svc, ClassRef } = makeService();
  const file = ClassRef.prototype.getMemoryFilePath.call(svc, null);
  assert.equal(path.basename(file), 'Memory.md');
});

test('自定义基础名会作为前缀保留', () => {
  const { svc, ClassRef } = makeService({ memoryFileName: 'Notes.md' });
  const file = ClassRef.prototype.getMemoryFilePath.call(svc, { kind: 'group', id: '42' });
  assert.equal(path.basename(file), 'Notes_42_群聊.md');
});

test('非法字符被清理，避免路径穿越', () => {
  const { svc, ClassRef } = makeService();
  const file = ClassRef.prototype.getMemoryFilePath.call(svc, { kind: 'group', id: '../evil/x' });
  const name = path.basename(file);
  assert.equal(name, 'Memory_..evilx_群聊.md');
  // 关键：不会真的逃出 baseDir
  assert.equal(path.dirname(file), path.resolve('/data'));
  assert.ok(!name.includes('/'));
});

test('memoryScopeOf：群聊取群号', () => {
  const { svc, ClassRef } = makeService();
  const scope = ClassRef.prototype.memoryScopeOf.call(svc, { guildId: '123', userId: '9', isDirect: false });
  assert.deepEqual(scope, { kind: 'group', id: '123' });
});

test('memoryScopeOf：私聊取对方 QQ', () => {
  const { svc, ClassRef } = makeService();
  const scope = ClassRef.prototype.memoryScopeOf.call(svc, { userId: '692400912', isDirect: true });
  assert.deepEqual(scope, { kind: 'private', id: '692400912' });
});

test('memoryScopeOf：没有 guildId 视为私聊', () => {
  const { svc, ClassRef } = makeService();
  const scope = ClassRef.prototype.memoryScopeOf.call(svc, { userId: '5' });
  assert.equal(scope.kind, 'private');
});
