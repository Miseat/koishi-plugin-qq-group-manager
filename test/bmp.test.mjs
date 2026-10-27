import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { isBmp, bmpToPng } = require('../lib/core/bmp.js');

/** 构造一个标准 24 位 BMP */
function makeBmp24(w, h, pixelFn) {
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelBytes = rowSize * h;
  const fileSize = 54 + pixelBytes;
  const b = Buffer.alloc(fileSize);
  b.write('BM', 0);
  b.writeUInt32LE(fileSize, 2);
  b.writeUInt32LE(0, 6);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22); // 正数 = 自下而上
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(0, 30); // BI_RGB
  b.writeUInt32LE(pixelBytes, 34);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, bl] = pixelFn(x, y);
      // BMP 自下而上：第 y 行写到底部
      const row = h - 1 - y;
      const off = 54 + row * rowSize + x * 3;
      b[off] = bl;
      b[off + 1] = g;
      b[off + 2] = r;
    }
  }
  return b;
}

/** 解析 PNG 头，返回宽高与 color type */
function parsePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG 签名');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  return { w, h, bitDepth, colorType };
}

test('isBmp 识别正确', () => {
  assert.equal(isBmp(makeBmp24(2, 2, () => [0, 0, 0])), true);
  assert.equal(isBmp(Buffer.from('not a bmp at all.......')), false);
  assert.equal(isBmp(null), false);
});

test('24 位 BMP 转 PNG：尺寸与格式正确', () => {
  const bmp = makeBmp24(3, 2, () => [255, 0, 0]);
  const png = bmpToPng(bmp);
  assert.ok(png, '应转换成功');
  const info = parsePng(png);
  assert.equal(info.w, 3);
  assert.equal(info.h, 2);
  assert.equal(info.bitDepth, 8);
  assert.equal(info.colorType, 6, 'RGBA');
});

test('颜色顺序正确（BGR → RGB）', () => {
  // 纯红：BMP 里存成 B=0,G=0,R=255
  const bmp = makeBmp24(1, 1, () => [255, 0, 0]);
  const png = bmpToPng(bmp);
  // 解压 IDAT，检查第一个像素
  const idatChunks = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idatChunks.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  // 第一行：filter byte + RGBA
  assert.equal(raw[0], 0, 'filter = None');
  assert.equal(raw[1], 255, 'R');
  assert.equal(raw[2], 0, 'G');
  assert.equal(raw[3], 0, 'B');
  assert.equal(raw[4], 255, 'A');
});

test('上下方向正确：底部行不会颠倒', () => {
  // 上半红，下半蓝
  const bmp = makeBmp24(1, 2, (x, y) => (y === 0 ? [255, 0, 0] : [0, 0, 255]));
  const png = bmpToPng(bmp);
  const idatChunks = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idatChunks.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  // 第 0 行（顶部）应是红
  assert.equal(raw[1], 255, '顶部 R=255');
  assert.equal(raw[3], 0, '顶部 B=0');
  // 第 1 行从 offset 5 开始（1 filter + 4 px）
  assert.equal(raw[6], 0, '底部 R=0');
  assert.equal(raw[8], 255, '底部 B=255');
});

test('非 BMP 返回 null', () => {
  assert.equal(bmpToPng(Buffer.from('hello world this is text')), null);
});

test('损坏数据不抛错，返回 null', () => {
  const bad = Buffer.alloc(60);
  bad.write('BM', 0);
  bad.writeUInt32LE(999999, 10); // 非法偏移
  assert.doesNotThrow(() => bmpToPng(bad));
});

test('超大尺寸被拒绝', () => {
  const b = Buffer.alloc(54);
  b.write('BM', 0);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(10000, 18);
  b.writeInt32LE(10000, 22);
  b.writeUInt16LE(24, 28);
  assert.equal(bmpToPng(b), null, '超过尺寸上限应返回 null');
});

test('8 位调色板 BMP 可转换', () => {
  const w = 2;
  const h = 2;
  const rowSize = Math.floor((8 * w + 31) / 32) * 4;
  const paletteSize = 256 * 4;
  const fileSize = 54 + paletteSize + rowSize * h;
  const b = Buffer.alloc(fileSize);
  b.write('BM', 0);
  b.writeUInt32LE(fileSize, 2);
  b.writeUInt32LE(54 + paletteSize, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(8, 28);
  b.writeUInt32LE(0, 30);
  b.writeUInt32LE(paletteSize, 34);
  b.writeUInt32LE(256, 46);

  // 索引 0 = 绿色
  b[54 + 0] = 0;
  b[54 + 1] = 255;
  b[54 + 2] = 0;
  // 像素全用索引 0
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      b[54 + paletteSize + y * rowSize + x] = 0;
    }
  }

  const png = bmpToPng(b);
  assert.ok(png, '8 位应可转');
  const info = parsePng(png);
  assert.equal(info.w, 2);
  assert.equal(info.h, 2);
});
