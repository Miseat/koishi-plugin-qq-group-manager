/**
 * 消息渲染：把 Koishi/OneBot 的 session 变成"人或模型都能读懂"的一行文本。
 *
 * 旧实现直接用 `content.replace(/<[^>]+>/g, ' ')`，等于把 @、图片、表情、卡片、
 * 引用全部抹掉——模型因此不知道"谁在叫谁"，也看不到被回复的原文。
 * 这里按元素逐项渲染，并单独抽出图片引用供视觉模型使用。
 */
export type NameResolver = (qq: string) => Promise<string>;
export interface RenderedImage {
    url: string;
    ref: string;
    sticker: boolean;
}
export interface RenderedQuote {
    userId: string;
    name: string;
    text: string;
}
export interface RenderedMessage {
    /** 已渲染的正文（含 @名字 / [图片] 等占位） */
    text: string;
    /** 本条消息自带的图片（不含引用里的） */
    images: RenderedImage[];
    /** 引用（被回复）的那条消息 */
    quote?: RenderedQuote;
    /** 正文里点名到的 QQ 号（不含 bot 自己） */
    mentions: string[];
    /** 本条消息是否 @ 了 bot（与 session.content 的格式无关） */
    atBot: boolean;
    /** 纯文本，用于关键词/记忆匹配 */
    plain: string;
    /** 是否是纯图片/表情消息 */
    visualOnly: boolean;
}
declare function truncate(value: string, max: number): string;
declare function stripTags(content: string): string;
/**
 * 渲染一条消息。
 * - @ 会解析成群名片（`@你` 表示 @bot）
 * - 图片/表情/卡片/转发/语音都有占位
 * - 引用消息（被回复的那条）单独返回，由提示词层决定怎么用
 */
export declare function renderMessage(session: any, resolveName: NameResolver, options?: {
    selfId?: string;
    quoteMaxChars?: number;
}): Promise<RenderedMessage>;
export { truncate, stripTags };
