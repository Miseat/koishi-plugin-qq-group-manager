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

import { AiHookRegistry, getSharedAiHooks } from './hooks';

const SHARED_RUNTIME = Symbol.for('qqgm.ai-runtime-facade');

export interface AiRuntimeChatRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: any;
}

export class AiRuntimeFacade {
  /** 当前存活的主插件服务；主插件卸载后为 null。 */
  current: any = null;

  bind(service: any): void {
    this.current = service;
  }

  unbind(service: any): void {
    if (this.current === service) this.current = null;
  }

  get config(): any {
    return this.current ? this.current.config : {};
  }

  get hooks(): AiHookRegistry {
    const live = this.current && this.current.ai && this.current.ai.hooks;
    // 服务不在时也返回共享注册表，避免外部插件拿到 null 后直接崩掉。
    return live || getSharedAiHooks();
  }

  chat(request: AiRuntimeChatRequest): Promise<any> {
    if (!this.current || !this.current.ai) {
      return Promise.resolve({ ok: false, text: '', error: 'qqgm service not loaded' });
    }
    return this.current.ai.chat(request);
  }
}

export function getAiRuntimeFacade(): AiRuntimeFacade {
  const store = globalThis as any;
  let facade: AiRuntimeFacade = store[SHARED_RUNTIME];
  if (!facade) {
    facade = new AiRuntimeFacade();
    store[SHARED_RUNTIME] = facade;
  }
  return facade;
}
