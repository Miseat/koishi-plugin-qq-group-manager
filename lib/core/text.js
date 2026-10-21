"use strict";
/**
 * 消息渲染：把 Koishi/OneBot 的 session 变成"人或模型都能读懂"的一行文本。
 *
 * 旧实现直接用 `content.replace(/<[^>]+>/g, ' ')`，等于把 @、图片、表情、卡片、
 * 引用全部抹掉——模型因此不知道"谁在叫谁"，也看不到被回复的原文。
 * 这里按元素逐项渲染，并单独抽出图片引用供视觉模型使用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMessage = renderMessage;
exports.truncate = truncate;
exports.stripTags = stripTags;
const CARD_TYPES = new Set(['card', 'json', 'xml', 'share', 'music', 'location']);
const FORWARD_TYPES = new Set(['forward', 'node', 'nodes']);
function decodeEntities(value) {
    return String(value || '')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&#x2f;/gi, '/');
}
function parseAttrs(tag) {
    const out = {};
    const body = tag.replace(/^<\w+\b/i, '').replace(/\/?>$/g, '');
    const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(body))) {
        out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    return out;
}
function cqAttrs(chunk) {
    const out = {};
    const body = chunk.replace(/^\[CQ:[^,]+,?/i, '').replace(/\]$/, '');
    for (const part of body.split(',')) {
        const idx = part.indexOf('=');
        if (idx <= 0)
            continue;
        const key = part.slice(0, idx).trim().toLowerCase();
        try {
            out[key] = decodeURIComponent(part.slice(idx + 1));
        }
        catch {
            out[key] = part.slice(idx + 1);
        }
    }
    return out;
}
/** 从元素里尽力取出图片 URL / 文件引用 */
function imageFromElement(el) {
    const attrs = el?.attrs ?? {};
    const url = String(el?.url || el?.src || attrs.url || attrs.src || attrs.image || attrs.href || '').trim();
    const ref = String(el?.file || el?.fileId || el?.file_id || attrs.file || attrs.fileid || attrs.file_id || attrs.id || '').trim();
    if (!url && !ref)
        return null;
    const type = String(el?.type ?? '').toLowerCase();
    const subtype = String(attrs.subType ?? attrs.subtype ?? attrs['sub-type'] ?? '');
    const summary = String(attrs.summary ?? '');
    const sticker = type === 'face' || type === 'sticker' || type === 'mface'
        || subtype === '1' || /动画表情|表情|贴纸|sticker|mface/i.test(summary);
    return { url: decodeEntities(url), ref, sticker };
}
function imageFromTag(tag) {
    const attrs = parseAttrs(tag);
    const url = String(attrs.src || attrs.url || attrs.file || '').trim();
    const ref = String(attrs.file || attrs.fileid || attrs.file_id || attrs.id || '').trim();
    if (!url && !ref)
        return null;
    const subtype = String(attrs.subtype ?? attrs['sub-type'] ?? '');
    const sticker = subtype === '1' || /动画表情|表情|贴纸|sticker|mface/i.test(String(attrs.summary ?? ''));
    return { url, ref, sticker };
}
function imageFromCq(chunk) {
    const attrs = cqAttrs(chunk);
    const url = String(attrs.url || attrs.file || '').trim();
    const ref = String(attrs.file_id || attrs.file || attrs.id || '').trim();
    if (!url && !ref)
        return null;
    const sticker = String(attrs.sub_type ?? attrs.subtype ?? '') === '1'
        || /动画表情|表情|贴纸|sticker|mface/i.test(String(attrs.summary ?? ''));
    return { url, ref, sticker };
}
function truncate(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max)
        return text;
    return `${text.slice(0, max)}…`;
}
function stripTags(content) {
    return String(content || '')
        .replace(/\[CQ:[^\]]+\]/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** 没有 elements 时的兜底：从 content 里解析 CQ 码 / HTML 标签 */
function renderFromContent(content, selfId, resolveName) {
    const images = [];
    const mentions = [];
    let text = String(content || '');
    // 图片 / 表情
    text = text.replace(/\[CQ:image,([^\]]*)\]/gi, (_all, body) => {
        const img = imageFromCq(`[CQ:image,${body}]`);
        if (img)
            images.push(img);
        return ' [图片] ';
    });
    text = text.replace(/\[CQ:(face|mface|sticker),([^\]]*)\]/gi, () => ' [表情] ');
    text = text.replace(/<img\b[^>]*\/?>/gi, (tag) => {
        const img = imageFromTag(tag);
        if (img)
            images.push(img);
        return ' [图片] ';
    });
    text = text.replace(/<face\b[^>]*\/?>/gi, ' [表情] ');
    // @
    text = text.replace(/\[CQ:at,([^\]]*)\]/gi, (_all, body) => {
        const attrs = cqAttrs(`[CQ:at,${body}]`);
        const qq = String(attrs.qq || attrs.id || '').trim();
        if (!qq || qq === 'all')
            return ' @全体成员 ';
        if (qq !== selfId)
            mentions.push(qq);
        return ` @${qq === selfId ? '你' : qq} `;
    });
    text = text.replace(/<at\b[^>]*\/?>/gi, (tag) => {
        const attrs = parseAttrs(tag);
        const qq = String(attrs.qq || attrs.id || '').trim();
        if (!qq || qq === 'all')
            return ' @全体成员 ';
        if (qq !== selfId)
            mentions.push(qq);
        return ` @${qq === selfId ? '你' : (attrs.name || qq)} `;
    });
    // 卡片 / 转发 / 其它
    text = text.replace(/\[CQ:(json|xml),([^\]]*)\]/gi, ' [卡片消息] ');
    text = text.replace(/\[CQ:(forward|node),([^\]]*)\]/gi, ' [合并转发] ');
    text = text.replace(/\[CQ:(record|audio),([^\]]*)\]/gi, ' [语音] ');
    text = text.replace(/\[CQ:video,([^\]]*)\]/gi, ' [视频] ');
    text = text.replace(/\[CQ:file,([^\]]*)\]/gi, ' [文件] ');
    return { text: stripTags(text), images, mentions };
}
/**
 * 渲染一条消息。
 * - @ 会解析成群名片（`@你` 表示 @bot）
 * - 图片/表情/卡片/转发/语音都有占位
 * - 引用消息（被回复的那条）单独返回，由提示词层决定怎么用
 */
async function renderMessage(session, resolveName, options = {}) {
    const selfId = String(options.selfId ?? session?.bot?.selfId ?? session?.selfId ?? '');
    const quoteMax = options.quoteMaxChars ?? 60;
    const elements = Array.isArray(session?.elements) ? session.elements : [];
    const images = [];
    const mentions = [];
    const parts = [];
    let atBot = false;
    if (!elements.length) {
        const fallback = renderFromContent(String(session?.content ?? ''), selfId, resolveName);
        // 兜底路径无法异步解析 @ 名字，尽力把 html 里的 name 用上
        const withNames = await replaceMentionsWithNames(fallback.text, resolveName, selfId);
        return {
            text: withNames.text,
            images: fallback.images,
            mentions: [...new Set([...fallback.mentions, ...withNames.mentions])],
            atBot: !!selfId && (fallback.text.includes('@你')
                || fallback.text.includes(`<at id="${selfId}"`)
                || fallback.text.includes(`qq=${selfId}`)),
            quote: await renderQuote(session?.quote, resolveName, quoteMax),
            plain: withNames.text,
            visualOnly: !withNames.text.replace(/\[[^\]]+\]/g, '').trim(),
        };
    }
    for (const el of elements) {
        const type = String(el?.type ?? '').toLowerCase();
        const attrs = el?.attrs ?? {};
        if (!type)
            continue;
        if (type === 'text') {
            parts.push(String(attrs.content ?? ''));
            continue;
        }
        if (type === 'at' || type === 'mention') {
            const qq = String(attrs.id ?? attrs.qq ?? el?.id ?? '').trim();
            if (!qq || qq === 'all') {
                parts.push(' @全体成员 ');
                continue;
            }
            if (qq === selfId) {
                atBot = true;
                parts.push(' @你 ');
            }
            else {
                mentions.push(qq);
                const name = attrs.name || (await resolveName(qq)) || qq;
                parts.push(` @${name} `);
            }
            continue;
        }
        if (type === 'image' || type === 'img' || type === 'sticker' || type === 'mface') {
            const img = imageFromElement(el);
            if (img)
                images.push(img);
            parts.push(img?.sticker ? ' [表情] ' : ' [图片] ');
            continue;
        }
        if (type === 'face') {
            // QFace 只是表情 id，不是可识别的图片内容，不要送进视觉模型
            parts.push(' [表情] ');
            continue;
        }
        if (type === 'quote' || type === 'reply') {
            continue;
        }
        if (CARD_TYPES.has(type)) {
            parts.push(' [卡片消息] ');
            continue;
        }
        if (FORWARD_TYPES.has(type)) {
            parts.push(' [合并转发] ');
            continue;
        }
        if (type === 'record' || type === 'audio' || type === 'voice') {
            parts.push(' [语音] ');
            continue;
        }
        if (type === 'video') {
            parts.push(' [视频] ');
            continue;
        }
        if (type === 'file') {
            parts.push(' [文件] ');
            continue;
        }
        // 未知元素：把 attrs.content 或原文本带上，别丢信息
        if (attrs.content)
            parts.push(String(attrs.content));
    }
    let text = parts.join('').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    if (!text && images.length)
        text = images.some((item) => !item.sticker) ? '[图片]' : '[表情]';
    const quote = await renderQuote(session?.quote, resolveName, quoteMax);
    return {
        text,
        images,
        quote,
        mentions: [...new Set(mentions)],
        atBot,
        plain: text,
        visualOnly: !text.replace(/\[[^\]]+\]/g, '').trim(),
    };
}
async function replaceMentionsWithNames(text, resolveName, selfId) {
    const mentions = [];
    const re = /@(\d{5,12})\b/g;
    const ids = [...new Set([...text.matchAll(re)].map((m) => m[1]))];
    let out = text;
    for (const id of ids) {
        if (id === selfId) {
            out = out.split(`@${id}`).join('@你');
            continue;
        }
        mentions.push(id);
        const name = await resolveName(id);
        if (name)
            out = out.split(`@${id}`).join(`@${name}`);
    }
    return { text: out, mentions };
}
async function renderQuote(quote, resolveName, maxChars) {
    if (!quote)
        return undefined;
    const content = String(quote.content ?? '').trim()
        || (Array.isArray(quote.elements) ? quote.elements.map((el) => el?.attrs?.content ?? '').join('') : '');
    const text = truncate(stripTags(content), maxChars);
    if (!text)
        return undefined;
    const userId = String(quote.user?.id ?? quote.userId ?? quote.author?.id ?? '');
    const rawName = quote.user?.name ?? quote.author?.nick ?? quote.author?.name ?? '';
    const name = String(rawName || (userId ? await resolveName(userId) : '') || '某人');
    return { userId, name, text };
}
