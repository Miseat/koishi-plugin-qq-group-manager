import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { paginateMemoryList } = require('../lib/service.js');

function blocks(n) {
  return Array.from({ length: n }, (_, i) => `记忆${i + 1}`);
}

test('默认显示最新 5 条', () => {
  const r = paginateMemoryList(blocks(12));
  assert.equal(r.page, 1);
  assert.equal(r.totalPages, 3);
  assert.equal(r.items.length, 5);
  assert.deepEqual(r.items.map((i) => i.text), ['记忆8', '记忆9', '记忆10', '记忆11', '记忆12']);
});

test('第 2 页往前翻', () => {
  const r = paginateMemoryList(blocks(12), '2');
  assert.equal(r.page, 2);
  assert.deepEqual(r.items.map((i) => i.text), ['记忆3', '记忆4', '记忆5', '记忆6', '记忆7']);
});

test('最后一页（第 3 页）内容正确', () => {
  const r = paginateMemoryList(blocks(12), '3');
  assert.equal(r.page, 3);
  assert.deepEqual(r.items.map((i) => i.text), ['记忆1', '记忆2']);
});

test('页码超出范围被夹到最后一页', () => {
  const r = paginateMemoryList(blocks(12), '9');
  assert.equal(r.page, 3);
  assert.equal(r.items.length, 2);
});

test('页码小于 1 被夹到第 1 页', () => {
  const r = paginateMemoryList(blocks(12), '0');
  assert.equal(r.page, 1);
});

test('非法页码回落第 1 页', () => {
  assert.equal(paginateMemoryList(blocks(12), 'abc').page, 1);
  assert.equal(paginateMemoryList(blocks(12), '').page, 1);
  assert.equal(paginateMemoryList(blocks(12), undefined).page, 1);
});

test('空白 / null 块安全处理', () => {
  const r = paginateMemoryList([], '1');
  assert.equal(r.page, 1);
  assert.equal(r.totalPages, 1);
  assert.equal(r.items.length, 0);

  const r2 = paginateMemoryList(null, '1');
  assert.equal(r2.items.length, 0);
});

test('不足一页时仍显示全部', () => {
  const r = paginateMemoryList(blocks(3));
  assert.equal(r.totalPages, 1);
  assert.equal(r.items.length, 3);
});

test('正好 5 条为一整页', () => {
  const r = paginateMemoryList(blocks(5));
  assert.equal(r.totalPages, 1);
  assert.equal(r.items.length, 5);
  assert.equal(r.items[0].text, '记忆1');
});

test('序号是全局序号，不是页内序号', () => {
  const r = paginateMemoryList(blocks(12), '2');
  assert.deepEqual(r.items.map((i) => i.seq), [3, 4, 5, 6, 7]);
});

test('自定义每页条数', () => {
  const r = paginateMemoryList(blocks(10), '1', 3);
  assert.equal(r.totalPages, 4);
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items.map((i) => i.text), ['记忆8', '记忆9', '记忆10']);
});
