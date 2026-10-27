"use strict";
/**
 * 内置 BMP → PNG 转码（纯 JS，零依赖）。
 *
 * 为什么需要：
 *   QQ 有时会把图片存成 BMP。DeepSeek 等视觉模型只接受 webp/png/jpeg/gif，
 *   直接发 BMP 会 400。与其跳过这张图，不如转成 PNG 再发。
 *
 * 支持：
 *   - 1/4/8/16/24/32 位 BMP
 *   - BI_RGB（未压缩）、BI_BITFIELDS
 *   - 8 位调色板（含 RLE8 不处理，直接按索引读，够用）
 *
 * 不支持（遇到就返回 null，调用方回退到"跳过这张图"）：
 *   - RLE 压缩
 *   - OS/2 v1 头
 *   - 带 alpha 的复杂变体（按 32 位 BGRA 直读，够常见场景用）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBmp = isBmp;
exports.bmpToPng = bmpToPng;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 判断是不是 BMP */
function isBmp(buffer) {
    return !!buffer && buffer.length > 26 && buffer[0] === 0x42 && buffer[1] === 0x4d;
}
/** CRC32（PNG chunk 需要） */
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}
/** 组装一个 PNG chunk */
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}
/** 把 RGB(A) 像素编码成 PNG（真彩色 8 位） */
function encodePng(width, height, rgba) {
    const stride = width * 4;
    // 每行前置一个 filter byte（0 = None）
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    // zlib deflate（Node 自带）
    const zlib = require('node:zlib');
    const idat = zlib.deflateSync(raw, { level: 6 });
    return Buffer.concat([
        PNG_SIG,
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
/**
 * BMP → PNG buffer。
 * @returns {Buffer|null} 成功返回 PNG，无法处理返回 null
 */
function bmpToPng(buffer) {
    if (!isBmp(buffer))
        return null;
    try {
        const dataOffset = buffer.readUInt32LE(10);
        const headerSize = buffer.readUInt32LE(14);
        let width;
        let height;
        let bitCount;
        let compression;
        let paletteOffset;
        if (headerSize === 12) {
            // OS/2 v1：不支持
            return null;
        }
        // BITMAPINFOHEADER 及以后
        width = buffer.readInt32LE(18);
        height = buffer.readInt32LE(22);
        bitCount = buffer.readUInt16LE(28);
        compression = buffer.readUInt32LE(30);
        paletteOffset = 14 + headerSize;
        if (!width || !height)
            return null;
        if (compression === 1 || compression === 2)
            return null; // RLE 不支持
        const bottomUp = height > 0;
        const h = Math.abs(height);
        const w = Math.abs(width);
        // 极端尺寸保护（避免爆内存）
        if (w > 8192 || h > 8192 || w * h > 20_000_000)
            return null;
        // 调色板：8 位及以下
        let palette = null;
        if (bitCount <= 8) {
            const count = bitCount === 8 ? 256 : 1 << bitCount;
            palette = new Uint8Array(count * 4);
            let base = paletteOffset;
            // 若头里声明了颜色数，用它
            const declared = headerSize >= 40 ? buffer.readUInt32LE(46) : 0;
            const use = declared && declared <= count ? declared : count;
            for (let i = 0; i < use; i += 1) {
                const off = base + i * 4;
                if (off + 3 >= buffer.length)
                    break;
                palette[i * 4] = buffer[off + 2]; // R
                palette[i * 4 + 1] = buffer[off + 1]; // G
                palette[i * 4 + 2] = buffer[off]; // B
                palette[i * 4 + 3] = 255;
            }
        }
        const rowSize = Math.floor((bitCount * w + 31) / 32) * 4;
        const rgba = Buffer.alloc(w * h * 4);
        for (let y = 0; y < h; y += 1) {
            // BMP 默认自下而上存储
            const srcY = bottomUp ? h - 1 - y : y;
            const rowStart = dataOffset + srcY * rowSize;
            if (rowStart >= buffer.length)
                break;
            for (let x = 0; x < w; x += 1) {
                const dst = (y * w + x) * 4;
                let r = 0;
                let g = 0;
                let b = 0;
                let a = 255;
                if (bitCount === 24) {
                    const off = rowStart + x * 3;
                    if (off + 2 >= buffer.length)
                        continue;
                    b = buffer[off];
                    g = buffer[off + 1];
                    r = buffer[off + 2];
                }
                else if (bitCount === 32) {
                    const off = rowStart + x * 4;
                    if (off + 3 >= buffer.length)
                        continue;
                    b = buffer[off];
                    g = buffer[off + 1];
                    r = buffer[off + 2];
                    const alpha = buffer[off + 3];
                    a = alpha === 0 ? 255 : alpha; // 很多 BMP 的 alpha 位全 0，按不透明处理
                }
                else if (bitCount === 16) {
                    const off = rowStart + x * 2;
                    if (off + 1 >= buffer.length)
                        continue;
                    const v = buffer.readUInt16LE(off);
                    // 默认 5-5-5
                    r = ((v >> 10) & 0x1f) << 3;
                    g = ((v >> 5) & 0x1f) << 3;
                    b = (v & 0x1f) << 3;
                }
                else if (bitCount === 8) {
                    const off = rowStart + x;
                    if (off >= buffer.length)
                        continue;
                    const idx = buffer[off] * 4;
                    r = palette ? palette[idx] : buffer[off];
                    g = palette ? palette[idx + 1] : buffer[off];
                    b = palette ? palette[idx + 2] : buffer[off];
                }
                else if (bitCount === 4) {
                    const off = rowStart + (x >> 1);
                    if (off >= buffer.length)
                        continue;
                    const byte = buffer[off];
                    const idxVal = x % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
                    const idx = idxVal * 4;
                    r = palette ? palette[idx] : 0;
                    g = palette ? palette[idx + 1] : 0;
                    b = palette ? palette[idx + 2] : 0;
                }
                else if (bitCount === 1) {
                    const off = rowStart + (x >> 3);
                    if (off >= buffer.length)
                        continue;
                    const byte = buffer[off];
                    const bit = 7 - (x % 8);
                    const idxVal = (byte >> bit) & 1;
                    const idx = idxVal * 4;
                    r = palette ? palette[idx] : 0;
                    g = palette ? palette[idx + 1] : 0;
                    b = palette ? palette[idx + 2] : 0;
                }
                else {
                    return null; // 未知位深
                }
                rgba[dst] = r;
                rgba[dst + 1] = g;
                rgba[dst + 2] = b;
                rgba[dst + 3] = a;
            }
        }
        return encodePng(w, h, rgba);
    }
    catch {
        return null;
    }
}
