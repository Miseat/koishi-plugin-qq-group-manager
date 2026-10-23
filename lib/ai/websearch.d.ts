/**
 * DeepSeek 原生联网搜索（Search API）。
 *
 * 走的是 `POST {aiBaseUrl}/v1/tools/search`，用的就是主插件现有的 aiApiKey，
 * 不需要第三方搜索 Key。API 不支持 / 超时 / 没结果时返回 ok:false，
 * 调用方直接放弃搜索、继续普通模型调用。
 */
export type WebSearchMode = 'auto' | 'always' | 'off';
export interface WebSearchResult {
    title: string;
    url: string;
    summary: string;
    siteName: string;
    date: string;
}
export interface WebSearchInput {
    query: string;
    apiKey: string;
    baseUrl: string;
    maxResults: number;
    timeoutMs: number;
    maxChars?: number;
}
export interface WebSearchOutcome {
    ok: boolean;
    section?: string;
    results?: WebSearchResult[];
    reason?: string;
}
/** 判断当前消息是否值得联网；auto 只覆盖明确的问题/时效性内容，避免每句都搜。 */
export declare function shouldWebSearch(raw: string, mode?: WebSearchMode): boolean;
export declare function buildSearchQuery(raw: string): string;
export declare function formatWebSearchSection(results: WebSearchResult[], maxResults?: number, maxChars?: number): string;
export declare function fetchWebSearch(input: WebSearchInput, fetchImpl?: typeof fetch): Promise<WebSearchOutcome>;
