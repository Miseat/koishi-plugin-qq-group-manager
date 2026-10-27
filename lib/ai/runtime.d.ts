/**
 * 主插件对外暴露的运行时门面（进程级单例）。
 *
 * 为什么需要它：
 * - 外部插件（qqgm-private 等）会 `ctx.root.get('qqgmAiRuntime')` 之后长期持有该对象；
 * - 如果每次主插件重载都 `set` 一个全新的 `{ config, hooks, chat }` 快照，
 *   外部插件手里的旧快照就永远指向已经销毁的引擎：配置不更新、钩子对不上、
 *   chat() 走旧实例；
 * - 这里改成稳定的门面对象，重载只是把 `current` 指针换到新服务，
 *   外部插件持有的引用不变，读到的 config / hooks / chat 永远是最新的。
 */
import { AiHookRegistry } from './hooks';
export interface AiRuntimeChatRequest {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
    [key: string]: any;
}
export declare class AiRuntimeFacade {
    /** 当前存活的主插件服务；主插件卸载后为 null。 */
    current: any;
    bind(service: any): void;
    unbind(service: any): void;
    get config(): any;
    get hooks(): AiHookRegistry;
    chat(request: AiRuntimeChatRequest): Promise<any>;
}
export declare function getAiRuntimeFacade(): AiRuntimeFacade;
