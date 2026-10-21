"use strict";
/**
 * 视觉输入：把消息里的图片并发转成 data URL。
 *
 * 旧实现是串行的：每张图 12 秒超时、多个候选依次尝试，两张图就能拖到 60 秒，
 * 等模型回答时上下文已经过期。这里改成并发 + 总预算（默认 6 秒），
 * 超时/失败直接跳过，绝不阻塞回复。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickImages = pickImages;
exports.resolveImages = resolveImages;
function delay(ms) {
    return new Promise((resolve) => setTimeout(() => resolve(''), ms));
}
async function withDeadline(task, deadline, fallback) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
        return fallback;
    return Promise.race([task, delay(remaining)]);
}
function pickImages(own, quoted, maxCount) {
    const out = [];
    const seen = new Set();
    const push = (item) => {
        const key = item.url || item.ref;
        if (!key || seen.has(key))
            return;
        seen.add(key);
        out.push(item);
    };
    // 当前消息优先；至少保留一张图的位置给引用消息
    for (const item of own) {
        if (out.length >= maxCount)
            break;
        push(item);
    }
    for (const item of quoted) {
        if (out.length >= maxCount)
            break;
        push(item);
    }
    return out.slice(0, Math.max(0, maxCount));
}
async function resolveImages(items, resolve, options = {}) {
    const maxCount = Math.max(0, options.maxCount ?? 2);
    const budgetMs = Math.max(500, options.budgetMs ?? 6000);
    if (!maxCount || !items.length)
        return [];
    const selected = items.slice(0, maxCount);
    const deadline = Date.now() + budgetMs;
    const tasks = selected.map(async (item) => {
        const candidates = [item.url, item.ref].filter(Boolean);
        for (const candidate of candidates) {
            if (Date.now() >= deadline)
                return '';
            const dataUrl = await withDeadline(resolve(candidate).catch(() => ''), deadline, '');
            if (dataUrl && /^data:image\//i.test(dataUrl))
                return dataUrl;
        }
        return '';
    });
    const results = await Promise.all(tasks);
    return results.filter((item) => !!item);
}
