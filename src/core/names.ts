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

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: '群主',
  admin: '管理员',
  member: '成员',
  unknown: '',
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role] ?? '';
}

export function normalizeRole(raw: unknown): MemberRole {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'owner' || value === 'admin' || value === 'member') return value;
  return 'unknown';
}

export class NameResolver {
  private cache = new Map<string, { name: string; role: MemberRole; cardEmpty: boolean; exp: number }>();

  constructor(private host: NameHost) {}

  /** 从消息事件本身取身份（最快，零 API） */
  fromSession(session: any): MemberIdentity {
    const qq = String(session?.userId ?? '').trim();
    const card = String(session?.author?.nick ?? '').trim();
    const nickname = String(session?.author?.name ?? '').trim();
    const role = normalizeRole(session?.author?.roles?.[0]?.id ?? session?.sender?.role);
    return {
      qq,
      name: card || nickname || qq,
      role,
      cardEmpty: !card,
    };
  }

  private key(guildId: string, qq: string): string {
    return `${guildId}:${qq}`;
  }

  /** 查群成员资料（带缓存）。失败返回 null，绝不抛错。 */
  async lookup(session: any, qq: string): Promise<{ name: string; role: MemberRole } | null> {
    const id = String(qq ?? '').trim();
    if (!id) return null;
    const guildId = String(session?.guildId ?? '');
    const key = this.key(guildId, id);
    const cached = this.cache.get(key);
    if (cached && cached.exp > Date.now()) {
      return { name: cached.name, role: cached.role };
    }

    const onebot = this.host.getOneBotApi(session);
    const groupId = this.host.toGroupId(session);
    if (!onebot?.getGroupMemberInfo || groupId == null) return null;

    try {
      // OneBot 的 getGroupMemberInfo 没有超时保证，这里兜一个 3 秒上限，
      // 避免偶发的接口卡住把消息处理链路拖死（拿不到就退回昵称/QQ 号）。
      const info = await Promise.race([
        onebot.getGroupMemberInfo(groupId, Number(id), true),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!info) {
        this.cache.set(key, { name: '', role: 'unknown', cardEmpty: true, exp: Date.now() + NEGATIVE_TTL_MS });
        return null;
      }
      const card = String(info.card ?? '').trim();
      const nickname = String(info.nickname ?? info.nick ?? '').trim();
      const name = card || nickname;
      const role = normalizeRole(info.role);
      this.cache.set(key, {
        name,
        role,
        cardEmpty: !card,
        exp: Date.now() + CACHE_TTL_MS,
      });
      return { name, role };
    } catch {
      this.cache.set(key, { name: '', role: 'unknown', cardEmpty: true, exp: Date.now() + NEGATIVE_TTL_MS });
      return null;
    }
  }

  /** 给某个 session 生成同步用的「QQ → 名字」解析函数（renderMessage 用） */
  resolverFor(session: any): (qq: string) => Promise<string> {
    return async (qq: string) => {
      const id = String(qq ?? '').trim();
      if (!id) return '';
      const cached = this.cache.get(this.key(String(session?.guildId ?? ''), id));
      if (cached?.name) return cached.name;
      const found = await this.lookup(session, id);
      return found?.name || id;
    };
  }

  /**
   * 解析发言人身份：事件自带的群名片优先；为空才查 API。
   * 返回值里 role 尽量给出，供提示词标注「群主/管理员/成员」。
   */
  async identify(session: any): Promise<MemberIdentity> {
    const base = this.fromSession(session);
    if (!base.qq) return base;

    const role = base.role;
    if (!base.cardEmpty && role !== 'unknown') return base;

    const found = await this.lookup(session, base.qq);
    if (!found) return { ...base, role };
    return {
      qq: base.qq,
      name: found.name || base.name,
      role: role !== 'unknown' ? role : found.role,
      cardEmpty: base.cardEmpty,
    };
  }

  /** 指令回显用：尽量给出「群名片(QQ)」 */
  async display(session: any, qq: string): Promise<string> {
    const id = String(qq ?? '').trim();
    if (!id) return '';
    const found = await this.lookup(session, id);
    return found?.name ? `${found.name}(${id})` : id;
  }

  clear(): void {
    this.cache.clear();
  }
}
