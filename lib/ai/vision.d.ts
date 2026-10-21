/**
 * 视觉输入：把消息里的图片并发转成 data URL。
 *
 * 旧实现是串行的：每张图 12 秒超时、多个候选依次尝试，两张图就能拖到 60 秒，
 * 等模型回答时上下文已经过期。这里改成并发 + 总预算（默认 6 秒），
 * 超时/失败直接跳过，绝不阻塞回复。
 */
import type { RenderedImage } from '../core/text';
export interface VisionOptions {
    maxCount?: number;
    budgetMs?: number;
}
export type ImageResolver = (ref: string) => Promise<string>;
export declare function pickImages(own: RenderedImage[], quoted: RenderedImage[], maxCount: number): RenderedImage[];
export declare function resolveImages(items: RenderedImage[], resolve: ImageResolver, options?: VisionOptions): Promise<string[]>;
