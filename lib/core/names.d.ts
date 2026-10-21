/**
 * 群名片解析。
 *
 * 旧实现只读 `session.username`，拿不到时直接退化成 QQ 昵称或 QQ 号，
 * 而且从不调用 getGroupMemberInfo 兜底。这里统一成一条链路：
 *
 *   sender.card（群名片） → getGroupMemberInfo().card → sender.nickname → QQ 号
 *
 * 结果按「群 + QQ」缓存，避免每条消息都打 API。
 */
export type MemberRole = 'owner' | 'admin' | 'member' | 'unknown';
export interface MemberIdentity {
    qq: string;
    name: string;
    role: MemberRole;
    /** 群名片是否为空（为空说明群成员没设名片） */
    cardEmpty: boolean;
}
export interface NameHost {
    getOneBotApi(session: any): any;
    toGroupId(session: any): number | null;
    logger: any;
}
export declare function roleLabel(role: MemberRole): string;
export declare function normalizeRole(raw: unknown): MemberRole;
export declare class NameResolver {
    private host;
    private cache;
    constructor(host: NameHost);
    /** 从消息事件本身取身份（最快，零 API） */
    fromSession(session: any): MemberIdentity;
    private key;
    /** 查群成员资料（带缓存）。失败返回 null，绝不抛错。 */
    lookup(session: any, qq: string): Promise<{
        name: string;
        role: MemberRole;
    } | null>;
    /** 给某个 session 生成同步用的「QQ → 名字」解析函数（renderMessage 用） */
    resolverFor(session: any): (qq: string) => Promise<string>;
    /**
     * 解析发言人身份：事件自带的群名片优先；为空才查 API。
     * 返回值里 role 尽量给出，供提示词标注「群主/管理员/成员」。
     */
    identify(session: any): Promise<MemberIdentity>;
    /** 指令回显用：尽量给出「群名片(QQ)」 */
    display(session: any, qq: string): Promise<string>;
    clear(): void;
}
