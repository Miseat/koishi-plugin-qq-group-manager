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
/** 判断是不是 BMP */
export declare function isBmp(buffer: any): boolean;
/**
 * BMP → PNG buffer。
 * @returns {Buffer|null} 成功返回 PNG，无法处理返回 null
 */
export declare function bmpToPng(buffer: any): Buffer;
